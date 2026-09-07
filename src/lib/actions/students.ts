"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { assertProgramScope, assertStudentScope } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { notify, notificationHref, staffIdsFor } from "@/lib/notify";
import {
  ASSIGNMENT_PROGRESS,
  canActAsMentor,
  NOTIFICATION_TYPES,
  ROLES,
  USER_STATUS,
} from "@/lib/constants";
import { formatDate, formatDuration, formatMoney } from "@/lib/format";
import { syncGoalProgress } from "@/lib/goal-progress";
import { parseOptionalTaskField } from "@/lib/tasks";
import {
  EMAIL_RE,
  normalizeEmail,
  parseDateField,
  parseMinutesField,
  parseLinkField,
  type ActionState,
  parseTelegramField,
} from "@/lib/actions/shared";
import { emailConfigured } from "@/lib/email/send";
import { sendWelcomeEmails, welcomeMail } from "@/lib/email/welcome";
import { enrollmentsLabel } from "@/lib/enrollments";
import type { Cohort, Program } from "@/generated/prisma/client";

/** "Program" or "Program / Cohort" display label. */
function enrollmentLabel(programName: string, cohortName?: string | null) {
  return cohortName ? `${programName} / ${cohortName}` : programName;
}

/**
 * Resolve the program (+ cohort, required only in programs that have
 * cohorts) submitted by an enrollment form.
 */
async function resolveEnrollment(
  formData: FormData
): Promise<
  | { error: string }
  | { program: Program; cohort: Cohort | null }
> {
  const programId = String(formData.get("programId") ?? "");
  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: { cohorts: true },
  });
  if (!program) return { error: "Pick a program." };

  if (program.cohorts.length === 0) return { program, cohort: null };

  const cohortId = String(formData.get("cohortId") ?? "");
  const cohort = program.cohorts.find((c) => c.id === cohortId);
  if (!cohort) return { error: `Pick a cohort in ${program.name}.` };
  return { program, cohort };
}

/**
 * Register a LIST of student emails into a program (+ cohort where the
 * program has them), skipping the self-signup approval queue. Whoever
 * administers the program may add students to it. Each student confirms their
 * full name and Telegram username on first sign-in; hours are NOT granted
 * here — an admin allocates them per mentor afterwards. An optional
 * student-folder link per row is stored for their mentors to open.
 * Already-registered and malformed entries are skipped and reported. Each
 * student created here is emailed a welcome with a sign-in link — staff
 * registration is the one door into a program the student can't see happen.
 */
