"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  adminWriteScope,
  assertPlatformAdmin,
  assertProgramScope,
  scopeCovers,
} from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { notify, notificationHref } from "@/lib/notify";
import {
  canActAsMentor,
  NOTIFICATION_TYPES,
  ROLES,
  USER_STATUS,
} from "@/lib/constants";
import {
  EMAIL_RE,
  normalizeEmail,
  parseNameField,
  type ActionState,
} from "@/lib/actions/shared";
import { claimEmail, removeStub } from "@/lib/sign-up-stub";

/**
 * Self-signup step 2 for mentors: capture the full name Google didn't supply,
 * so mentors are labeled by name rather than email everywhere they appear.
 */
export async function completeMentorProfile(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor || !canActAsMentor(actor)) {
    return { ok: false, error: "Only mentors can complete this step." };
  }

  const parsed = parseNameField(formData.get("name"), "your");
  if ("error" in parsed) return { ok: false, error: parsed.error };

  await prisma.user.update({
    where: { id: actor.id },
    data: { name: parsed.value },
  });

  revalidatePath("/", "layout");
  redirect("/mentor");
}

/**
 * Resolve a "p:<programId>" / "l:<levelId>" / "c:<cohortId>" assignment target
 * to the program + optional level + optional cohort it names, with a display
 * label. A level pairing covers every cohort under it; a cohort pairing is
 * the narrowest and carries no levelId — its cohort names the level.
 */
async function resolveAssignmentTarget(target: string) {
  const [kind, targetId] = target.split(":");
  if (kind === "c") {
    const cohort = await prisma.cohort.findUnique({
      where: { id: targetId },
      include: { program: true, level: true },
    });
    if (!cohort) return null;
    return {
      programId: cohort.programId,
      levelId: null,
      cohortId: cohort.id,
      label: cohort.level
        ? `${cohort.program.name} / ${cohort.level.name} / ${cohort.name}`
        : `${cohort.program.name} / ${cohort.name}`,
    };
  }
  if (kind === "l") {
    const level = await prisma.programLevel.findUnique({
      where: { id: targetId },
      include: { program: true },
    });
    if (!level) return null;
    return {
      programId: level.programId,
      levelId: level.id,
      cohortId: null,
      label: `${level.program.name} / ${level.name}`,
    };
  }
  if (kind === "p") {
    const program = await prisma.program.findUnique({
      where: { id: targetId },
    });
    if (!program) return null;
    return {
      programId: program.id,
      levelId: null,
      cohortId: null,
      label: program.name,
    };
  }
  return null;
}

