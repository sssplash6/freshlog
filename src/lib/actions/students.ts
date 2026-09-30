"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  assertProgramScope,
  assertStudentReach,
  assertStudentScope,
  staffLevel,
} from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { notify, notificationHref, staffIdsFor } from "@/lib/notify";
import {
  ASSIGNMENT_PROGRESS,
  canActAsMentor,
  CHARGED_SESSION,
  EXCHANGE_STATUS,
  NOTIFICATION_TYPES,
  PLACEHOLDER_EMAIL_DOMAIN,
  ROLES,
  USER_STATUS,
} from "@/lib/constants";
import { formatDate, formatDuration, formatMoney } from "@/lib/format";
import { syncGoalProgress } from "@/lib/goal-progress";
import { parseOptionalTaskField, TASK_BANK } from "@/lib/tasks";
import {
  EMAIL_RE,
  normalizeEmail,
  parseDateField,
  parseMinutesField,
  parseLinkField,
  parseNameField,
  type ActionState,
  parseTelegramField,
} from "@/lib/actions/shared";
import { emailConfigured } from "@/lib/email/send";
import { sendWelcomeEmails, welcomeMail } from "@/lib/email/welcome";
import { enrollmentsLabel } from "@/lib/enrollments";
import { allocatedUnder, ExchangeCapExceeded, openExchangeFrom } from "@/lib/exchanges";
import { deadlinePassed } from "@/lib/deadlines";
import { pastHours } from "@/lib/hours";
import { grantStandardHours } from "@/lib/standard-hours";
import { carryForward } from "@/lib/carry-forward";
import type { Cohort, Program } from "@/generated/prisma/client";

/** "Program" or "Program / Cohort" display label. */
function enrollmentLabel(programName: string, cohortName?: string | null) {
  return cohortName ? `${programName} / ${cohortName}` : programName;
}

/**
 * The sentence an action adds when the program's standard grant went out:
 * the admin should not have to open each student to learn that the hours are
 * already there. Empty when nobody got one.
 */