export async function createStudents(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  // The program these rows land in is what decides who may add them, so the
  // enrollment is resolved before any of the rest of the form is read.
  const enrollment = await resolveEnrollment(formData);
  if ("error" in enrollment) return { ok: false, error: enrollment.error };
  const { program, cohort } = enrollment;

  const denied = await assertProgramScope(actor, program.id);
  if (denied) return denied;

  // One (email, name, folder link) triple per row, index-aligned with the
  // emails. The name is required: every list, chip and log in the app reads
  // people by name, and a nameless row shows up as an email for as long as it
  // takes the student to sign in. The folder link stays optional.
  const emails = formData.getAll("email").map((e) => normalizeEmail(e));
  const names = formData.getAll("name").map((n) => String(n ?? "").trim());
  const folderUrls = formData.getAll("folderUrl");
  const seen = new Set<string>();
  const rows = emails
    .map((email, i) => ({ email, name: names[i] ?? "", rawFolder: folderUrls[i] ?? null }))
    .filter((r) => r.email && !seen.has(r.email) && (seen.add(r.email), true));
  if (rows.length === 0) {
    return { ok: false, error: "Enter at least one student email." };
  }

  // A malformed link fails the whole submission rather than being dropped
  // silently — losing a file link without saying so is worse than a retry.
  const withFolders: { email: string; name: string; folderUrl: string | null }[] = [];
  for (const r of rows) {
    const link = parseLinkField(r.rawFolder, `The folder link for ${r.email}`);
    if ("error" in link) return { ok: false, error: link.error };
    withFolders.push({ email: r.email, name: r.name, folderUrl: link.value });
  }

  const invalid = withFolders
    .filter((r) => !EMAIL_RE.test(r.email))
    .map((r) => `${r.email} (not a valid email)`);
  const nameless = withFolders
    .filter((r) => EMAIL_RE.test(r.email) && !r.name)
    .map((r) => `${r.email} (no name)`);
  const valid = withFolders.filter((r) => EMAIL_RE.test(r.email) && r.name);

  // An address already in the system is one of three things, and they are not
  // the same news. A student already in THIS program is a duplicate row. A
  // student in another program is somebody moving up — Global Admissions to the
  // Master's Program is the ordinary path through this school — and pasting
  // their address into this form is how an admin says so, so they are enrolled
  // rather than refused. Anybody who is not a student keeps their account.
  const existing = await prisma.user.findMany({
    where: { email: { in: valid.map((r) => r.email) } },
    select: {
      email: true,
      role: true,
      studentProfile: {
        select: { id: true, enrollments: { select: { programId: true } } },
      },
    },
  });
  const byEmail = new Map(existing.map((u) => [u.email, u]));
  const alreadyHere: string[] = [];
  const notStudents: string[] = [];
  /** Existing students to add this program to. */
  const enrolling: { email: string; name: string; profileId: string }[] = [];
  const fresh: typeof valid = [];
  for (const r of valid) {
    const found = byEmail.get(r.email);
    if (!found) {
      fresh.push(r);
    } else if (!found.studentProfile || found.role !== ROLES.STUDENT) {
      notStudents.push(`${r.email} (already registered, not a student)`);
    } else if (
      found.studentProfile.enrollments.some((e) => e.programId === program.id)
    ) {
      alreadyHere.push(`${r.email} (already in this program)`);
    } else {
      enrolling.push({
        email: r.email,
        name: r.name,
        profileId: found.studentProfile.id,
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const { profileId } of enrolling) {
      await tx.studentEnrollment.create({
        data: {
          studentId: profileId,
          programId: program.id,
          cohortId: cohort?.id ?? null,
          createdById: actor.id,
        },
      });
    }
    for (const { email, name, folderUrl } of fresh) {
      const studentUser = await tx.user.create({
        data: {
          email,
          name,
          role: ROLES.STUDENT,
          status: USER_STATUS.ACTIVE,
        },
      });
      await tx.studentProfile.create({
        data: {
          userId: studentUser.id,
          folderUrl,
          createdById: actor.id,
          // The membership, made with the account. A student with a profile and
          // no enrollment is in no program: nobody administers them, no mentor
          // reaches them, and no list has anywhere to show them.
          enrollments: {
            create: {
              programId: program.id,
              cohortId: cohort?.id ?? null,
              createdById: actor.id,
            },
          },
        },
      });
    }
  });

  // Queued only now, with the accounts committed: a welcome for a student the
  // rollback erased must never leave (see the warning in lib/email/send.ts).
  // An existing student is welcomed to the new program too — it is news to
  // them, and the sign-in link in it is the one they already use.
  sendWelcomeEmails(
    [...fresh, ...enrolling].map(({ email, name }) =>
      welcomeMail({
        to: email,
        name,
        programLabel: enrollmentLabel(program.name, cohort?.name),
        occasion: "enrolled",
      })
    )
  );

  // The people already here are told, since a second program is a second set of
  // hours and deadlines to watch for.
  if (enrolling.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const { profileId } of enrolling) {
        const profile = await tx.studentProfile.findUnique({
          where: { id: profileId },
          select: { userId: true },
        });
        if (!profile) continue;
        await notify(tx, {
          to: [profile.userId],
          type: NOTIFICATION_TYPES.ENROLLMENT_MOVED,
          actorId: actor.id,
          href: notificationHref.studentHome(),
          message: `You were enrolled in ${enrollmentLabel(program.name, cohort?.name)}. Your time in your other programs is unchanged.`,
        });
      }
    });
  }

  const skipped = [...alreadyHere, ...notStudents, ...invalid, ...nameless];
  const added = fresh.length + enrolling.length;
  if (added === 0) {
    return {
      ok: false,
      error: `No students added. ${skipped.join(", ")}.`,
    };
  }

  revalidatePath("/", "layout");
  const alsoEnrolled =
    enrolling.length > 0
      ? ` ${enrolling.length} of them already had an account and ${enrolling.length === 1 ? "was" : "were"} enrolled alongside their other programs.`
      : "";
  return {
    ok: true,
    message:
      `${added} student${added === 1 ? "" : "s"} added to ${enrollmentLabel(program.name, cohort?.name)}.` +
      alsoEnrolled +
      ` They'll confirm their Telegram username when they first sign in.` +
      (emailConfigured()
        ? ` A welcome email is on its way to ${added === 1 ? "them" : "each of them"}.`
        : "") +
      (skipped.length > 0 ? ` Skipped: ${skipped.join(", ")}.` : ""),
  };
}

/**
 * Attach, replace, or clear a student's folder link after registration — for
 * students added before a folder existed, or when it moves. Same permissions
 * as creating the student: whoever administers their program. Submitting an
 * empty field removes the link.
 */
export async function setStudentFolder(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const profileId = String(formData.get("studentProfileId") ?? "");
  const profile = await prisma.studentProfile.findUnique({
    where: { id: profileId },
    include: { user: true, enrollments: { select: { programId: true } } },
  });
  if (!profile) return { ok: false, error: "Student not found." };

  const denied = await assertStudentScope(actor, profile);
  if (denied) return denied;

  const link = parseLinkField(formData.get("folderUrl"), "The folder link");
  if ("error" in link) return { ok: false, error: link.error };
  if (link.value === profile.folderUrl) {
    return { ok: true, message: "No change: that's already the folder link." };
  }

  await prisma.studentProfile.update({
    where: { id: profile.id },
    data: { folderUrl: link.value },
  });

  revalidatePath("/", "layout");
  const who = profile.user.name ?? profile.user.email;
  return {
    ok: true,
    message: link.value
      ? `Folder link saved for ${who} — their mentors can open it now.`
      : `Folder link removed for ${who}.`,
  };
}

/**
 * First sign-in step for staff-registered students: confirm full name and
 * Telegram username, completing the profile the staff member created.
 */
export async function completeStudentProfile(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor || actor.role !== ROLES.STUDENT) {
    return { ok: false, error: "Only students can complete this step." };
  }

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: actor.id },
  });
  if (!profile) {
    return { ok: false, error: "Complete your registration first." };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Enter your full name." };

  const telegram = parseTelegramField(formData.get("telegramUsername"));
  if ("error" in telegram) return { ok: false, error: telegram.error };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { name } });
    await tx.studentProfile.update({
      where: { id: profile.id },
      data: { telegramUsername: telegram.value },
    });
  });

  revalidatePath("/", "layout");
  redirect("/student");
}

/**
 * Self-signup step 2 (fallback for emails staff didn't pre-register): a
 * PENDING student picks their program (+ cohort where the program has them)
 * and confirms their name and Telegram username. Creates the profile and
 * notifies every admin that an approval is waiting.
 */
