"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { assertPlatformAdmin, assertProgramScope } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { parseMinutesField, type ActionState } from "@/lib/actions/shared";
import { PROGRAM_SPACE } from "@/lib/constants";
import { formatDuration } from "@/lib/format";
import { pickColorIndex } from "@/lib/program-color";

/** A program name as it is stored: trimmed, with any run of whitespace as one space. */
function cleanName(raw: FormDataEntryValue | null): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The stored name this one collides with, ignoring capitals — or null. The
 * unique index is case-sensitive, so "global admissions program" sat beside
 * "Global Admissions Program" and two pickers showed what looked like the same
 * program twice (October 2026 audit). A program count is small, so the compare
 * is done here rather than with a raw SQL `COLLATE NOCASE`.
 */
async function nameTaken(name: string, exceptId?: string): Promise<string | null> {
  const programs = await prisma.program.findMany({ select: { id: true, name: true } });
  const wanted = name.toLowerCase();
  return programs.find((p) => p.id !== exceptId && p.name.toLowerCase() === wanted)?.name ?? null;
}

/**
 * A platform admin opens a new program. Programs created here live alongside
 * the seeded ones (the seed only upserts by name, it never deletes). Students
 * and mentors attach to the program directly until it's given cohorts.
 */
export async function createProgram(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  // A program is the unit access is granted in, and a new one arrives with
  // nobody administering it — so making one belongs to the people who can hand
  // that access out, not to an admin of some other program.
  const denied = assertPlatformAdmin(actor);
  if (denied) return denied;

  const name = cleanName(formData.get("name"));
  if (name.length < 3) {
    return { ok: false, error: "Give the program a name (3+ characters)." };
  }

  const existing = await nameTaken(name);
  if (existing) {
    return { ok: false, error: `A program called ${existing} already exists.` };
  }

  await prisma.program.create({ data: { name, colorIndex: await pickColorIndex() } });

  revalidatePath("/", "layout");
  return { ok: true, message: `${name} is up and running.` };
}

/**
 * Rename a program. The name is the program's identity everywhere — its own
 * page, every student row, the Master's billing rule in config/app-config.ts —
 * so renaming is deliberately a settings action rather than an inline edit.
 */
export async function renameProgram(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();

  const programId = String(formData.get("programId") ?? "");
  // Gated before the row is read, so a program outside the scope answers the
  // same whether or not the id names a real one.
  const denied = await assertProgramScope(actor, programId);
  if (denied) return denied;

  const program = await prisma.program.findUnique({ where: { id: programId } });
  if (!program) return { ok: false, error: "Program not found." };

  const name = cleanName(formData.get("name"));
  if (name.length < 3) {
    return { ok: false, error: "Give the program a name (3+ characters)." };
  }
  if (name === program.name) {
    return { ok: true, message: "No change: that's already its name." };
  }

  const taken = await nameTaken(name, program.id);
  if (taken) {
    return { ok: false, error: `A program called ${taken} already exists.` };
  }

  await prisma.program.update({ where: { id: programId }, data: { name } });

  revalidatePath("/", "layout");
  return { ok: true, message: `${program.name} is now called ${name}.` };
}

/**
 * An admin of the program adds a LEVEL to it — "Emerging" inside Research.
 *
 * Refused while the program holds flat cohorts: a program either has levels
 * (and every cohort sits under one) or has cohorts directly, and mixing the
 * two is the shape resolveEnrollment is written not to have to ask about.
 * The research merge script moves a program's existing cohorts under the new
 * level itself, which is why this door is only ever answered with an empty
 * cohort list.
 */
export async function createLevel(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();

  const programId = String(formData.get("programId") ?? "");
  const denied = await assertProgramScope(actor, programId);
  if (denied) return denied;

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: { cohorts: { select: { id: true, levelId: true } }, levels: true },
  });
  if (!program) return { ok: false, error: "Program not found." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Give the level a name." };

  if (program.cohorts.some((c) => c.levelId === null)) {
    return {
      ok: false,
      error: `${program.name} still has cohorts outside any level. Move each of them under a level first.`,
    };
  }

  const existing = program.levels.find(
    (l) => l.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    return {
      ok: false,
      error: `${program.name} already has a level called ${existing.name}.`,
    };
  }

  await prisma.programLevel.create({ data: { programId, name } });

  revalidatePath("/", "layout");
  return { ok: true, message: `${name} added to ${program.name}.` };
}