/** Resolve every checked "p:"/"l:"/"c:" target; null if any fails to resolve. */
async function resolveAssignmentTargets(raw: FormDataEntryValue[]) {
  const targets = await Promise.all(
    raw.map((value) => resolveAssignmentTarget(String(value)))
  );
  if (targets.some((t) => !t)) return null;
  // Deduplicate identical targets (same program + level + cohort pairing).
  const seen = new Set<string>();
  return (targets as NonNullable<(typeof targets)[number]>[]).filter((t) => {
    const key = `${t.programId}:${t.levelId ?? ""}:${t.cohortId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Admin registers a mentor directly (the mentor pool is small): email, first
 * and last name, and every program — or cohort, where the program has them — they
 * work in. The mentor then signs in with Google and sets their own booking
 * links.
 */
export async function createMentor(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const email = normalizeEmail(formData.get("email"));
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  // Asked for as two halves and joined into the one string `User.name` holds,
  // as `addStudents` does; one half alone is one word and refused below.
  const joined = [formData.get("firstName"), formData.get("lastName")]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const parsed = parseNameField(joined, "the mentor's");
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const name = parsed.value;

  const targets = await resolveAssignmentTargets(formData.getAll("targets"));
  if (!targets || targets.length === 0) {
    return { ok: false, error: "Pick at least one program or cohort." };
  }
  // Every target, not the first: registering a mentor writes all of them in
  // one go, so a single program outside the scope would place them where this
  // admin cannot follow.
  for (const target of targets) {
    const denied = await assertProgramScope(actor, target.programId);
    if (denied) return denied;
  }

  const done = await registerMentor(actor, email, name, targets);
  if (!done.ok) return done;

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `Mentor ${name} (${email}) registered in ${done.labels}. They can sign in with Google right away and set their booking links.`,
  };
}

type Target = NonNullable<Awaited<ReturnType<typeof resolveAssignmentTargets>>>[number];

/**
 * One mentor's account and pairings, once the caller has checked the address,
 * the name and that the actor may place them in every target. Shared by the
 * one-at-a-time form and the list, so a mentor registered from a pasted list
 * is the same account, greeted the same way.
 */
async function registerMentor(
  actor: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  email: string,
  name: string,
  targets: readonly Target[]
): Promise<{ ok: true; labels: string } | { ok: false; error: string }> {
  // Somebody who tried to sign in before being registered is a PENDING student
  // on this address, on no roster an admin could remove them from — and the
  // mentor picker never lists a student, so they could not be found to assign
  // either. That stub is absorbed; a real account on the address still refuses,
  // and says what it is.
  const claim = await claimEmail(actor, email, "");
  if ("error" in claim) {
    const holder = await prisma.user.findUnique({ where: { email } });
    if (holder && canActAsMentor(holder)) {
      return {
        ok: false,
        error: `${email} is already a mentor. Open them under Mentors to add programs.`,
      };
    }
    if (holder?.role === ROLES.STUDENT) {
      return {
        ok: false,
        error: `${email} is already a student here, so they can't be registered as a mentor.`,
      };
    }
    return { ok: false, error: claim.error };
  }
  const { stub } = claim;

  const labels = targets.map((t) => t.label).join(", ");
  await prisma.$transaction(async (tx) => {
    if (stub) await removeStub(tx, stub);
    const mentor = await tx.user.create({
      data: {
        email,
        name,
        role: ROLES.MENTOR,
        status: USER_STATUS.ACTIVE,
      },
    });
    await tx.mentorAssignment.createMany({
      data: targets.map((t) => ({
        mentorId: mentor.id,
        programId: t.programId,
        levelId: t.levelId,
        cohortId: t.cohortId,
      })),
    });
    // Greets them on first sign-in.
    await notify(tx, {
      to: [mentor.id],
      type: NOTIFICATION_TYPES.MENTOR_ASSIGNED,
      actorId: actor.id,
      href: notificationHref.mentorHome(),
      message: `You were registered as a mentor in ${labels}. Set your booking link on your mentor page so students there can book you.`,
    });
  });

  return { ok: true, labels };
}

/**
 * Admin registers a LIST of mentors into the same programs at once — a new
 * intake of mentors pasted from a spreadsheet or imported from a file. Each
 * row is registered exactly as `createMentor` registers one; a row that cannot
 * be (a bad address, one name, somebody already here) is skipped and named,
 * and the rest still go in. The programs are checked once, before any row.
 */