export async function completeOnboarding(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor || actor.role !== ROLES.STUDENT) {
    return { ok: false, error: "Only students can complete onboarding." };
  }

  const existingProfile = await prisma.studentProfile.findUnique({
    where: { userId: actor.id },
  });
  if (existingProfile) {
    return { ok: false, error: "Your registration is already submitted." };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Enter your full name." };

  const telegram = parseTelegramField(formData.get("telegramUsername"));
  if ("error" in telegram) return { ok: false, error: telegram.error };

  const enrollment = await resolveEnrollment(formData);
  if ("error" in enrollment) return { ok: false, error: enrollment.error };
  const { program, cohort } = enrollment;

  // The people who administer the program this student just picked — not
  // every admin in the school, most of whom cannot approve them anyway.
  const staff = await staffIdsFor(program.id);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.id },
      data: { name },
    });
    const created = await tx.studentProfile.create({
      data: {
        userId: actor.id,
        telegramUsername: telegram.value,
        createdById: actor.id,
        enrollments: {
          create: {
            programId: program.id,
            cohortId: cohort?.id ?? null,
            createdById: actor.id,
          },
        },
      },
    });
    await notify(tx, {
      to: staff,
      type: NOTIFICATION_TYPES.STUDENT_SIGNUP,
      actorId: actor.id,
      // Straight at the approval screen: a signup that needs approving should
      // be one click from the notice, not a search away.
      href: notificationHref.adminStudent(created.id),
      message: `${name} (${actor.email}) signed up for ${enrollmentLabel(program.name, cohort?.name)} and is awaiting approval.`,
    });
  });

  revalidatePath("/", "layout");
  redirect("/student");
}

/**
 * Correct the email a student signs in with (admin only). Their account, hours
 * and history all stay put — only the address changes. This is what makes an
 * imported student real: the tracking spreadsheet held no emails, so students
 * brought over from it carry a placeholder until someone fills the real one in,
 * and until then they cannot sign in at all. Replacing a placeholder also sends
 * the welcome email — this is the first moment the student can be told the
 * program tracks them here. A correction to an already-real address doesn't:
 * they were welcomed once.
 */
export async function setStudentEmail(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const profileId = String(formData.get("studentProfileId") ?? "");
  const profile = await prisma.studentProfile.findUnique({
    where: { id: profileId },
    include: {
      user: true,
      enrollments: { include: { program: true, cohort: true } },
    },
  });
  if (!profile) return { ok: false, error: "Student not found." };

  // Changing a login email hands somebody a working sign-in as that person,
  // which is why the same edit on a MENTOR is platform-admin-only: a mentor may
  // hold grants of their own, so taking their account can take programs with
  // it. A student holds none, so this edit reaches no further than the program
  // the editor already administers — and replacing an imported placeholder with
  // a real address is that program's own work to finish.
  const denied = await assertStudentScope(actor, profile);
  if (denied) return denied;

  const email = normalizeEmail(formData.get("email"));
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (email === profile.user.email) {
    return { ok: true, message: "No change: that's already their address." };
  }
  const taken = await prisma.user.findUnique({ where: { email } });
  if (taken) {
    return { ok: false, error: `${email} already has an account.` };
  }

  // A real address means the weekly summary email can reach them, so it goes back
  // to the app's default. A placeholder had it switched off on the way in.
  const reachable = !email.endsWith("@import.invalid");
  const firstRealAddress =
    reachable && profile.user.email.endsWith("@import.invalid");
  await prisma.user.update({
    where: { id: profile.userId },
    data: { email, ...(reachable ? { weeklyDigest: true } : {}) },
  });

  if (firstRealAddress) {
    sendWelcomeEmails([
      welcomeMail({
        to: email,
        name: profile.user.name,
        programLabel: enrollmentsLabel(profile.enrollments),
        occasion: "enrolled",
      }),
    ]);
  }

  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      `${profile.user.name ?? "This student"} now signs in with ${email}.` +
      (firstRealAddress && emailConfigured()
        ? " A welcome email is on its way to them."
        : ""),
  };
}

/**
 * Move ONE of a student's enrollments to a different program or cohort — the
 * correction for a mis-enrollment.
 *
 * It moves the membership and nothing else. Hours, sessions and tasks name the
 * program they belong to now, and they stay where they are: a student put in
 * the wrong program on Monday and moved on Tuesday has no history yet, and one
 * moved after six months of meetings must not have those meetings silently
 * reattributed to a program that never delivered them. Where history exists the
 * honest act is to enroll them in the new program and leave the old one
 * standing, which is what `enrollStudent` is for.
 *
 * A move onto a program the student is already in is refused rather than
 * merged — two enrollments cannot become one without deciding what happens to
 * two ledgers, and nobody asked for that.
 */