/**
 * Delete a level, once nothing is in it — the same rule as a cohort, one row
 * up: students move between levels on the student page, pairings and cohorts
 * are emptied first, so a level only goes when it genuinely holds nothing.
 */
export async function deleteLevel(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();

  const levelId = String(formData.get("levelId") ?? "");
  const level = await prisma.programLevel.findUnique({
    where: { id: levelId },
    include: {
      _count: {
        select: { enrollments: true, mentorAssignments: true, cohorts: true },
      },
    },
  });
  if (!level) return { ok: false, error: "Level not found." };

  const denied = await assertProgramScope(actor, level.programId);
  if (denied) return denied;

  if (level._count.enrollments > 0) {
    return {
      ok: false,
      error: `${level.name} still has ${level._count.enrollments} student${level._count.enrollments === 1 ? "" : "s"}. Move them to another level first.`,
    };
  }
  if (level._count.mentorAssignments > 0) {
    return {
      ok: false,
      error: `${level.name} still has mentors assigned to it. Unassign them first.`,
    };
  }
  if (level._count.cohorts > 0) {
    return {
      ok: false,
      error: `${level.name} still has ${level._count.cohorts} cohort${level._count.cohorts === 1 ? "" : "s"}. Empty and delete those first.`,
    };
  }

  await prisma.programLevel.delete({ where: { id: levelId } });

  revalidatePath("/", "layout");
  return { ok: true, message: `${level.name} deleted.` };
}

/**
 * The grant every student joining at THIS level receives — the pair
 * `Program.standardMinutes`/`standardDays` holds for a flat program, one row
 * down. Emerging's two hours and Advanced's fifteen live on the levels, not
 * on Research: the level is what was bought. Both fields empty turns it off,
 * and a level with no pair inherits the program's.
 */
export async function setLevelStandardHours(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();

  const levelId = String(formData.get("levelId") ?? "");
  const level = await prisma.programLevel.findUnique({
    where: { id: levelId },
    include: { program: true },
  });
  if (!level) return { ok: false, error: "Level not found." };

  const denied = await assertProgramScope(actor, level.programId);
  if (denied) return denied;

  const rawMinutes = String(formData.get("minutes") ?? "").trim();
  const rawDays = String(formData.get("days") ?? "").trim();

  let standardMinutes: number | null = null;
  let standardDays: number | null = null;
  if (rawMinutes || rawDays) {
    if (!rawMinutes || !rawDays) {
      return {
        ok: false,
        error: "Give both the minutes and the days to use them in, or leave both empty to inherit the program's.",
      };
    }
    const minutes = parseMinutesField(rawMinutes, { min: 1, label: "Minutes" });
    if ("error" in minutes) return { ok: false, error: minutes.error };
    const days = Number(rawDays);
    if (!Number.isInteger(days) || days < 1 || days > STANDARD_DAYS_MAX) {
      return {
        ok: false,
        error: `Days to use them in must be a whole number from 1 to ${STANDARD_DAYS_MAX}.`,
      };
    }
    standardMinutes = minutes.value;
    standardDays = days;
  }

  if (standardMinutes === level.standardMinutes && standardDays === level.standardDays) {
    return { ok: true, message: "No change." };
  }

  await prisma.programLevel.update({
    where: { id: levelId },
    data: { standardMinutes, standardDays },
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      standardMinutes === null
        ? `${level.name} no longer sets its own standard — it inherits ${level.program.name}'s.`
        : `Students joining ${level.name} from now on get ${formatDuration(standardMinutes)} to use within ${standardDays} day${standardDays === 1 ? "" : "s"}. Students already in it keep what they have.`,
  };
}

/**
 * Delete a cohort, once nothing is in it. Students and mentor pairings are
 * moved, not orphaned: an admin re-enrolls them (student page → Corrections)
 * before the cohort can go.
 */
export async function deleteCohort(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();

  const cohortId = String(formData.get("cohortId") ?? "");
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    include: {
      _count: { select: { enrollments: true, mentorAssignments: true } },
    },
  });
  if (!cohort) return { ok: false, error: "Cohort not found." };

  // A cohort is part of one program's setup, so the row names the program the
  // gate asks about — the form never gets to say.
  const denied = await assertProgramScope(actor, cohort.programId);
  if (denied) return denied;

  if (cohort._count.enrollments > 0) {
    return {
      ok: false,
      error: `${cohort.name} still has ${cohort._count.enrollments} student${cohort._count.enrollments === 1 ? "" : "s"}. Move them to another cohort first.`,
    };
  }
  if (cohort._count.mentorAssignments > 0) {
    return {
      ok: false,
      error: `${cohort.name} still has mentors assigned to it. Unassign them first.`,
    };
  }

  await prisma.cohort.delete({ where: { id: cohortId } });

  revalidatePath("/", "layout");
  return { ok: true, message: `${cohort.name} deleted.` };
}

