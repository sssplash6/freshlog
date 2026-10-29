import "server-only";

import { NOT_YOUR_PROGRAM } from "@/lib/api/v1/admin-gates";
import { refused } from "@/lib/api/v1/respond";
import { nameOf, SESSION_INCLUDE, toApiSession, type Reader } from "@/lib/api/v1/sessions";
import type { AllocatePicker, Cohort, ProgramDetail, ProgramOption } from "@/lib/api/v1/types";
import { mentorPool, programCohorts, programGrants, programLevels, programPairings, programStudents, studentsOf } from "@/app/programs/reads";
import { scopeCovers, scopeProgramFilter } from "@/lib/authz";
import { PROGRAM_STATUS } from "@/lib/constants";
import { programTotals } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { programOptions } from "@/lib/queries";
import { programPeople, programRecent } from "@/lib/screens/program";
import { allocatePicker, allocateWarning } from "@/lib/screens/program-allocate";
import { programToday } from "@/lib/when";
import type { Program } from "@/generated/prisma/client";

/**
 * Programs as a program admin reads and runs them, for the freshlog app: the
 * website's `/programs/[id]` and its Settings, read with the same functions
 * (`app/programs/reads.ts`), with what the reader may change as `can` flags.
 */

/**
 * The program `id` and whether the reader may change it, or the answer to give
 * instead: a 404 for one the reader does not read, exactly as for one that does
 * not exist, and, when `write` is asked, a 403 for one they read and may not
 * change.
 *
 * Read before the action is called, because a platform admin's scope covers
 * any string, and the actions then call a missing program "not found" in a
 * 400, while they call one outside a scope "you don't administer it".
 */
export async function programGate(
  reader: Reader,
  id: string,
  { write }: { write: boolean }
): Promise<{ program: Program } | { refusal: Response }> {
  const program = scopeCovers(reader.read, id) ? await prisma.program.findUnique({ where: { id } }) : null;
  if (!program) return { refusal: refused("Not found.", 404) };
  if (write && !scopeCovers(reader.write, id)) return { refusal: refused(NOT_YOUR_PROGRAM, 403) };
  return { program };
}

/** Where a pairing puts a mentor, in words: a level, a cohort, both, or the whole program. */
const scopeOf = (pairing: { level: { name: string } | null; cohort: { name: string } | null }, program: string) =>
  [pairing.level?.name, pairing.cohort?.name].filter(Boolean).join(" / ") || program;

const LEVEL_WORD = { ADMIN: "admin", LEADER: "leader", SALES: "sales" } as const;