export async function moveStudent(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const profileId = String(formData.get("studentProfileId") ?? "");
  // Which enrollment is moving. Absent means the student has exactly one, and
  // the form did not have to ask.
  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();
  const profile = await prisma.studentProfile.findUnique({
    where: { id: profileId },
    include: {
      user: true,
      enrollments: { include: { program: true, cohort: true } },
    },
  });
  if (!profile) return { ok: false, error: "Student not found." };

  const from = enrollmentId
    ? profile.enrollments.find((e) => e.id === enrollmentId)
    : profile.enrollments.length === 1
      ? profile.enrollments[0]
      : undefined;
  if (!from) {
    return {
      ok: false,
      error:
        profile.enrollments.length > 1
          ? "Pick which program to move them out of."
          : "That enrollment isn't one of theirs.",
    };
  }

  // A move writes to two programs, so BOTH are gated. Gating only the
  // destination would let an admin of one program pull a student out of a
  // program they have no part in; gating only the source would let them push a
  // student into somebody else's.
  const deniedSource = await assertProgramScope(actor, from.programId);
  if (deniedSource) return deniedSource;

  const enrollment = await resolveEnrollment(formData);
  if ("error" in enrollment) return { ok: false, error: enrollment.error };
  const { program, cohort } = enrollment;

  const deniedTarget = await assertProgramScope(actor, program.id);
  if (deniedTarget) return deniedTarget;

  if (program.id === from.programId && (cohort?.id ?? null) === from.cohortId) {
    return { ok: true, message: "No change: they're already enrolled there." };
  }
  if (
    program.id !== from.programId &&
    profile.enrollments.some((e) => e.programId === program.id)
  ) {
    return {
      ok: false,
      error: `They are already in ${program.name}. Remove one of the two enrollments instead of merging them.`,
    };
  }

  const fromLabel = enrollmentLabel(from.program.name, from.cohort?.name);
  const to = enrollmentLabel(program.name, cohort?.name);

  await prisma.$transaction(async (tx) => {
    await tx.studentEnrollment.update({
      where: { id: from.id },
      data: { programId: program.id, cohortId: cohort?.id ?? null },
    });
    await notify(tx, {
      to: [profile.userId],
      type: NOTIFICATION_TYPES.ENROLLMENT_MOVED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `Your enrollment was moved from ${fromLabel} to ${to}. Your time and session history stayed with ${fromLabel}.`,
    });
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `${profile.user.name ?? profile.user.email} moved from ${fromLabel} to ${to}.`,
  };
}

/**
 * Add a program to a student who is already in one — the ordinary path through
 * this school, Global Admissions and then the Master's Program, and the reason
 * an enrollment is a row rather than a column.
 *
 * Gated on the TARGET program only. Enrolling somebody into a program you
 * administer is a decision about your own program, and requiring the source
 * program's blessing as well would mean an admin could not take a student the
 * other program's admin has no opinion about. What it does NOT grant is any new
 * reach over the student's existing programs — the ledger stays per program,
 * and `studentScope` still narrows what this admin can read.
 */
export async function enrollStudent(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const profileId = String(formData.get("studentProfileId") ?? "");
  const profile = await prisma.studentProfile.findUnique({
    where: { id: profileId },
    include: { user: true, enrollments: { select: { programId: true } } },
  });
  if (!profile) return { ok: false, error: "Student not found." };

  const enrollment = await resolveEnrollment(formData);
  if ("error" in enrollment) return { ok: false, error: enrollment.error };
  const { program, cohort } = enrollment;

  const denied = await assertProgramScope(actor, program.id);
  if (denied) return denied;

  if (profile.enrollments.some((e) => e.programId === program.id)) {
    return { ok: true, message: `They are already in ${program.name}.` };
  }

  const label = enrollmentLabel(program.name, cohort?.name);
  await prisma.$transaction(async (tx) => {
    await tx.studentEnrollment.create({
      data: {
        studentId: profile.id,
        programId: program.id,
        cohortId: cohort?.id ?? null,
        createdById: actor.id,
      },
    });
    await notify(tx, {
      to: [profile.userId],
      type: NOTIFICATION_TYPES.ENROLLMENT_MOVED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `You were enrolled in ${label}. Your time in your other programs is unchanged — this program grants its own.`,
    });
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `${profile.user.name ?? profile.user.email} is now in ${label}. Allocate their hours for it next.`,
  };
}

/**
 * Take a student out of ONE program, leaving the rest of their record alone.
 *
 * Refused once anything happened in that program. A session is history, and a
 * grant is a promise somebody made: removing the enrollment under either would
 * leave rows pointing at a program the student is no longer in, which every
 * list would then have to decide what to do with. Empty enrollments — the
 * mis-click, the student who never started — go quietly.
 *
 * Also refused for the LAST one. A student in no program is invisible: no
 * admin's scope contains them, no mentor reaches them, and no list can show
 * them to be put right. Deleting the student is the operation that means that,
 * and it is `deleteStudent`, which says so.
 */
export async function unenrollStudent(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const enrollmentId = String(formData.get("enrollmentId") ?? "");
  const enrollment = await prisma.studentEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      program: true,
      cohort: true,
      student: {
        include: { user: true, enrollments: { select: { id: true } } },
      },
    },
  });
  if (!enrollment) return { ok: false, error: "Enrollment not found." };

  const denied = await assertProgramScope(actor, enrollment.programId);
  if (denied) return denied;

  if (enrollment.student.enrollments.length === 1) {
    return {
      ok: false,
      error:
        "This is their only program, and a student has to be in one. Move them to another program, or delete the student.",
    };
  }

  const [sessions, allocations] = await Promise.all([
    prisma.session.count({
      where: { studentId: enrollment.studentId, programId: enrollment.programId },
    }),
    prisma.hourAllocation.count({
      where: { studentId: enrollment.studentId, programId: enrollment.programId },
    }),
  ]);
  if (sessions > 0) {
    return {
      ok: false,
      error: `They have logged sessions in ${enrollment.program.name}, so their place in it is history rather than a mistake. Void the sessions first if it truly must go.`,
    };
  }
  if (allocations > 0) {
    return {
      ok: false,
      error: `They still hold time in ${enrollment.program.name}. Remove those allocations first.`,
    };
  }

  const label = enrollmentLabel(enrollment.program.name, enrollment.cohort?.name);
  await prisma.$transaction(async (tx) => {
    // Nothing was logged and nothing was granted (both checked above), so the
    // only rows that can point at this program are tasks that were planned and
    // never started.
    await tx.assignment.deleteMany({
      where: { studentId: enrollment.studentId, programId: enrollment.programId },
    });
    await tx.studentEnrollment.delete({ where: { id: enrollment.id } });
    await notify(tx, {
      to: [enrollment.student.userId],
      type: NOTIFICATION_TYPES.ENROLLMENT_MOVED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `You were taken off ${label}. Your other programs are unchanged.`,
    });
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `${enrollment.student.user.name ?? enrollment.student.user.email} is no longer in ${label}.`,
  };
}