/**
 * Close a finished program down, or reopen one that was closed too early.
 *
 * Archiving is what a program that has RUN does instead of being deleted.
 * `deleteProgram` below is refused while a single student or a single grant is
 * left, which is correct and which leaves the common case — a cohort that
 * finished, with a year of sessions behind it — with nowhere to go: the program
 * stayed in every picker and every list forever, and the only way to get it out
 * was to delete the students whose ledger it holds.
 *
 * WHO MAY. The program's own admins, the same gate as `renameProgram` and
 * `deleteProgram`, and NOT platform-only. §8.3 reserves platform for two things
 * and this is neither: creating a program (which arrives with nobody
 * administering it, so it cannot be anybody's) and `ProgramStaff` writes (which
 * hand out access). Archiving creates and destroys nothing — every grant
 * survives it, every ledger page stays reachable, and the reader who ran the
 * program is the one who knows it has finished. It is also the only reversible
 * door on that settings page, which is the argument for putting it beside the
 * two irreversible ones rather than behind a different person.
 *
 * One action, both directions: the pair is one decision, and splitting it in
 * two would duplicate the gate and the sentence.
 */
export async function archiveProgram(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();

  const programId = String(formData.get("programId") ?? "");
  // Gated before the row is read, so a program outside the scope answers the
  // same whether or not the id names a real one.
  const denied = await assertProgramScope(actor, programId);
  if (denied) return denied;

  const program = await prisma.program.findUnique({ where: { id: programId } });
  if (!program) return { ok: false, error: "Program not found." };

  const restore = String(formData.get("restore") ?? "") === "true";
  if (restore === (program.status === "ACTIVE")) {
    return {
      ok: true,
      message: restore
        ? `${program.name} is already running.`
        : `${program.name} is already archived.`,
    };
  }

  await prisma.program.update({
    where: { id: programId },
    data: restore
      ? { status: "ACTIVE", archivedAt: null }
      : { status: "ARCHIVED", archivedAt: new Date() },
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: restore
      ? `${program.name} is running again.`
      : `${program.name} is archived. Its sessions and allocations stay where they are.`,
  };
}

/**
 * Does allocating time in this program also record what the student paid?
 *
 * A column on the program, decided here, replacing a comparison against the
 * program's NAME at four call sites — where renaming the Master's Program,
 * which the same settings page offers, silently switched the money fields off
 * across the whole app.
 *
 * Program-scoped for the same reason `renameProgram` is: it changes what that
 * program's own forms ask for, and the person who administers it is the one who
 * knows whether they collect money.
 */
export async function setProgramTracksPayment(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();

  const programId = String(formData.get("programId") ?? "");
  const denied = await assertProgramScope(actor, programId);
  if (denied) return denied;

  const program = await prisma.program.findUnique({ where: { id: programId } });
  if (!program) return { ok: false, error: "Program not found." };

  const tracksPayment = String(formData.get("tracksPayment") ?? "") === "on";
  if (tracksPayment === program.tracksPayment) {
    return { ok: true, message: "No change." };
  }

  await prisma.program.update({
    where: { id: programId },
    data: { tracksPayment },
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    // Amounts already recorded are not touched: the flag decides what the forms
    // ASK for, and money somebody entered last month is a fact either way.
    message: tracksPayment
      ? `Allocating time in ${program.name} now asks what the student paid.`
      : `Allocating time in ${program.name} no longer asks about payment. Amounts already recorded stay.`,
  };
}

/**
 * Present a program as an institute of its own to the people who work only in
 * it — or stop. See lib/space.ts.
 *
 * Platform admin only, unlike the program's other settings: this changes what
 * OTHER people see — the chrome, the sidebar and the home of every admin,
 * mentor and student whose work is all in this program — and the person who
 * runs one program is not the one to rearrange the frame for everybody in it.
 * It moves no hours and grants nothing; `authz.ts` never reads it.
 *
 * `space` is "INSTITUTE" or "PROGRAM"; `spaceName` is what the institute is
 * called in its own chrome, and an empty one falls back to the program's name.
 */
export async function setProgramSpace(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  const denied = assertPlatformAdmin(actor);
  if (denied) return denied;

  const programId = String(formData.get("programId") ?? "");
  const program = await prisma.program.findUnique({ where: { id: programId } });
  if (!program) return { ok: false, error: "Program not found." };

  const space =
    String(formData.get("space") ?? "") === PROGRAM_SPACE.INSTITUTE
      ? PROGRAM_SPACE.INSTITUTE
      : PROGRAM_SPACE.PROGRAM;
  const rawName = String(formData.get("spaceName") ?? "").trim();
  if (rawName.length > 80) {
    return { ok: false, error: "Keep the institute's name under 80 characters." };
  }
  // The name is kept when the program stops being an institute, so turning it
  // back on later does not ask for it again.
  const spaceName = formData.has("spaceName") ? rawName || null : program.spaceName;

  if (space === program.space && spaceName === program.spaceName) {
    return { ok: true, message: "No change." };
  }

  await prisma.program.update({
    where: { id: programId },
    data: { space, spaceName },
  });

  revalidatePath("/", "layout");
  const shown = spaceName ?? program.name;
  return {
    ok: true,
    message:
      space === PROGRAM_SPACE.INSTITUTE
        ? `People who work only in ${program.name} now see it as ${shown}.`
        : `${program.name} is shown as an ordinary program to everyone.`,
  };
}

/** Three years: past that, "use within" is a typo for a minutes figure. */
const STANDARD_DAYS_MAX = 1095;

/**
 * Set, change or clear the grant every student joining this program receives
 * (`grantStandardHours`): minutes into their unassigned pool, to use within a
 * number of days of joining. Both fields empty turns it off.
 *
 * Program-scoped like `setProgramTracksPayment`: a level's hours are what that
 * program sells, and its admin is the one who knows the figure. It changes
 * what students who join FROM NOW ON get, and nothing already granted — a
 * student who joined under the old figure was promised the old figure.
 */
export async function setProgramStandardHours(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();

  const programId = String(formData.get("programId") ?? "");
  const denied = await assertProgramScope(actor, programId);
  if (denied) return denied;

  const program = await prisma.program.findUnique({ where: { id: programId } });
  if (!program) return { ok: false, error: "Program not found." };

  const rawMinutes = String(formData.get("minutes") ?? "").trim();
  const rawDays = String(formData.get("days") ?? "").trim();

  let standardMinutes: number | null = null;
  let standardDays: number | null = null;
  if (rawMinutes || rawDays) {
    if (!rawMinutes || !rawDays) {
      return {
        ok: false,
        error: "Give both the minutes and the days to use them in, or leave both empty to turn it off.",
      };
    }
    const minutes = parseMinutesField(rawMinutes, { min: 1, label: "Minutes" });
    if ("error" in minutes) return { ok: false, error: minutes.error };
    const days = Number(rawDays);
    if (!Number.isInteger(days) || days < 1 || days > STANDARD_DAYS_MAX) {
      return {
        ok: false,
        error: `Days to use them in must be a whole number from 1 to ${STANDARD_DAYS_MAX}.`,
      };
    }
    standardMinutes = minutes.value;
    standardDays = days;
  }

  if (standardMinutes === program.standardMinutes && standardDays === program.standardDays) {
    return { ok: true, message: "No change." };
  }

  await prisma.program.update({
    where: { id: programId },
    data: { standardMinutes, standardDays },
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      standardMinutes === null
        ? `Students joining ${program.name} no longer get standard hours. Time already granted stays.`
        : `Students joining ${program.name} from now on get ${formatDuration(standardMinutes)} to use within ${standardDays} day${standardDays === 1 ? "" : "s"}. Students already in it keep what they have.`,
  };
}

/**
 * Does each student here hold one HOUR BANK that every mentor's meeting draws?
 *
 * A column, like `tracksPayment`, so Full Support and the Master's Program are
 * the programs an admin switched it on for and not the ones with a particular
 * name. Turning it off changes what the allocate form OFFERS; a bank a student
 * already holds keeps being drawn by their meetings until it is removed, so no
 * hour is orphaned by a setting.
 */
export async function setProgramHourBank(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();

  const programId = String(formData.get("programId") ?? "");
  const denied = await assertProgramScope(actor, programId);
  if (denied) return denied;

  const program = await prisma.program.findUnique({ where: { id: programId } });
  if (!program) return { ok: false, error: "Program not found." };

  const hourBank = String(formData.get("hourBank") ?? "") === "on";
  if (hourBank === program.hourBank) return { ok: true, message: "No change." };

  await prisma.program.update({ where: { id: programId }, data: { hourBank } });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: hourBank
      ? `${program.name} now has hour banks. Add one from Allocate time by choosing Hour bank as the agenda.`
      : `${program.name} no longer offers hour banks. Banks students already hold keep working.`,
  };
}

/**
 * Does this program log its hours as classes? Its roster is then groups, added
 * by name, and an hour is logged for a group. A column, like `hourBank`.
 * Turning it off changes what the add form and the log button OFFER; groups
 * already added stay, with their hours.
 */
export async function setProgramClassHours(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();

  const programId = String(formData.get("programId") ?? "");
  const denied = await assertProgramScope(actor, programId);
  if (denied) return denied;

  const program = await prisma.program.findUnique({ where: { id: programId } });
  if (!program) return { ok: false, error: "Program not found." };

  const classHours = String(formData.get("classHours") ?? "") === "on";
  if (classHours === program.classHours) return { ok: true, message: "No change." };

  await prisma.program.update({ where: { id: programId }, data: { classHours } });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: classHours
      ? `${program.name} now logs hours as classes. Add a group from the program page.`
      : `${program.name} no longer logs hours as classes. Groups already added keep their hours.`,
  };
}

/**
 * Delete a whole program, once it is empty. Anything with history in it —
 * students, staff scoped to it — blocks the delete rather than being swept up:
 * a program is closed by emptying it, and only then removed.
 */
export async function deleteProgram(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();

  const programId = String(formData.get("programId") ?? "");
  const denied = await assertProgramScope(actor, programId);
  if (denied) return denied;

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      cohorts: true,
      _count: {
        select: { enrollments: true, staffGrants: true, mentorAssignments: true },
      },
    },
  });
  if (!program) return { ok: false, error: "Program not found." };

  if (program._count.enrollments > 0) {
    return {
      ok: false,
      error: `${program.name} still has ${program._count.enrollments} student${program._count.enrollments === 1 ? "" : "s"}. Remove or move them first.`,
    };
  }
  // Grants outlive the program row unless somebody looks: deleting a program
  // out from under them would leave people holding access to nothing, and the
  // owner would never see it happen. Removing the access is a decision, so it
  // is made on /settings/platform, not silently here.
  if (program._count.staffGrants > 0) {
    const n = program._count.staffGrants;
    return {
      ok: false,
      error: `${n} ${n === 1 ? "person administers" : "people administer"} ${program.name}. Remove their access on Platform settings first.`,
    };
  }

  // Mentor pairings and empty cohorts are part of the program's own setup, so
  // they go with it; nothing was ever logged against them. Levels are the
  // same and are checked empty by their own button — the cohorts under them
  // went first.
  await prisma.$transaction(async (tx) => {
    await tx.mentorAssignment.deleteMany({ where: { programId } });
    await tx.cohort.deleteMany({ where: { programId } });
    await tx.programLevel.deleteMany({ where: { programId } });
    await tx.program.delete({ where: { id: programId } });
  });

  revalidatePath("/", "layout");
  redirect("/admin");
}