export async function createMentors(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const targets = await resolveAssignmentTargets(formData.getAll("targets"));
  if (!targets || targets.length === 0) {
    return { ok: false, error: "Pick at least one program or cohort." };
  }
  for (const target of targets) {
    const denied = await assertProgramScope(actor, target.programId);
    if (denied) return denied;
  }

  const emails = formData.getAll("email").map((e) => normalizeEmail(e));
  const firsts = formData.getAll("firstName");
  const lasts = formData.getAll("lastName");
  const seen = new Set<string>();
  const rows = emails
    .map((email, i) => ({
      email,
      joined: [firsts[i], lasts[i]]
        .map((part) => String(part ?? "").trim())
        .filter(Boolean)
        .join(" "),
    }))
    .filter((r) => r.email && !seen.has(r.email) && (seen.add(r.email), true));
  if (rows.length === 0) return { ok: false, error: "Enter at least one mentor email." };

  const added: string[] = [];
  const skipped: string[] = [];
  let labels = "";
  // One at a time, each in its own transaction: one address already taken
  // must not undo the twenty registered beside it.
  for (const r of rows) {
    if (!EMAIL_RE.test(r.email)) {
      skipped.push(`${r.email} (not a valid email)`);
      continue;
    }
    const parsed = parseNameField(r.joined, "the mentor's");
    if ("error" in parsed) {
      skipped.push(`${r.email} (${r.joined ? "needs a first and last name" : "no name"})`);
      continue;
    }
    const done = await registerMentor(actor, r.email, parsed.value, targets);
    if (done.ok) {
      added.push(parsed.value);
      labels = done.labels;
    } else {
      skipped.push(`${r.email} (${done.error.replace(`${r.email} `, "").replace(/\.$/, "")})`);
    }
  }

  if (added.length > 0) revalidatePath("/", "layout");
  if (added.length === 0) {
    return { ok: false, error: `No mentors registered. Skipped: ${skipped.join("; ")}.` };
  }
  const head = `${added.length} mentor${added.length === 1 ? "" : "s"} registered in ${labels}. They can sign in with Google right away.`;
  return {
    ok: true,
    message: skipped.length > 0 ? `${head} Skipped: ${skipped.join("; ")}.` : head,
  };
}

/**
 * Admin edits a mentor: name, sign-in email, and the full set of
 * program/cohort assignments (checked = assigned). The booking links on
 * pairings that survive the edit are kept; the mentor sets those themselves
 * (spec §8). Unchecking every target parks the mentor as UNASSIGNED again;
 * a first assignment activates them.
 *
 * "The full set" is the full set this admin can SEE — the pairings whose
 * program they hold. The two identity fields are stricter still; the comment
 * on them says why.
 */