/**
 * Remove a student added by mistake (admin only). Blocked once any session
 * has been logged — at that point the record is history, not a typo; void
 * the sessions first if it truly must go.
 */
export async function deleteStudent(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const profileId = String(formData.get("studentProfileId") ?? "");
  const profile = await prisma.studentProfile.findUnique({
    where: { id: profileId },
    include: {
      user: true,
      enrollments: { select: { id: true, programId: true } },
      _count: { select: { sessions: true } },
    },
  });
  if (!profile) return { ok: false, error: "Student not found." };

  // Deleting the PERSON takes every program with them, so it is not enough to
  // administer one: an admin of Global Admissions must not be able to erase a
  // student's Master's Program record on their way past. Every program they are
  // in has to be one of yours.
  const denied = await assertStudentScope(actor, profile);
  if (denied) return denied;
  for (const e of profile.enrollments) {
    const outside = await assertProgramScope(actor, e.programId);
    if (outside) {
      return {
        ok: false,
        error:
          "They are also in a program you don't administer, so their record isn't yours to delete. Take them off your program instead.",
      };
    }
  }

  if (profile._count.sessions > 0) {
    return {
      ok: false,
      error:
        "This student has logged sessions, so their record can't be deleted.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.hourAllotmentChange.deleteMany({ where: { studentId: profile.id } });
    await tx.hourAllocation.deleteMany({ where: { studentId: profile.id } });
    // The tasks their time bought. Nothing was logged against them (no
    // sessions, checked above), so no delivered hours are at stake.
    await tx.assignment.deleteMany({ where: { studentId: profile.id } });
    await tx.mentorFeedback.deleteMany({ where: { studentId: profile.id } });
    await tx.notification.deleteMany({ where: { userId: profile.userId } });
    // Enrollments cascade with the profile (schema.prisma), so they are not
    // deleted here — naming them would only be a second place to keep in step.
    await tx.studentProfile.delete({ where: { id: profile.id } });
    await tx.user.delete({ where: { id: profile.userId } });
  });

  const back = profile.enrollments[0]?.programId;
  revalidatePath("/", "layout");
  redirect(back ? `/programs/${back}/students` : "/students");
}

/**
 * Approve a self-signed-up student (admin only). Activates the account;
 * hours are allocated separately, per mentor. Approval is their admission
 * into the program, so the welcome email goes out here — the in-app notice
 * alone reaches only students who happen to come back and check.
 */
export async function approveStudent(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const profileId = String(formData.get("studentProfileId") ?? "");
  const profile = await prisma.studentProfile.findUnique({
    where: { id: profileId },
    include: {
      user: true,
      enrollments: { include: { program: true, cohort: true } },
    },
  });
  if (!profile) return { ok: false, error: "Student not found." };

  const denied = await assertStudentScope(actor, profile);
  if (denied) return denied;

  if (profile.user.status !== USER_STATUS.PENDING) {
    return { ok: true, message: "This student is already approved." };
  }

  // Approval is of the ACCOUNT, so the sentence names every program they signed
  // up for rather than one an admin happens to be looking at.
  const programLabel = enrollmentsLabel(profile.enrollments);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: profile.userId },
      data: { status: USER_STATUS.ACTIVE },
    });
    await notify(tx, {
      to: [profile.userId],
      type: NOTIFICATION_TYPES.ACCOUNT_APPROVED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `Your registration for ${programLabel} was approved. You'll be notified as mentor hours are allocated to you.`,
    });
  });

  sendWelcomeEmails([
    welcomeMail({
      to: profile.user.email,
      name: profile.user.name,
      programLabel,
      occasion: "approved",
    }),
  ]);

  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      `${profile.user.name ?? profile.user.email} approved. Now allocate their mentor hours.` +
      (emailConfigured() ? " A welcome email is on its way to them." : ""),
  };
}

/**
 * Reject (delete) a PENDING self-signup — e.g. an unknown person or a typo
 * account. Only possible while nothing references the student yet.
 */
export async function rejectStudent(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const profileId = String(formData.get("studentProfileId") ?? "");
  const profile = await prisma.studentProfile.findUnique({
    where: { id: profileId },
    include: {
      user: true,
      enrollments: { select: { programId: true } },
      _count: { select: { sessions: true } },
    },
  });
  if (!profile) return { ok: false, error: "Student not found." };

  const denied = await assertStudentScope(actor, profile);
  if (denied) return denied;

  if (profile.user.status !== USER_STATUS.PENDING) {
    return { ok: false, error: "Only pending students can be rejected." };
  }
  if (profile._count.sessions > 0) {
    return { ok: false, error: "This student already has logged sessions." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.hourAllotmentChange.deleteMany({ where: { studentId: profile.id } });
    await tx.hourAllocation.deleteMany({ where: { studentId: profile.id } });
    await tx.assignment.deleteMany({ where: { studentId: profile.id } });
    await tx.mentorFeedback.deleteMany({ where: { studentId: profile.id } });
    await tx.notification.deleteMany({ where: { userId: profile.userId } });
    await tx.studentProfile.delete({ where: { id: profile.id } });
    await tx.user.delete({ where: { id: profile.userId } });
  });

  revalidatePath("/", "layout");
  return { ok: true, message: `${profile.user.email} rejected and removed.` };
}