/**
 * An admin of the program adds a cohort to it — directly, or under a level in
 * a program that has them. The first cohort switches the program to
 * cohort-based enrollment for NEW students/assignments; existing program-wide
 * members are unaffected.
 */
export async function createCohort(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();

  const programId = String(formData.get("programId") ?? "");
  const denied = await assertProgramScope(actor, programId);
  if (denied) return denied;

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: { levels: true },
  });
  if (!program) return { ok: false, error: "Program not found." };

  // In a leveled program a cohort lives UNDER a level — a cohort with no
  // level there is a shape resolveEnrollment refuses to ask about, so the
  // level is required here and must be one of this program's.
  const rawLevel = String(formData.get("levelId") ?? "");
  const level = program.levels.find((l) => l.id === rawLevel) ?? null;
  if (program.levels.length > 0 && !level) {
    return { ok: false, error: `Pick a level in ${program.name}.` };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Give the cohort a name." };

  // Unique per (program, level) in the schema — NULL levelId is distinct
  // there, so the flat-program half is checked here. Same name under a
  // different level is a different intake, not a collision.
  const existing = await prisma.cohort.findFirst({
    where: { programId, name, levelId: level?.id ?? null },
  });
  if (existing) {
    return {
      ok: false,
      error: `${program.name} already has a cohort called ${name}.`,
    };
  }

  await prisma.cohort.create({
    data: { programId, name, levelId: level?.id ?? null },
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: level
      ? `${name} added to ${level.name} in ${program.name}.`
      : `${name} added to ${program.name}.`,
  };
}