export async function updateMentor(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const mentorId = String(formData.get("mentorId") ?? "");
  const mentor = await prisma.user.findUnique({
    where: { id: mentorId },
    include: { mentorAssignments: true },
  });
  if (!mentor || !canActAsMentor(mentor)) {
    return { ok: false, error: "Mentor not found." };
  }
  // A dual-role admin stays ADMIN/ACTIVE — assignments don't gate their status.
  const isPureMentor = mentor.role === ROLES.MENTOR;

  const parsed = parseNameField(formData.get("name"), "the mentor's");
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const name = parsed.value;
  const email = normalizeEmail(formData.get("email"));
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  /**
   * Who a mentor IS is platform-only; where they work is not.
   *
   * Admins are peers now — one set per program instead of one set over
   * everything — and a mentor is very often a dual-role admin. Whoever can
   * change this email address can point another admin's sign-in at a mailbox
   * they own and then be them, so the edit belongs to the people who can
   * already grant themselves anything. It is the two fields and not the whole
   * action, because assignments are exactly what a program's admin is here to
   * edit, and taking those away would leave them nothing to save.
   *
   * The form posts both fields back untouched on every save, so the question
   * is whether they MOVED, not whether they were submitted.
   */
  const detailsChanged = name !== mentor.name || email !== mentor.email;
  if (detailsChanged) {
    const denied = assertPlatformAdmin(actor);
    if (denied) return denied;
  }

  // A mentor whose address was wrong has usually signed in with the right one
  // already, and landed as a pending student on it. That stub goes; a real
  // account on the address still refuses.
  const claim = await claimEmail(actor, email, mentorId);
  if ("error" in claim) return { ok: false, error: claim.error };
  const { stub } = claim;

  const targets = await resolveAssignmentTargets(formData.getAll("targets"));
  if (!targets) return { ok: false, error: "Pick a program or cohort." };

  const wanted = new Set(
    targets.map((t) => `${t.programId}:${t.levelId ?? ""}:${t.cohortId ?? ""}`)
  );
  const toCreate = targets.filter(
    (t) =>
      !mentor.mentorAssignments.some(
        (a) =>
          a.programId === t.programId &&
          (a.levelId ?? null) === t.levelId &&
          a.cohortId === t.cohortId
      )
  );
  for (const target of toCreate) {
    const denied = await assertProgramScope(actor, target.programId);
    if (denied) return denied;
  }
  // Unticked only counts where a box was. The picker is built from this
  // admin's own programs, so a pairing in a program they don't hold draws no
  // row and no chip — and yet "Clear" drops it from the submission with the
  // rest. Reading that absence as "remove it" is how one program's admin would
  // quietly pull a mentor out of a program they cannot even see.
  const scope = await adminWriteScope(actor);
  const toDelete = mentor.mentorAssignments.filter(
    (a) =>
      !wanted.has(`${a.programId}:${a.levelId ?? ""}:${a.cohortId ?? ""}`) &&
      scopeCovers(scope, a.programId)
  );
  const remaining =
    mentor.mentorAssignments.length - toDelete.length + toCreate.length;

  if (!detailsChanged && toCreate.length === 0 && toDelete.length === 0) {
    return { ok: true, message: "No changes to save." };
  }

  await prisma.$transaction(async (tx) => {
    if (stub) await removeStub(tx, stub);
    if (detailsChanged) {
      await tx.user.update({ where: { id: mentorId }, data: { name, email } });
    }
    if (toDelete.length > 0) {
      await tx.mentorAssignment.deleteMany({
        where: { id: { in: toDelete.map((a) => a.id) } },
      });
    }
    if (toCreate.length > 0) {
      await tx.mentorAssignment.createMany({
        data: toCreate.map((t) => ({
          mentorId,
          programId: t.programId,
          levelId: t.levelId,
          cohortId: t.cohortId,
        })),
      });
      await notify(tx, {
        to: [mentorId],
        type: NOTIFICATION_TYPES.MENTOR_ASSIGNED,
        actorId: actor.id,
        href: notificationHref.mentorHome(),
        message: `You were assigned to ${toCreate.map((t) => t.label).join(", ")}. Set your booking link on your mentor page so students there can book you.`,
      });
    }
    if (isPureMentor && remaining === 0 && mentor.status === USER_STATUS.ACTIVE) {
      await tx.user.update({
        where: { id: mentorId },
        data: { status: USER_STATUS.UNASSIGNED },
      });
    } else if (
      isPureMentor &&
      remaining > 0 &&
      mentor.status === USER_STATUS.UNASSIGNED
    ) {
      await tx.user.update({
        where: { id: mentorId },
        data: { status: USER_STATUS.ACTIVE },
      });
    }
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      `${name} updated.` +
      (stub ? ` The student sign-up ${email} had made was removed.` : ""),
  };
}

/**
 * A mentor sets or updates the booking link on ONE of their own assignments
 * (links are per pairing; admins create the pairing but never set the link).
 */
export async function setBookingLink(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor || !canActAsMentor(actor)) {
    return { ok: false, error: "Only mentors can set their booking link." };
  }

  const assignmentId = String(formData.get("assignmentId") ?? "");
  const assignment = await prisma.mentorAssignment.findUnique({
    where: { id: assignmentId },
    include: { program: true, cohort: true, level: true },
  });
  if (!assignment || assignment.mentorId !== actor.id) {
    return { ok: false, error: "You can only edit your own booking links." };
  }

  const calendlyUrl = String(formData.get("calendlyUrl") ?? "").trim();
  let url: URL;
  try {
    url = new URL(calendlyUrl);
  } catch {
    return { ok: false, error: "Enter a valid booking URL." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "The booking URL must use https." };
  }

  await prisma.mentorAssignment.update({
    where: { id: assignment.id },
    data: { calendlyUrl },
  });

  revalidatePath("/", "layout");
  const label = [
    assignment.program.name,
    assignment.level?.name,
    assignment.cohort?.name,
  ]
    .filter(Boolean)
    .join(" / ");
  return { ok: true, message: `Booking link for ${label} saved.` };
}