/**
 * Set the hours a student holds with ONE mentor (spec §3 key rule: admin
 * only, always audited, always notifies the student), with the required
 * deadline the hours must be used by — once it passes, unused hours are
 * forfeited. The student's total allotment is derived as the sum of these
 * allocations; sessions logged by the mentor draw the allocation down toward 0.
 *
 * The mentor is OPTIONAL: with none named, the hours land in the student's
 * unassigned pool (the mentorId-null allocation) until an admin decides who
 * does the work. The task is optional too — a grant may name the piece of work
 * it's for, which becomes that mentor's task with these hours as its
 * budget (or, unassigned, a task waiting for a mentor). Naming a task that
 * is already open tops its budget up rather than adding a second row with the
 * same name. Corrections — a mistyped total, a new deadline, an amount paid —
 * need no task, since they grant nothing.
 */
export async function setMentorAllocation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const profileId = String(formData.get("studentProfileId") ?? "");
  // Empty = the unassigned pool: hours granted before a mentor is chosen.
  const mentorId = String(formData.get("mentorId") ?? "").trim() || null;
  // "set" replaces the allocation (a correction); "add" grants more hours on top
  // of whatever the student already holds with this mentor.
  const mode = String(formData.get("mode") ?? "set");
  const parsed = parseMinutesField(formData.get("minutes"), {
    min: 0,
    label: "Total hours",
  });
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const enteredHours = parsed.value;

  // Deadlines are required: once one passes, unused hours are forfeited.
  const parsedDeadline = parseDateField(formData.get("deadline"));
  if ("error" in parsedDeadline) {
    return { ok: false, error: "Pick a deadline for these hours." };
  }
  const enteredDeadline = parsedDeadline.value;

  const profile = await prisma.studentProfile.findUnique({
    where: { id: profileId },
    include: {
      user: true,
      enrollments: { include: { program: true } },
    },
  });
  if (!profile) return { ok: false, error: "Student not found." };

  // WHICH program these hours are granted in. A grant is program time: it has
  // that program's deadline, it appears in that program's totals, and only its
  // admins may touch it. The form names it; a student in exactly one program
  // has it filled in for them and is never asked.
  const enrolled = profile.enrollments.find(
    (e) => e.programId === String(formData.get("programId") ?? "").trim()
  );
  const target =
    enrolled ?? (profile.enrollments.length === 1 ? profile.enrollments[0] : null);
  if (!target) {
    return {
      ok: false,
      error:
        profile.enrollments.length > 1
          ? "Pick which program these hours are for."
          : "This student isn't in any program yet.",
    };
  }
  const program = target.program;

  // Gated on the TARGET program, not on "any program of theirs": an admin of
  // Global Admissions must not be able to grant, extend or re-date the time a
  // student holds in the Master's Program.
  const denied = await assertProgramScope(actor, program.id);
  if (denied) return denied;

  // Programs that bill per student also record what was paid. A column on the
  // program, not a comparison against its name: renaming a program must not
  // change what the app collects.
  const tracksPayment = program.tracksPayment;
  let enteredPaid: number | null = null;
  if (tracksPayment) {
    const raw = String(formData.get("amountPaid") ?? "").trim();
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: "Enter the amount paid (a number of 0 or more)." };
    }
    if (n > 10_000_000) {
      return { ok: false, error: "Amount paid is implausibly large." };
    }
    enteredPaid = Number(n.toFixed(2));
  }

  const mentor = mentorId
    ? await prisma.user.findUnique({ where: { id: mentorId } })
    : null;
  if (mentorId && (!mentor || !canActAsMentor(mentor))) {
    return { ok: false, error: "Pick a mentor." };
  }

  // Hours are granted from mentors within the student's program. If the
  // mentor isn't in the program yet (admin adding a fresh mentor to the
  // student), assign them program-wide as part of this action.
  const inProgram = mentorId
    ? await prisma.mentorAssignment.findFirst({
        where: { mentorId, programId: program.id },
      })
    : null;

  // The compound unique can't address the pool row (SQLite NULLs are distinct
  // there), so the pool is found by filter and kept single here — single PER
  // PROGRAM, since a student may hold unassigned time in each of theirs.
  const existing = mentorId
    ? await prisma.hourAllocation.findUnique({
        where: {
          studentId_programId_mentorId: {
            studentId: profile.id,
            programId: program.id,
            mentorId,
          },
        },
      })
    : await prisma.hourAllocation.findFirst({
        where: { studentId: profile.id, programId: program.id, mentorId: null },
      });
  const oldMinutes = existing?.minutes ?? 0;
  const newMinutes =
    mode === "add" ? Number((oldMinutes + enteredHours).toFixed(2)) : enteredHours;
  const granted = Number((newMinutes - oldMinutes).toFixed(2));

  // Every grant from one mentor lands in the same pool, which has one use-by
  // date, so topping up keeps whichever date is LATER: hours already granted
  // must never be quietly shortened by a top-up aimed at nearer work. The task
  // records the date this particular grant was aimed at.
  const deadline =
    mode === "add" && existing && existing.deadline > enteredDeadline
      ? existing.deadline
      : enteredDeadline;
  const oldDeadline = existing?.deadline ?? null;
  const sameDeadline = oldDeadline?.getTime() === deadline.getTime();

  // Money follows the hours: "add" records another payment on top of the total
  // already banked, "set" states the total outright. Non-Master's never touch it.
  const oldPaid = existing?.amountPaid ?? null;
  const newPaid = !tracksPayment
    ? null
    : mode === "add" && existing
      ? Number(((oldPaid ?? 0) + (enteredPaid ?? 0)).toFixed(2))
      : enteredPaid;
  const sameAmount = !tracksPayment || oldPaid === newPaid;

  if (newMinutes === oldMinutes && sameDeadline && sameAmount) {
    return { ok: true, message: "No change: allocation is already at that value." };
  }

  // A grant may say what the work is — and, if there is anything to say about
  // how to do it, what that is too. Hours with no task yet are fine: naming
  // the work can wait, just like naming the mentor.
  let task: string | null = null;
  let taskNote: string | null = null;
  if (granted > 0) {
    const parsedTask = parseOptionalTaskField(
      formData.get("task"),
      formData.get("taskCustom")
    );
    if ("error" in parsedTask) return { ok: false, error: parsedTask.error };
    task = parsedTask.value;

    const rawNote = String(formData.get("taskNote") ?? "").trim();
    if (rawNote.length > 500) {
      return { ok: false, error: "Keep the task note under 500 characters." };
    }
    taskNote = rawNote || null;
  }

  const mentorLabel = mentor ? (mentor.name ?? mentor.email) : null;
  const studentName = profile.user.name ?? profile.user.email;
  const deadlineNote = ` They must be used by ${formatDate(deadline)}.`;
  // Named only when it could be otherwise. A student in one program does not
  // need to be told which of their one programs the hours are for.
  const programNote =
    profile.enrollments.length > 1 ? ` in ${program.name}` : "";

  const taskOutcome = await prisma.$transaction(async (tx) => {
    // Bring the mentor into the program if they weren't already.
    if (mentorId && !inProgram) {
      await tx.mentorAssignment.create({
        data: { mentorId, programId: program.id, cohortId: null },
      });
      await notify(tx, {
        to: [mentorId],
        type: NOTIFICATION_TYPES.MENTOR_ASSIGNED,
        actorId: actor.id,
        href: notificationHref.mentorHome(),
        message: `You were assigned to ${program.name}. Set your booking link on your mentor page so students there can book you.`,
      });
    }
    // Update-by-id rather than upsert: the pool row (mentor null) can't be
    // addressed through the compound unique.
    if (existing) {
      await tx.hourAllocation.update({
        where: { id: existing.id },
        data: {
          minutes: newMinutes,
          deadline,
          // A new deadline restarts the reminder cycle.
          ...(sameDeadline ? {} : { deadlineStage: null }),
          ...(tracksPayment ? { amountPaid: newPaid } : {}),
        },
      });
    } else {
      await tx.hourAllocation.create({
        data: {
          studentId: profile.id,
          programId: program.id,
          mentorId,
          minutes: newMinutes,
          deadline,
          ...(tracksPayment ? { amountPaid: newPaid } : {}),
        },
      });
    }

    // The task these hours bought. Topping up an open one keeps the plan honest:
    // a second "Supplemental Essays" row would split the same work in two.
    let outcome: { task: string; budget: number; created: boolean } | null = null;
    if (task) {
      const open = await tx.assignment.findFirst({
        where: {
          studentId: profile.id,
          programId: program.id,
          mentorId,
          purpose: task,
          progress: { not: ASSIGNMENT_PROGRESS.DONE },
        },
        orderBy: { position: "asc" },
      });
      if (open) {
        const budget = Number(((open.minuteLimit ?? 0) + granted).toFixed(2));
        // A note written with a top-up is added to what the task already says,
        // since the earlier instruction is usually still true.
        const note =
          taskNote && !(open.note ?? "").includes(taskNote)
            ? [open.note, taskNote].filter(Boolean).join(" · ")
            : open.note;
        await tx.assignment.update({
          where: { id: open.id },
          data: { minuteLimit: budget, note },
        });
        // A raised budget can reopen work the old limit had finished.
        await syncGoalProgress(tx, open.id);
        outcome = { task, budget, created: false };
      } else {
        const last = await tx.assignment.findFirst({
          where: { studentId: profile.id },
          orderBy: { position: "desc" },
          select: { position: true },
        });
        await tx.assignment.create({
          data: {
            studentId: profile.id,
            programId: program.id,
            mentorId,
            purpose: task,
            minuteLimit: granted,
            note: taskNote,
            // The date THIS grant was aimed at, which the pooled use-by date
            // can outlive once other hours are added to the same mentor. A
            // real date, so the task can actually be overdue: this line used
            // to write formatDate() text into a free-text column, which is
            // how every task in the school arrived unreadable by a clock.
            dueOn: enteredDeadline,
            position: (last?.position ?? -1) + 1,
            createdById: actor.id,
          },
        });
        outcome = { task, budget: granted, created: true };
        if (mentorId) {
          await notify(tx, {
            to: [mentorId],
            type: NOTIFICATION_TYPES.GOAL_ASSIGNED,
            actorId: actor.id,
            href: notificationHref.mentorStudent(profile.id),
            message: `New task for ${studentName}: "${task}", budgeted ${formatDuration(granted)} to use by ${formatDate(enteredDeadline)}. Log your sessions against it.`,
          });
        }
      }
    }

    if (newMinutes !== oldMinutes) {
      const forTask = task ? ` for "${task}"` : "";
      if (mentorId) {
        await notify(tx, {
          to: [mentorId],
          type: NOTIFICATION_TYPES.HOURS_GRANTED,
          actorId: actor.id,
          href: notificationHref.mentorStudent(profile.id),
          message: `Your time with ${studentName} are now ${formatDuration(newMinutes)} (was ${formatDuration(oldMinutes)})${forTask}, to use by ${formatDate(deadline)}.`,
        });
      }
      await tx.hourAllotmentChange.create({
        data: {
          studentId: profile.id,
          programId: program.id,
          mentorId,
          changedById: actor.id,
          oldMinutes,
          newMinutes,
        },
      });
    }

    // "with Valera" when a mentor holds the hours; plain hours otherwise —
    // the student shouldn't have to know the pool exists.
    const withMentor = mentorLabel ? ` with ${mentorLabel}` : "";
    await notify(tx, {
      to: [profile.userId],
      type: NOTIFICATION_TYPES.HOURS_GRANTED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message:
        granted > 0
          ? `You were granted ${formatDuration(granted)} more hours${programNote}${withMentor}${task ? ` for "${task}"` : ""} (now ${formatDuration(newMinutes)}${mentorLabel ? " with them" : ""}).${deadlineNote}`
          : granted < 0
            ? `Your time${programNote}${withMentor} was adjusted from ${formatDuration(oldMinutes)} to ${formatDuration(newMinutes)}.${deadlineNote}`
            : `The deadline for your time${programNote}${withMentor} was updated to ${formatDate(deadline)}.`,
    });

    return outcome;
  });

  revalidatePath("/", "layout");
  const paidNote =
    tracksPayment && newPaid !== null ? ` · ${formatMoney(newPaid)} paid` : "";
  const taskSummary = taskOutcome
    ? taskOutcome.created
      ? mentorLabel
        ? ` "${taskOutcome.task}" is now on ${mentorLabel}'s list, budgeted ${formatDuration(taskOutcome.budget)}.`
        : ` "${taskOutcome.task}" is planned, budgeted ${formatDuration(taskOutcome.budget)} — pick its mentor from the task's ⋮ menu.`
      : ` "${taskOutcome.task}" is now budgeted ${formatDuration(taskOutcome.budget)}.`
    : "";
  return {
    ok: true,
    message: `${profile.user.email} now has ${formatDuration(newMinutes)} ${mentorLabel ? `with ${mentorLabel}` : "unassigned"}${programNote}, to use by ${formatDate(deadline)}${paidNote}.${taskSummary}`,
  };
}