function standardNote(
  program: Pick<Program, "standardMinutes" | "standardDays">,
  granted: number,
  of: number
): string {
  if (granted === 0 || program.standardMinutes === null || program.standardDays === null) {
    return "";
  }
  const what = `${formatDuration(program.standardMinutes)} to use within ${program.standardDays} day${program.standardDays === 1 ? "" : "s"}`;
  if (granted === of) return of === 1 ? ` They have ${what}.` : ` Each has ${what}.`;
  return ` ${granted} of them ${granted === 1 ? "has" : "have"} ${what}.`;
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
 * here — an admin allocates them per mentor afterwards — except the program's
 * standard grant, when it has one (`grantStandardHours`). An optional
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
  //
  // The form asks for the two halves separately — a box labelled "First and
  // last name" is a box people put one word in — and they are joined here into
  // the one string `User.name` holds and `parseNameField` judges. A row with
  // only one half joins to one word and is refused by that same rule, which is
  // the rule the student themselves meets at first sign-in.
  const emails = formData.getAll("email").map((e) => normalizeEmail(e));
  const firsts = formData.getAll("firstName");
  const lasts = formData.getAll("lastName");
  const names = emails.map((_, i) =>
    [firsts[i], lasts[i]]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(" ")
  );
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
  // One rule for a name, the same one the person themselves is held to at
  // first sign-in: a roster of first names is a roster nobody can act on.
  const named = withFolders.map((r) => ({
    ...r,
    parsed: parseNameField(r.name, "their"),
  }));
  const nameless = named
    .filter((r) => EMAIL_RE.test(r.email) && "error" in r.parsed)
    .map((r) =>
      r.name
        ? `${r.email} (needs a first and last name)`
        : `${r.email} (no name)`
    );
  const valid = named.flatMap((r) =>
    EMAIL_RE.test(r.email) && "value" in r.parsed
      ? [{ email: r.email, name: r.parsed.value, folderUrl: r.folderUrl }]
      : []
  );

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

  // How many of them the program's standard grant reached: a student who
  // already held time here (none can, today, but the helper decides) is not.
  let standardGranted = 0;
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
      const made = await grantStandardHours(tx, {
        studentId: profileId,
        programId: program.id,
        actorId: actor.id,
      });
      if (made) standardGranted++;
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
      const created = await tx.studentProfile.create({
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
      const made = await grantStandardHours(tx, {
        studentId: created.id,
        programId: program.id,
        actorId: actor.id,
      });
      if (made) standardGranted++;
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
      standardNote(program, standardGranted, added) +
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
 * Correct a student's name — the one fact about them a MENTOR may change too.
 *
 * It was nobody's to change. A student typed their own name once at first
 * sign-in and staff typed it once on the roster form, and after that the app
 * had no way to fix a typo, a transliteration or a married surname: not on
 * the admin's Details panel, not anywhere. The name is on every chip, session
 * row, ledger line and booking card in the product, so a wrong one is wrong
 * in about forty places at once.
 *
 * `assertStudentReach` rather than `assertStudentScope`, because the mentor
 * who sits with the person every week is the one who finds out — see the note
 * on that gate for why a name is the only fact of a student's it opens.
 *
 * No notification. A spelling corrected is not news, and a mentor renaming a
 * student is not an act anybody needs telling about; the `HourAllotmentChange`
 * ledger exists for the writes that move time.
 */
export async function setStudentName(
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
  // "Not yours" and "does not exist" answer identically, so the refusal cannot
  // be used to find out which student ids are real.
  if (!profile) return { ok: false, error: "You don't work with that student." };

  const denied = await assertStudentReach(actor, profile);
  if (denied) return denied;

  const parsed = parseNameField(formData.get("name"), "their");
  if ("error" in parsed) return { ok: false, error: parsed.error };
  if (parsed.value === profile.user.name) {
    return { ok: true, message: "No change: that's already their name." };
  }

  await prisma.user.update({
    where: { id: profile.userId },
    data: { name: parsed.value },
  });

  // Their name labels them in every table and chip in the app.
  revalidatePath("/", "layout");
  return { ok: true, message: `Name saved: ${parsed.value}.` };
}

/**
 * The handle the team actually reaches a student on, corrected by staff.
 *
 * It was write-once and student-only: set at first sign-in and then read-only
 * on the admin's page forever. So a student who typed one character wrong was
 * unreachable and nobody could fix it, and a coordinator who already had the
 * handle in a spreadsheet had no way to put it in. `parseTelegramField` is the
 * same validator the student's own form uses, so one rule decides what a handle
 * is on both sides.
 */
export async function setStudentTelegram(
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

  const telegram = parseTelegramField(formData.get("telegramUsername"));
  if ("error" in telegram) return { ok: false, error: telegram.error };
  if (telegram.value === profile.telegramUsername) {
    return { ok: true, message: "No change: that's already their handle." };
  }

  await prisma.studentProfile.update({
    where: { id: profile.id },
    data: { telegramUsername: telegram.value },
  });

  revalidatePath("/", "layout");
  const who = profile.user.name ?? profile.user.email;
  return { ok: true, message: `Telegram saved for ${who}: @${telegram.value}.` };
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

  const parsed = parseNameField(formData.get("name"), "your");
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const name = parsed.value;

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

  const parsed = parseNameField(formData.get("name"), "your");
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const name = parsed.value;

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
  const reachable = !email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
  const firstRealAddress =
    reachable && profile.user.email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
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

  // A visit is not an enrollment, and moving one would silently turn it into
  // one: the cap, the sender and the use-by date all belong to the program the
  // student came from, and none of them survive being pointed somewhere else.
  if (from.exchangeId) {
    return {
      ok: false,
      error: `Their place in ${from.program.name} is an exchange, not an enrollment. Call the exchange off, or enroll them somewhere properly.`,
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

  // Leaving a program that has them out on exchange would strand the visit:
  // the sender would no longer be one of their programs. A cohort change inside
  // the same program leaves the sender where it was.
  if (program.id !== from.programId) {
    const lent = await openExchangeFrom(profile.id, from.programId);
    if (lent) {
      return {
        ok: false,
        error: `${from.program.name} has them out on exchange to ${lent.toProgram.name}. Return the exchange before moving them out of ${from.program.name}.`,
      };
    }
  }

  const fromLabel = enrollmentLabel(from.program.name, from.cohort?.name);
  const to = enrollmentLabel(program.name, cohort?.name);

  const studentName = profile.user.name ?? profile.user.email;
  const { granted, carried } = await prisma.$transaction(async (tx) => {
    await tx.studentEnrollment.update({
      where: { id: from.id },
      data: { programId: program.id, cohortId: cohort?.id ?? null },
    });
    // A move between two cohorts of the same program arrives nowhere new: no
    // standard grant, and nothing to carry.
    if (program.id === from.programId) {
      await notify(tx, {
        to: [profile.userId],
        type: NOTIFICATION_TYPES.ENROLLMENT_MOVED,
        actorId: actor.id,
        href: notificationHref.studentHome(),
        message: `Your enrollment was moved from ${fromLabel} to ${to}.`,
      });
      return { granted: null, carried: null };
    }
    // Arriving in a program is joining it, so its standard grant applies — and
    // first, so the time carried below tops it up instead of looking like a
    // grant the student already holds.
    const granted = await grantStandardHours(tx, {
      studentId: profile.id,
      programId: program.id,
      actorId: actor.id,
    });
    const carried = await carryForward(tx, {
      studentId: profile.id,
      fromProgramId: from.programId,
      toProgramId: program.id,
      actorId: actor.id,
    });
    await notify(tx, {
      to: [profile.userId],
      type: NOTIFICATION_TYPES.ENROLLMENT_MOVED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message:
        carried.minutes > 0
          ? `Your enrollment was moved from ${fromLabel} to ${to}. Your unused ${formatDuration(carried.minutes)} moved with you; your session history stayed with ${fromLabel}.`
          : `Your enrollment was moved from ${fromLabel} to ${to}. Your session history stayed with ${fromLabel}.`,
    });
    await notify(tx, {
      to: carried.mentorIds,
      type: NOTIFICATION_TYPES.HOURS_GRANTED,
      actorId: actor.id,
      href: notificationHref.mentorStudent(profile.id),
      message: `${studentName} moved from ${fromLabel} to ${to}. Your unused time with them moved too.`,
    });
    return { granted, carried };
  });

  revalidatePath("/", "layout");
  const carriedNote =
    carried && carried.minutes > 0
      ? ` ${formatDuration(carried.minutes)} of unused time moved with them` +
        (carried.tasks > 0
          ? `, along with ${carried.tasks === 1 ? "one untouched task" : `${carried.tasks} untouched tasks`}.`
          : ".")
      : "";
  return {
    ok: true,
    message:
      `${studentName} moved from ${fromLabel} to ${to}.` +
      carriedNote +
      standardNote(program, granted ? 1 : 0, 1),
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
  const granted = await prisma.$transaction(async (tx) => {
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
    return grantStandardHours(tx, {
      studentId: profile.id,
      programId: program.id,
      actorId: actor.id,
    });
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: granted
      ? `${profile.user.name ?? profile.user.email} is now in ${label}.${standardNote(program, 1, 1)}`
      : `${profile.user.name ?? profile.user.email} is now in ${label}. Allocate their hours for it next.`,
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
        include: {
          user: true,
          enrollments: { select: { id: true, exchangeId: true } },
        },
      },
    },
  });
  if (!enrollment) return { ok: false, error: "Enrollment not found." };

  const denied = await assertProgramScope(actor, enrollment.programId);
  if (denied) return denied;

  // An exchange comes off through the exchange, which tells the program that
  // sent them. Deleting the membership from under it would leave a placement
  // whose student is not there, and a sender who is never told.
  if (enrollment.exchangeId) {
    return {
      ok: false,
      error: `They are in ${enrollment.program.name} on an exchange. Return the exchange instead — the program that sent them is told either way.`,
    };
  }

  // Their own programs, which a visit is not. A student left holding nothing
  // but an exchange is a student who belongs nowhere the moment it ends — and
  // the row that would say so is in a program that is about to hand them back.
  const enrolled = enrollment.student.enrollments.filter((e) => !e.exchangeId);
  if (enrolled.length === 1) {
    return {
      ok: false,
      error:
        "This is their only program, and a student has to be in one. Move them to another program, or delete the student.",
    };
  }

  const lent = await openExchangeFrom(enrollment.studentId, enrollment.programId);
  if (lent) {
    return {
      ok: false,
      error: `${enrollment.program.name} has them out on exchange to ${lent.toProgram.name}. Return the exchange before removing them from ${enrollment.program.name}.`,
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
    // only rows that can point at this program are agenda items that were
    // planned and never started, and the tasks a mentor set them there. Both
    // go: a task in a program the student has left is work nobody can ask them
    // about, on a home page that no longer has the program on it.
    const scoped = {
      studentId: enrollment.studentId,
      programId: enrollment.programId,
    };
    await tx.assignment.deleteMany({ where: scoped });
    await tx.studentTask.deleteMany({ where: scoped });
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
  redirect(back ? `/programs/${back}` : "/students");
}

/**
 * Approve a self-signed-up student (admin only). Activates the account and
 * grants each program's standard hours, if it has them; anything else is
 * allocated separately, per mentor. Approval is their admission
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

  // The programs whose standard grant went out. Given here rather than at
  // sign-up: approval is when they are let in, so it is when the use-by clock
  // starts — a sign-up left in the queue for a month must not lose a month.
  const grantedIn = await prisma.$transaction(async (tx) => {
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
    const granted: Program[] = [];
    for (const e of profile.enrollments) {
      if (e.exchangeId) continue;
      const made = await grantStandardHours(tx, {
        studentId: profile.id,
        programId: e.programId,
        actorId: actor.id,
      });
      if (made) granted.push(e.program);
    }
    return granted;
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
      `${profile.user.name ?? profile.user.email} approved.` +
      (grantedIn.length === 0
        ? " Now allocate their mentor hours."
        : grantedIn.length === 1
          ? standardNote(grantedIn[0], 1, 1)
          : " Each of their programs' standard hours is in place.") +
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
  // The hour bank is picked as the agenda ("Hour bank", with a crown), but it
  // is not a piece of work: one balance per student per program that every
  // mentor's meeting draws, so it names no mentor and creates no task.
  const isBank =
    String(formData.get("task") ?? "") === TASK_BANK || formData.get("bank") === "1";
  // Empty = the unassigned pool: hours granted before a mentor is chosen.
  const mentorId = isBank ? null : String(formData.get("mentorId") ?? "").trim() || null;
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

  if (isBank) {
    if (!program.hourBank) {
      return { ok: false, error: `${program.name} doesn't use an hour bank.` };
    }
    // Admins only — the same reading of "admin" the rest of the app has:
    // leaders and sales staff of a program may see it, and may not change it.
    if ((await staffLevel(actor, program.id)) !== "ADMIN") {
      return { ok: false, error: "Only an admin of this program can change an hour bank." };
    }
  }
  // Only meaningful on the grant that CREATES the bank: is what was already
  // logged in this program taken out of it? Asked once, then it is history.
  const includePrevious = formData.get("includePrevious");

  // Programs that bill per student also record what was paid. A column on the
  // program, not a comparison against its name: renaming a program must not
  // change what the app collects. A bank program is the exception: its hours
  // are one balance, and nobody is asked what was paid for them.
  const tracksPayment = program.tracksPayment && !program.hourBank;
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
  // Time granted beside a bank would sit unspent: meetings draw the bank, not
  // the mentor's grant. Refuse it rather than strand the hours.
  if (
    !isBank &&
    (await prisma.hourAllocation.count({
      where: { studentId: profile.id, programId: program.id, isBank: true },
    })) > 0
  ) {
    return {
      ok: false,
      error: `This student's hours in ${program.name} are in an hour bank, which every meeting draws. Add to the bank instead.`,
    };
  }
  const existing = isBank
    ? await prisma.hourAllocation.findFirst({
        where: { studentId: profile.id, programId: program.id, isBank: true },
      })
    : mentorId
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
          where: {
            studentId: profile.id,
            programId: program.id,
            mentorId: null,
            isBank: false,
          },
        });
  // A NEW bank asks whether past hours are included — but only when there ARE
  // any. If so, the greater of what was allocated to mentors and what was
  // logged comes out of the bank: the logged hours are re-pointed at it below,
  // and any allocated hours nobody has used yet are taken off its total.
  const past =
    isBank && !existing ? await pastHours(prisma, profile.id, program.id) : null;
  const hasPast = !!past && (past.allocated > 0 || past.logged > 0);
  if (hasPast && includePrevious !== "yes" && includePrevious !== "no") {
    return {
      ok: false,
      error: "Say whether the past hours for this student are included in the bank.",
    };
  }
  const carried =
    hasPast && includePrevious === "yes" ? Math.max(0, past.allocated - past.logged) : 0;
  const oldMinutes = existing?.minutes ?? 0;
  const newMinutes = Number(
    ((mode === "add" ? oldMinutes + enteredHours : enteredHours) - carried).toFixed(2)
  );
  if (newMinutes < 0) {
    return {
      ok: false,
      error: `${formatDuration(carried)} of allocated past hours come out of this bank, which is more than the ${formatDuration(enteredHours)} being added.`,
    };
  }
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

  /**
   * A visitor's hours are capped by the program that lent them.
   *
   * The student is in this program on an exchange — another program promised
   * them a number of hours here and this program allocates them among its own
   * mentors. Two rules follow, and both are the sending program's to set: the
   * grants under it may not add up to more than was promised, and none of them
   * may outlive the placement's own use-by date. Time the sender did not
   * promise is time this program cannot grant on their behalf.
   *
   * Checked here and re-checked inside the transaction, where two admins
   * allocating at once cannot both pass a stale read.
   */
  const exchange = target.exchangeId
    ? await prisma.programExchange.findUnique({ where: { id: target.exchangeId } })
    : null;
  if (exchange && exchange.status === EXCHANGE_STATUS.OPEN) {
    const others = await allocatedUnder(prisma, exchange.id, existing?.id);
    if (others + newMinutes > exchange.minutes) {
      const spare = Math.max(0, exchange.minutes - others);
      return {
        ok: false,
        error: `This student is here on exchange for ${formatDuration(exchange.minutes)}, and ${formatDuration(others)} of it is already allocated. You can grant ${formatDuration(spare)}. Ask the sending program for more.`,
      };
    }
    if (deadline > exchange.deadline) {
      return {
        ok: false,
        error: `The exchange runs out on ${formatDate(exchange.deadline)}, so these hours can't be dated past it.`,
      };
    }
  }

  // A grant may say what the work is — and, if there is anything to say about
  // how to do it, what that is too. Hours with no task yet are fine: naming
  // the work can wait, just like naming the mentor.
  let task: string | null = null;
  let taskNote: string | null = null;
  if (granted > 0 && !isBank) {
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

  /**
   * The write, with the one refusal that can only be discovered inside it.
   *
   * `ExchangeCapExceeded` is thrown by the re-check in the transaction below,
   * where a second admin's concurrent grant is finally visible. Catching it
   * here turns it back into the sentence the pre-check would have said, so the
   * admin cannot tell which of the two checks caught them.
   */
  let taskOutcome: { task: string; budget: number; created: boolean } | null;
  try {
    taskOutcome = await prisma.$transaction(async (tx) => {
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
      // The cap again, from inside the transaction: the read above is stale the
      // moment a second admin allocates against the same exchange, and both of
      // them would otherwise pass a check neither of them was the last to make.
      if (exchange && exchange.status === EXCHANGE_STATUS.OPEN) {
        const others = await allocatedUnder(tx, exchange.id, existing?.id);
        if (others + newMinutes > exchange.minutes) {
          throw new ExchangeCapExceeded(
            Math.max(0, exchange.minutes - others),
            exchange.minutes
          );
        }
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
            // Late-stamped for a grant made before the exchange existed — the
            // enrollment says which placement this program's time belongs to.
            ...(exchange && !existing.exchangeId ? { exchangeId: exchange.id } : {}),
          },
        });
      } else {
        await tx.hourAllocation.create({
          data: {
            studentId: profile.id,
            programId: program.id,
            mentorId,
            isBank,
            minutes: newMinutes,
            deadline,
            ...(tracksPayment ? { amountPaid: newPaid } : {}),
            ...(exchange ? { exchangeId: exchange.id } : {}),
          },
        });
        // A NEW bank that includes what was logged before: those meetings now
        // draw it, and the per-mentor time they drew is folded in, since the
        // bank is stated as the student's whole balance and leaving both would
        // count the same hours twice. Each fold is audited; the money on those
        // rows is left where it was. A bank made without it starts full, and
        // the earlier meetings stay on the time they were logged against.
        if (isBank && hasPast && includePrevious === "yes") {
          await tx.session.updateMany({
            where: { studentId: profile.id, programId: program.id, withinPlan: true },
            data: { fromBank: true },
          });
          const folded = await tx.hourAllocation.findMany({
            where: {
              studentId: profile.id,
              programId: program.id,
              isBank: false,
              minutes: { gt: 0 },
            },
          });
          for (const row of folded) {
            await tx.hourAllocation.update({ where: { id: row.id }, data: { minutes: 0 } });
            await tx.hourAllotmentChange.create({
              data: {
                studentId: profile.id,
                programId: program.id,
                mentorId: row.mentorId,
                changedById: actor.id,
                oldMinutes: row.minutes,
                newMinutes: 0,
              },
            });
          }
        }
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
              message: `New task for ${studentName}: "${task}", ${formatDuration(granted)} to use by ${formatDate(enteredDeadline)}. Log your sessions against it.`,
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
        // The sender is waiting to hear that somebody here took it on. It is the
        // one thing they cannot see coming: they promised the hours and have no
        // say in who delivers them.
        if (exchange) {
          const held = (await allocatedUnder(tx, exchange.id)) + newMinutes - oldMinutes;
          await notify(tx, {
            to: [exchange.sentById],
            type: NOTIFICATION_TYPES.EXCHANGE_ALLOCATED,
            actorId: actor.id,
            href: notificationHref.adminStudent(profile.id),
            message: `${program.name} put ${formatDuration(newMinutes)} of ${studentName}'s exchange on ${mentorLabel ?? (isBank ? "their hour bank" : "nobody yet")} — ${formatDuration(held)} of ${formatDuration(exchange.minutes)} allocated.`,
          });
        }
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
            ? isBank
              ? `${formatDuration(granted)} were added to your hour bank${programNote} (now ${formatDuration(newMinutes)}${carried > 0 ? `, after ${formatDuration(carried)} of past hours` : ""}).${deadlineNote}`
              : `You were granted ${formatDuration(granted)} more hours${programNote}${withMentor}${task ? ` for "${task}"` : ""} (now ${formatDuration(newMinutes)}${mentorLabel ? " with them" : ""}).${deadlineNote}`
            : granted < 0
              ? `Your time${programNote}${withMentor} was adjusted from ${formatDuration(oldMinutes)} to ${formatDuration(newMinutes)}.${deadlineNote}`
              : `The deadline for your time${programNote}${withMentor} was updated to ${formatDate(deadline)}.`,
      });

      return outcome;
    });
  } catch (error) {
    if (error instanceof ExchangeCapExceeded) {
      return {
        ok: false,
        error: `This student is here on exchange, and the rest of their time was just allocated by somebody else. ${formatDuration(error.spare)} of the ${formatDuration(error.cap)} is left to give.`,
      };
    }
    throw error;
  }

  revalidatePath("/", "layout");
  const carriedNote =
    carried > 0
      ? ` ${formatDuration(carried)} of allocated past hours were taken out of it.`
      : "";
  const paidNote =
    tracksPayment && newPaid !== null ? ` · ${formatMoney(newPaid)} paid` : "";
  const taskSummary = taskOutcome
    ? taskOutcome.created
      ? mentorLabel
        ? ` "${taskOutcome.task}" is now on ${mentorLabel}'s list, ${formatDuration(taskOutcome.budget)}.`
        : ` "${taskOutcome.task}" is planned, ${formatDuration(taskOutcome.budget)} — pick its mentor from the task's ⋮ menu.`
      : ` "${taskOutcome.task}" now has ${formatDuration(taskOutcome.budget)}.`
    : "";
  return {
    ok: true,
    message: `${profile.user.email} now has ${formatDuration(newMinutes)} ${mentorLabel ? `with ${mentorLabel}` : isBank ? "in their hour bank" : "unassigned"}${programNote}, to use by ${formatDate(deadline)}${paidNote}.${carriedNote}${taskSummary}`,
  };
}

/**
 * Remove a mentor from a student — deletes that per-mentor allocation and the
 * tasks those hours bought, and appends a terminal change row to the audit
 * trail so History still says where the hours went (admin only, student
 * notified). Blocked once a session has been logged with the mentor: those
 * hours were delivered and are history, not a mistake to erase. The mentor
 * keeps their program assignment.
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

  // The hour bank is removed the same way but is its own row: it has no mentor
  // like the pool, and must never be found by "the pool" or take it with it.
  const removingBank = formData.get("bank") === "1";
  const where = {
    studentId: profileId,
    mentorId,
    isBank: removingBank,
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

  if (removingBank) {
    if ((await staffLevel(actor, allocation.programId)) !== "ADMIN") {
      return { ok: false, error: "Only an admin of this program can change an hour bank." };
    }
    const drawn = await prisma.session.count({
      where: { studentId: profileId, programId: allocation.programId, fromBank: true },
    });
    if (drawn > 0) {
      return {
        ok: false,
        error:
          "Meetings have been logged against this hour bank, so it can't be removed. Void them first if it must go.",
      };
    }
  }
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
    // The grant goes; its history does not. Removal is a change like any
    // other, so it is written as one — a terminal row down to zero keeps the
    // History disclosure honest about where the hours went instead of
    // quietly dropping every row that mentioned them.
    if (allocation.minutes > 0) {
      await tx.hourAllotmentChange.create({
        data: {
          studentId: profileId,
          programId: allocation.programId,
          mentorId,
          changedById: actor.id,
          oldMinutes: allocation.minutes,
          newMinutes: 0,
        },
      });
    }
    // Their tasks go with their time: nothing was logged against them (no
    // sessions, checked above), and a task nobody holds hours for is a line the
    // mentor can't act on. Only this program's — the same mentor may hold
    // separate work for the same student elsewhere. A bank bought no tasks, and
    // "mentor null" here would be every unassigned task the student has.
    if (!removingBank) await tx.assignment.deleteMany({ where: scoped });
    await tx.hourAllocation.delete({ where: { id: allocation.id } });
    await notify(tx, {
      to: [allocation.student.userId],
      type: NOTIFICATION_TYPES.HOURS_GRANTED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: mentorLabel
        ? `Your time with ${mentorLabel} in ${allocation.program.name} was removed. They're no longer one of your mentors there.`
        : removingBank
          ? `Your hour bank in ${allocation.program.name} was removed.`
          : `Your unassigned time in ${allocation.program.name} was removed.`,
    });
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: mentorLabel
      ? `${mentorLabel} removed from this student in ${allocation.program.name}, along with the tasks their time was for.`
      : removingBank
        ? `The hour bank in ${allocation.program.name} was removed.`
        : `The unassigned time in ${allocation.program.name} was removed, along with the tasks it was for.`,
  };
}

/** Thrown inside the transfer's transaction when a session logged meanwhile
 *  has spent minutes the pre-check thought were free. */
class TransferExceedsBalance extends Error {
  constructor(readonly spare: number) {
    super("transfer exceeds the unused balance");
  }
}

/**
 * Move unused time a student holds with one mentor to another mentor in the
 * same program — what happens when a student changes mentors partway through.
 *
 * Before this existed the only tools were "grant" and "correct", so a hand-over
 * was a grant to the new mentor that nobody remembered to pair with a cut to
 * the old one, and the student showed up holding both. A transfer is the two
 * halves as one write: the source goes down by exactly what the target goes up,
 * each half is audited, and all three people are told.
 *
 * Only UNUSED minutes move. What the old mentor already delivered is history
 * and stays theirs, and hours past their deadline are forfeited, not
 * transferable. Everything stays inside the one program: the key is
 * `(student, program, mentor)`, and a transfer across programs would spend one
 * program's grant in another.
 *
 * The rules `setMentorAllocation` holds hold here too: admin scope on the
 * grant's own program, and nobody moves hours to or from themselves.
 */
export async function transferMentorAllocation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const profileId = String(formData.get("studentProfileId") ?? "");
  const programId = String(formData.get("programId") ?? "").trim();
  // Empty = the unassigned pool, which can hand its time to a mentor as well.
  const fromMentorId = String(formData.get("fromMentorId") ?? "").trim() || null;
  const toMentorId = String(formData.get("toMentorId") ?? "").trim();
  const moveTasks = formData.get("moveTasks") === "on";

  const parsed = parseMinutesField(formData.get("minutes"), {
    min: 1,
    label: "Minutes to move",
  });
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const minutes = parsed.value;

  if (!toMentorId) return { ok: false, error: "Pick the mentor to move the time to." };
  if (toMentorId === fromMentorId) {
    return { ok: false, error: "Pick a different mentor — that one already holds this time." };
  }

  const source = await prisma.hourAllocation.findFirst({
    where: { studentId: profileId, programId, mentorId: fromMentorId, isBank: false },
    include: { program: true, student: { include: { user: true } }, mentor: true },
  });
  // "Not yours" and "does not exist" answer the same, before the gate as after.
  if (!source) return { ok: false, error: "That allocation no longer exists." };
  const denied = await assertProgramScope(actor, source.programId);
  if (denied) return { ok: false, error: "That allocation no longer exists." };

  if (fromMentorId === actor.id || toMentorId === actor.id) {
    return {
      ok: false,
      error: "Your own hours are moved by another admin — not by you.",
    };
  }

  const target = await prisma.user.findUnique({ where: { id: toMentorId } });
  if (!target || !canActAsMentor(target)) return { ok: false, error: "Pick a mentor." };

  if (deadlinePassed(source.deadline)) {
    return {
      ok: false,
      error: `These hours expired on ${formatDate(source.deadline)}, so there is nothing left to move.`,
    };
  }

  const program = source.program;
  const studentName = source.student.user.name ?? source.student.user.email;
  const fromLabel = source.mentor
    ? (source.mentor.name ?? source.mentor.email)
    : null;
  const toLabel = target.name ?? target.email;

  /** Minutes the source still holds unspent, read through `db`. */
  const spareIn = async (db: Pick<typeof prisma, "hourAllocation" | "session">) => {
    const row = await db.hourAllocation.findUnique({ where: { id: source.id } });
    if (!row) return { row: null, spare: 0 };
    if (!fromMentorId) return { row, spare: row.minutes };
    const used = await db.session.aggregate({
      where: { studentId: profileId, programId, mentorId: fromMentorId, ...CHARGED_SESSION },
      _sum: { minutes: true },
    });
    return { row, spare: Math.max(0, row.minutes - (used._sum.minutes ?? 0)) };
  };

  const before = await spareIn(prisma);
  if (minutes > before.spare) {
    return {
      ok: false,
      error:
        before.spare === 0
          ? `${fromLabel ?? "The unassigned time"} has no unused time to move.`
          : `Only ${formatDuration(before.spare)} is unused — that is the most you can move.`,
    };
  }

  const inProgram = await prisma.mentorAssignment.findFirst({
    where: { mentorId: toMentorId, programId },
  });

  let tasksMoved = 0;
  try {
    await prisma.$transaction(async (tx) => {
      // Again from inside the transaction: a session logged since the check
      // above may have spent part of what we were about to move.
      const { row, spare } = await spareIn(tx);
      if (!row || minutes > spare) throw new TransferExceedsBalance(spare);

      const dest = await tx.hourAllocation.findUnique({
        where: {
          studentId_programId_mentorId: {
            studentId: profileId,
            programId,
            mentorId: toMentorId,
          },
        },
      });

      // Money follows the hours in the programs that bill for them, in the
      // same proportion — otherwise the old mentor's row would read as paid
      // for time it no longer holds.
      const paidMoved =
        program.tracksPayment && row.amountPaid != null && row.minutes > 0
          ? Number(((row.amountPaid * minutes) / row.minutes).toFixed(2))
          : null;

      await tx.hourAllocation.update({
        where: { id: row.id },
        data: {
          minutes: row.minutes - minutes,
          ...(paidMoved != null
            ? { amountPaid: Number(((row.amountPaid ?? 0) - paidMoved).toFixed(2)) }
            : {}),
        },
      });

      const destOld = dest?.minutes ?? 0;
      if (dest) {
        // The later of the two dates, as a top-up keeps: hours already held
        // are never shortened by the ones arriving.
        const deadline = dest.deadline > row.deadline ? dest.deadline : row.deadline;
        await tx.hourAllocation.update({
          where: { id: dest.id },
          data: {
            minutes: destOld + minutes,
            deadline,
            ...(deadline.getTime() !== dest.deadline.getTime() ? { deadlineStage: null } : {}),
            ...(paidMoved != null
              ? { amountPaid: Number(((dest.amountPaid ?? 0) + paidMoved).toFixed(2)) }
              : {}),
            ...(row.exchangeId && !dest.exchangeId ? { exchangeId: row.exchangeId } : {}),
          },
        });
      } else {
        await tx.hourAllocation.create({
          data: {
            studentId: profileId,
            programId,
            mentorId: toMentorId,
            minutes,
            deadline: row.deadline,
            ...(paidMoved != null ? { amountPaid: paidMoved } : {}),
            // Still the same placement's time: moving it between the host
            // program's mentors does not change what it was lent under.
            ...(row.exchangeId ? { exchangeId: row.exchangeId } : {}),
          },
        });
      }

      if (!inProgram) {
        await tx.mentorAssignment.create({
          data: { mentorId: toMentorId, programId, cohortId: null },
        });
      }

      await tx.hourAllotmentChange.createMany({
        data: [
          {
            studentId: profileId,
            programId,
            mentorId: fromMentorId,
            changedById: actor.id,
            oldMinutes: row.minutes,
            newMinutes: row.minutes - minutes,
          },
          {
            studentId: profileId,
            programId,
            mentorId: toMentorId,
            changedById: actor.id,
            oldMinutes: destOld,
            newMinutes: destOld + minutes,
          },
        ],
      });

      // The open work goes with the time when the admin asks: the new mentor
      // logs against it, and the old one stops seeing it on their list.
      // Finished tasks stay where they were done.
      if (moveTasks) {
        const moved = await tx.assignment.updateMany({
          where: {
            studentId: profileId,
            programId,
            mentorId: fromMentorId,
            progress: { not: ASSIGNMENT_PROGRESS.DONE },
          },
          data: { mentorId: toMentorId },
        });
        tasksMoved = moved.count;
      }

      const taskNote =
        tasksMoved > 0
          ? ` ${tasksMoved === 1 ? "One open task" : `${tasksMoved} open tasks`} moved with it.`
          : "";
      await notify(tx, {
        to: fromMentorId ? [fromMentorId] : [],
        type: NOTIFICATION_TYPES.HOURS_GRANTED,
        actorId: actor.id,
        href: notificationHref.mentorStudent(profileId),
        message: `${formatDuration(minutes)} of your time with ${studentName} moved to ${toLabel}. You now hold ${formatDuration(row.minutes - minutes)} with them.${taskNote}`,
      });
      await notify(tx, {
        to: [toMentorId],
        type: NOTIFICATION_TYPES.HOURS_GRANTED,
        actorId: actor.id,
        href: notificationHref.mentorStudent(profileId),
        message: `${formatDuration(minutes)} of ${studentName}'s time moved to you${fromLabel ? ` from ${fromLabel}` : ""}. You now hold ${formatDuration(destOld + minutes)} with them.${taskNote}`,
      });
      await notify(tx, {
        to: [source.student.userId],
        type: NOTIFICATION_TYPES.HOURS_GRANTED,
        actorId: actor.id,
        href: notificationHref.studentHome(),
        message: `${formatDuration(minutes)} of your time${fromLabel ? ` with ${fromLabel}` : ""} moved to ${toLabel}. Your total hours are the same.`,
      });
    });
  } catch (error) {
    if (error instanceof TransferExceedsBalance) {
      return {
        ok: false,
        error: `A session was just logged against this time. ${formatDuration(error.spare)} is unused now — move that or less.`,
      };
    }
    throw error;
  }

  revalidatePath("/", "layout");
  const taskSummary =
    tasksMoved > 0
      ? ` ${tasksMoved === 1 ? "Their open task went" : `${tasksMoved} open tasks went`} with it.`
      : "";
  return {
    ok: true,
    message: `Moved ${formatDuration(minutes)} from ${fromLabel ?? "the unassigned time"} to ${toLabel} in ${program.name}.${taskSummary}`,
  };
}