/** One program, its settings and who works in it. The route has gated it. */
export async function programDetailFor(reader: Reader, program: Program, now: Date = new Date()): Promise<ProgramDetail> {
  const [students, pairings, levels, cohorts, grants, pool, held, recent] = await Promise.all([
    programStudents(program.id),
    programPairings(program.id),
    programLevels(program.id),
    programCohorts(program.id),
    programGrants(program.id),
    mentorPool(),
    // Who each mentor holds time with here: the students their pairing serves.
    prisma.hourAllocation.findMany({
      where: { programId: program.id, mentorId: { not: null } },
      select: { mentorId: true, studentId: true },
    }),
    programRecent(program.id),
  ]);
  // The page's people and latest sessions, read by the page's own functions; the sessions then as the API sends
  // any session, in the page's order.
  const { mentorRows, superAdminIds } = programPeople(pairings, grants);
  const recentRows = await prisma.session.findMany({ where: { id: { in: recent.map((r) => r.id) } }, include: SESSION_INCLUDE });
  const byId = new Map(recentRows.map((r) => [r.id, r]));
  const totals = programTotals(students);
  const paired = new Set(pairings.map((p) => p.mentorId));
  const cohortOf = (c: { id: string; name: string; _count: { enrollments: number; mentorAssignments: number } }): Cohort => ({
    id: c.id,
    name: c.name,
    inUse: c._count.enrollments + c._count.mentorAssignments > 0,
  });
  const standard = (minutes: number | null, days: number | null) => (minutes != null && days != null ? { minutes, days } : null);
  const platform = reader.user.platformAdmin;
  // The website's words for what stands in the way (`settings/page.tsx`).
  const deleteBlocked =
    students.length > 0
      ? `${program.name} still has ${students.length} student${students.length === 1 ? "" : "s"}. Archive it instead, or move them first.`
      : grants.length > 0
        ? "Someone still administers this program. Remove their access on Platform settings first."
        : null;

  return {
    program: {
      id: program.id,
      name: program.name,
      colorIndex: program.colorIndex,
      archived: program.status === PROGRAM_STATUS.ARCHIVED,
      tracksPayment: program.tracksPayment,
      hourBank: program.hourBank,
      classHours: program.classHours,
      tracksAdmissions: program.tracksAdmissions,
      schedulesClasses: program.schedulesClasses,
      standard: standard(program.standardMinutes, program.standardDays),
    },
    totals: {
      students: totals.students,
      allotted: totals.allotted,
      completed: totals.completed,
      missed: totals.missed,
      remaining: totals.remaining,
      forfeited: totals.forfeited,
    },
    levels: levels.map((l) => ({
      id: l.id,
      name: l.name,
      standard: standard(l.standardMinutes, l.standardDays),
      students: l._count.enrollments,
      mentors: l._count.mentorAssignments,
      cohorts: l.cohorts.map(cohortOf),
      canDelete: l._count.enrollments === 0 && l._count.mentorAssignments === 0 && l.cohorts.length === 0,
    })),
    cohorts: cohorts.filter((c) => c.levelId === null).map(cohortOf),
    mentors: pairings.map((p) => ({
      pairingId: p.id,
      mentor: { id: p.mentor.id, name: nameOf(p.mentor) },
      scope: scopeOf(p, program.name),
      students: new Set(held.filter((h) => h.mentorId === p.mentorId).map((h) => h.studentId)).size,
    })),
    people: mentorRows.map(({ mentor, teaches }) => ({
      person: { id: mentor.id, name: nameOf(mentor) },
      teaches,
      admin: superAdminIds.has(mentor.id),
    })),
    recent: recent.flatMap((r) => {
      const row = byId.get(r.id);
      return row ? [toApiSession(reader, row, now)] : [];
    }),
    admins: grants.map((g) => ({
      person: { id: g.user.id, name: nameOf(g.user) },
      level: LEVEL_WORD[g.role as keyof typeof LEVEL_WORD] ?? "admin",
    })),
    // The website's own list, which is every mentor in the school: placing a
    // mentor is a question asked of the program they go to.
    eligibleMentors: pool.filter((m) => !paired.has(m.id)).map((m) => ({ id: m.id, name: nameOf(m), email: m.email })),
    can: {
      write: scopeCovers(reader.write, program.id),
      platform,
      // `deleteProgram` refuses while anyone holds a grant, and a program's own
      // admin holds one, so in practice it is a platform admin's.
      delete: platform && deleteBlocked === null,
      deleteBlocked,
    },
    today: programToday(now),
  };
}

/** The running programs the reader may change, with their levels and cohorts: the pickers of Add students and Register a mentor. */
export async function programOptionsFor(reader: Reader): Promise<ProgramOption[]> {
  const programs = await programOptions(scopeProgramFilter(reader.write));
  return programs.map((p) => ({
    id: p.id,
    name: p.name,
    colorIndex: p.colorIndex,
    classHours: p.classHours,
    levels: p.levels.map((l) => ({ id: l.id, name: l.name, cohorts: l.cohorts.map((c) => ({ id: c.id, name: c.name })) })),
    cohorts: p.cohorts.map((c) => ({ id: c.id, name: c.name })),
  }));
}

/**
 * The program's Allocate time picker (`allocatePicker`, the website's page's
 * own): its students in the page's groups, each with what they hold here
 * already, and the page's warning for somebody overdrawn or with time that
 * expired. The route has gated it on the write scope: it is where a grant
 * starts.
 */
export async function allocatePickerFor(program: Program): Promise<AllocatePicker> {
  const students = studentsOf(await programStudents(program.id), program.id);
  return {
    program: { id: program.id, name: program.name, colorIndex: program.colorIndex },
    rows: allocatePicker(students).map((row) => ({
      student: { id: row.s.id, userId: row.s.userId, name: row.option.label },
      hint: row.option.hint,
      // The page writes its three groups as plain strings.
      group: row.option.group as AllocatePicker["rows"][number]["group"],
      tone: row.option.tone ?? null,
      warning: row.overdrawn || row.expired ? allocateWarning(row.s, row, program.name) : null,
    })),
  };
}
