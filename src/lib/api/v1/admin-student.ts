import "server-only";

import { nameOf, type Reader } from "@/lib/api/v1/sessions";
import type { AdminGrant, AdminStudent, GrantChange } from "@/lib/api/v1/types";
import { timeByMentorEntries, toAllocationEntries } from "@/components/allocation-row";
import { canAdministerStudent, canManageStudent, mentorReaches, scopeCovers, staffLevel, studentScope } from "@/lib/authz";
import { canActAsMentor, USER_STATUS } from "@/lib/constants";
import { sortEnrollments } from "@/lib/enrollments";
import { toDateInputValue } from "@/lib/format";
import { allocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { studentLedger } from "@/lib/queries";
import { daysAway, programToday } from "@/lib/when";

/**
 * One student as an admin of one of their programs reads them, for the
 * freshlog app: what the website's `/students/[id]` shows such a reader, with
 * the controls it draws as `can` flags.
 *
 * Who may read is `canManageStudent`, at any level of grant. A student in none
 * of the reader's programs, one in no program, and one who does not exist read
 * alike (null, a 404). What is read is narrowed by `studentScope`: the reader's
 * programs among the student's, and no trace of the others.
 */

/** The profile as every read of one student loads it. */
async function profileOf(id: string) {
  return prisma.studentProfile.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, email: true, status: true } },
      enrollments: { include: { program: true, cohort: true, level: true }, orderBy: { program: { name: "asc" } } },
    },
  });
}

export type ManagedStudent = NonNullable<Awaited<ReturnType<typeof profileOf>>>;

/**
 * The student, when `reader` manages them; null otherwise, with one answer for
 * missing and not theirs. `writes` is `canAdministerStudent`: the reader may
 * change one of their programs.
 */
export async function managedStudent(
  reader: Reader,
  id: string
): Promise<{ profile: ManagedStudent; writes: boolean } | null> {
  const profile = await profileOf(id);
  if (!profile || !(await canManageStudent(reader.user, profile))) return null;
  return { profile, writes: await canAdministerStudent(reader.user, profile) };
}

/** The student's page, for an admin. */
export async function adminStudentFor(reader: Reader, id: string, now: Date = new Date()): Promise<AdminStudent | null> {
  const managed = await managedStudent(reader, id);
  if (!managed) return null;
  const { profile, writes } = managed;
  const visible = await studentScope(reader.user, profile);
  const enrollments = profile.enrollments.filter((e) => visible.includes(e.programId));

  const [hours, ledger, changes, pairings, reaches] = await Promise.all([
    allocationSummary(profile.id, visible),
    studentLedger(profile.id, visible),
    prisma.hourAllotmentChange.findMany({
      where: { studentId: profile.id, programId: { in: visible } },
      include: { mentor: true, program: true, changedBy: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.mentorAssignment.findMany({
      where: { programId: { in: visible } },
      select: { programId: true, mentorId: true },
    }),
    canActAsMentor(reader.user) ? mentorReaches(reader.user, profile) : Promise.resolve(false),
  ]);

  const programOf = new Map(enrollments.map((e) => [e.programId, e.program]));
  // A bank is changed by the program's admins only: a Leader or Sales grant reads it.
  const bankAdmin = new Set(
    (
      await Promise.all(
        enrollments
          .filter((e) => e.program.hourBank)
          .map(async (e) => ((await staffLevel(reader.user, e.programId)) === "ADMIN" ? e.programId : null))
      )
    ).filter((v): v is string => v !== null)
  );
  const mentorsIn = (programId: string) => new Set(pairings.filter((p) => p.programId === programId).map((p) => p.mentorId));

  // The website's own fold, from the file that draws "Time by mentor", so
  // Assigned is its rule exactly: the larger of the grant and the open plan
  // items' budgets for it, and a row of its own for a mentor with planned work
  // and no grant. Imported rather than copied, so the two cannot drift.
  const entries = timeByMentorEntries(toAllocationEntries(hours.perMentor), ledger.assignments);
  const grants = entries.map((entry): AdminGrant => {
    const program = programOf.get(entry.program.id);
    const bank = entry.bank ?? false;
    const edit = writes && scopeCovers(reader.write, entry.program.id) && entry.deadline != null && (!bank || bankAdmin.has(entry.program.id));
    const others = [...mentorsIn(entry.program.id)].filter((m) => m !== entry.mentor?.id);
    return {
      program: { id: entry.program.id, name: entry.program.name, colorIndex: entry.program.colorIndex },
      mentor: entry.mentor ? { id: entry.mentor.id, name: nameOf(entry.mentor) } : null,
      bank,
      allocated: entry.allocated,
      assigned: entry.assigned ?? entry.allocated,
      completed: entry.completed,
      missed: entry.missed,
      remaining: entry.remaining,
      deadline: entry.deadline ? toDateInputValue(entry.deadline) : null,
      daysLeft: entry.deadline ? daysAway(entry.deadline, now) : null,
      expired: entry.expired,
      // The money is the grant's, where the program bills per student.
      amountPaid: program && program.tracksPayment && !program.hourBank ? (entry.amountPaid ?? 0) : null,
      can: {
        edit,
        // In date and unspent is what a transfer can move, to another of the program's mentors. A bank moves no way.
        transfer: edit && !bank && Math.max(0, entry.remaining) > 0 && others.length > 0,
        remove: edit,
      },
    };
  });

  const history = changes.map((c): GrantChange => ({
    at: c.createdAt.toISOString(),
    program: { id: c.program.id, name: c.program.name, colorIndex: c.program.colorIndex },
    mentor: c.mentor ? { id: c.mentor.id, name: nameOf(c.mentor) } : null,
    // The website names a mentorless change "the hour bank" where the program has one.
    bank: c.mentor === null && c.program.hourBank,
    from: c.oldMinutes,
    to: c.newMinutes,
    by: { id: c.changedBy.id, name: nameOf(c.changedBy) },
  }));

  const pending = profile.user.status === USER_STATUS.PENDING;
  const writable = enrollments.filter((e) => scopeCovers(reader.write, e.programId));
  return {
    student: {
      id: profile.id,
      userId: profile.userId,
      name: nameOf(profile.user),
      email: profile.user.email,
      telegram: profile.telegramUsername,
      folderUrl: profile.folderUrl,
      registered: toDateInputValue(profile.createdAt),
    },
    approved: !pending,
    programs: sortEnrollments(enrollments).map((e) => ({
      id: e.program.id,
      name: e.program.name,
      colorIndex: e.program.colorIndex,
      level: e.level?.name ?? null,
      cohort: e.cohort?.name ?? null,
      visit: e.exchangeId !== null,
    })),
    hours: {
      allotted: hours.allotted,
      completed: hours.completed,
      missed: hours.missed,
      remaining: hours.remaining,
      forfeited: hours.forfeited,
      expiring: hours.expiring
        ? { minutes: hours.expiring.minutes, day: toDateInputValue(hours.expiring.date), daysLeft: daysAway(hours.expiring.date, now) }
        : null,
    },
    grants,
    history,
    can: {
      approve: pending && writes,
      reject: pending && writes,
      // The website's "Allocate time": the reader may change one of the student's programs, and it has a mentor.
      allocate: writes && writable.some((e) => mentorsIn(e.programId).size > 0),
      reach: reaches,
    },
    today: programToday(now),
  };
}