/**
 * Assign one mentor to one program (or one of its cohorts) from the program's
 * own settings — the same pairing the mentors page edits per mentor, reached
 * from the side an admin is usually standing on: "who works in this program".
 * A first assignment activates a mentor who was parked as UNASSIGNED.
 */
export async function assignMentorToProgram(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  // Asked of the id before anything is looked up, so a program somebody does
  // not administer reads exactly like a program that isn't there.
  const programId = String(formData.get("programId") ?? "");
  const denied = await assertProgramScope(actor, programId);
  if (denied) return denied;

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: { cohorts: { include: { level: true } }, levels: true },
  });
  if (!program) return { ok: false, error: "Program not found." };

  const mentorId = String(formData.get("mentorId") ?? "");
  const mentor = await prisma.user.findUnique({ where: { id: mentorId } });
  if (!mentor || !canActAsMentor(mentor)) {
    return { ok: false, error: "Pick a mentor." };
  }

  // Program-wide unless something narrower was named: a level, which covers
  // every cohort under it, or a single cohort (the narrowest pairing — its
  // level travels with the cohort and is not stored again).
  const rawLevel = String(formData.get("levelId") ?? "").trim();
  const level = rawLevel
    ? (program.levels.find((l) => l.id === rawLevel) ?? null)
    : null;
  if (rawLevel && !level) {
    return { ok: false, error: `Pick a level in ${program.name}.` };
  }
  const rawCohort = String(formData.get("cohortId") ?? "").trim();
  const cohort = rawCohort
    ? program.cohorts.find((c) => c.id === rawCohort)
    : null;
  if (rawCohort && !cohort) {
    return { ok: false, error: `Pick a cohort in ${program.name}.` };
  }
  // A cohort under a level names it: agreeing with the level select is the
  // form's job, and disagreeing is the request's problem, not the student's.
  if (cohort && level && cohort.levelId !== level.id) {
    return { ok: false, error: `That cohort is not in ${level.name}.` };
  }
  const label = cohort
    ? [program.name, cohort.level?.name, cohort.name].filter(Boolean).join(" / ")
    : level
      ? `${program.name} / ${level.name}`
      : program.name;

  const existing = await prisma.mentorAssignment.findFirst({
    where: {
      mentorId,
      programId,
      cohortId: cohort?.id ?? null,
      levelId: cohort ? null : (level?.id ?? null),
    },
  });
  if (existing) {
    return {
      ok: true,
      message: `${mentor.name ?? mentor.email} is already assigned to ${label}.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.mentorAssignment.create({
      data: {
        mentorId,
        programId,
        levelId: cohort ? null : (level?.id ?? null),
        cohortId: cohort?.id ?? null,
      },
    });
    // Assignments are what activate a plain mentor; dual-role admins are
    // already ACTIVE and stay that way.
    if (
      mentor.role === ROLES.MENTOR &&
      mentor.status === USER_STATUS.UNASSIGNED
    ) {
      await tx.user.update({
        where: { id: mentorId },
        data: { status: USER_STATUS.ACTIVE },
      });
    }
    await notify(tx, {
      to: [mentorId],
      type: NOTIFICATION_TYPES.MENTOR_ASSIGNED,
      actorId: actor.id,
      href: notificationHref.mentorHome(),
      message: `You were assigned to ${label}. Set your booking link on your mentor page so students there can book you.`,
    });
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `${mentor.name ?? mentor.email} assigned to ${label}.`,
  };
}

/** Remove a mentor-program/cohort assignment (admin correction). */
export async function removeAssignment(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const id = String(formData.get("assignmentId") ?? "");
  const assignment = await prisma.mentorAssignment.findUnique({
    where: { id },
  });
  // One sentence for both: a pairing in a program this admin doesn't hold is
  // gone as far as they are concerned, and a refusal would say it is there.
  if (!assignment || (await assertProgramScope(actor, assignment.programId))) {
    return { ok: false, error: "Assignment not found." };
  }

  await prisma.mentorAssignment.delete({ where: { id } });

  revalidatePath("/", "layout");
  return { ok: true, message: "Assignment removed." };
}