/**
 * Remove a mentor from a student — deletes that per-mentor allocation, the tasks
 * those hours bought, and the audit rows (admin only, student notified). Blocked
 * once a session has been logged with the mentor: those hours were delivered and
 * are history, not a mistake to erase. The mentor keeps their program
 * assignment.
 */
export async function removeMentorAllocation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const profileId = String(formData.get("studentProfileId") ?? "");
  // Empty = the unassigned pool, which is removable the same way.
  const mentorId = String(formData.get("mentorId") ?? "").trim() || null;
  // Which program's grant. The row is per (student, program, mentor), so an
  // allocation cannot be addressed without it once the student is in two.
  const programId = String(formData.get("programId") ?? "").trim();

  const where = {
    studentId: profileId,
    mentorId,
    ...(programId ? { programId } : {}),
  };
  const matches = await prisma.hourAllocation.findMany({
    where,
    include: { program: true, student: { include: { user: true } }, mentor: true },
  });
  if (matches.length === 0) {
    return {
      ok: false,
      error: mentorId
        ? "That mentor isn't allocated to this student."
        : "This student has no unassigned time.",
    };
  }
  // Two grants and no program named: the form is out of date rather than the
  // request ambiguous, and removing "one of them" would be a coin toss.
  if (matches.length > 1) {
    return {
      ok: false,
      error: "Say which program's time to remove.",
    };
  }
  const allocation = matches[0];

  // The grant's OWN program decides this — not "any program the student is
  // in", which would let an admin of one program delete another program's time.
  const denied = await assertProgramScope(actor, allocation.programId);
  if (denied) return denied;

  // The pool has no sessions by construction — only mentors log them.
  if (mentorId) {
    const sessionCount = await prisma.session.count({
      where: { studentId: profileId, programId: allocation.programId, mentorId },
    });
    if (sessionCount > 0) {
      return {
        ok: false,
        error:
          "This mentor has logged sessions with the student, so their time can't be removed. Void the sessions first if it must go.",
      };
    }
  }

  const mentorLabel = allocation.mentor
    ? (allocation.mentor.name ?? allocation.mentor.email)
    : null;
  const scoped = { studentId: profileId, programId: allocation.programId, mentorId };
  await prisma.$transaction(async (tx) => {
    await tx.hourAllotmentChange.deleteMany({ where: scoped });
    // Their tasks go with their time: nothing was logged against them (no
    // sessions, checked above), and a task nobody holds hours for is a line the
    // mentor can't act on. Only this program's — the same mentor may hold
    // separate work for the same student elsewhere.
    await tx.assignment.deleteMany({ where: scoped });
    await tx.hourAllocation.delete({ where: { id: allocation.id } });
    await notify(tx, {
      to: [allocation.student.userId],
      type: NOTIFICATION_TYPES.HOURS_GRANTED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: mentorLabel
        ? `Your time with ${mentorLabel} in ${allocation.program.name} was removed. They're no longer one of your mentors there.`
        : `Your unassigned time in ${allocation.program.name} was removed.`,
    });
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: mentorLabel
      ? `${mentorLabel} removed from this student in ${allocation.program.name}, along with the tasks their time was for.`
      : `The unassigned time in ${allocation.program.name} was removed, along with the tasks it was for.`,
  };
}
