import "server-only";

import { apiExchange, exchangeParty } from "@/lib/api/v1/exchanges";
import { nameOf, type Reader } from "@/lib/api/v1/sessions";
import type { AdminGrant, AdminStudent, GrantChange } from "@/lib/api/v1/types";
import { timeByMentorEntries, toAllocationEntries } from "@/components/allocation-row";
import { canAdministerStudent, canManageStudent, mentorReaches, scopeCovers, scopeProgramFilter, staffLevel, studentScope } from "@/lib/authz";
import { canActAsMentor, SESSION_STATUS, USER_STATUS } from "@/lib/constants";
import { enrollmentLabel, sortEnrollments, studiesIn } from "@/lib/enrollments";
import { visibleExchanges } from "@/lib/exchanges";
import { toDateInputValue } from "@/lib/format";
import { allocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { programOptions, studentLedger, toProgramOptions } from "@/lib/queries";
import { logAdvice, mentorsIn, programLines, studentHeadline } from "@/lib/screens/student-record";
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
export function adminStudentFor(reader: Reader, id: string, now: Date = new Date()): Promise<AdminStudent | null> {
  return studentRecordFor(reader, id, { mentors: false, mentorLens: false }, now);
}

/**
 * The website's `/students/[id]` as `reader` reads it, for the app's two pages
 * of one student: an admin of one of their programs (`adminStudentFor`), or,
 * with `mentors`, a mentor who reaches them too. As on the page, an admin reads
 * their own programs and no trace of the others, and a mentor who doesn't run
 * one reads the whole record, every program's and every mentor's, with no
 * controls and no money. `mentorLens` is the page's lens: the headline is the
 * reader's own time with them rather than the student's whole balance.
 */
export async function studentRecordFor(
  reader: Reader,
  id: string,
  { mentors, mentorLens }: { mentors: boolean; mentorLens: boolean },
  now: Date = new Date()
): Promise<AdminStudent | null> {
  const profile = await profileOf(id);
  if (!profile) return null;
  const [manages, writes, reaches] = await Promise.all([
    canManageStudent(reader.user, profile),
    canAdministerStudent(reader.user, profile),
    canActAsMentor(reader.user) ? mentorReaches(reader.user, profile) : Promise.resolve(false),
  ]);
  if (!manages && !(mentors && reaches)) return null;
  const visible = manages ? await studentScope(reader.user, profile) : undefined;
  const enrollments = visible ? profile.enrollments.filter((e) => visible.includes(e.programId)) : profile.enrollments;

  const [hours, ledger, changes, inScope] = await Promise.all([
    allocationSummary(profile.id, visible),
    studentLedger(profile.id, visible),
    manages
      ? prisma.hourAllotmentChange.findMany({
          where: { studentId: profile.id, programId: { in: visible } },
          include: { mentor: true, program: true, changedBy: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : Promise.resolve([]),
    // The page's Allocate and each grant's Transfer offer every mentor in the
    // reader's programs, not only the student's own programs' mentors.
    manages ? mentorsIn(scopeProgramFilter(reader.read)) : Promise.resolve([]),
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

  // The website's own fold, from the file that draws "Time by mentor", so
  // Assigned is its rule exactly: the larger of the grant and the open plan
  // items' budgets for it, and a row of its own for a mentor with planned work
  // and no grant. Imported rather than copied, so the two cannot drift.
  const entries = timeByMentorEntries(toAllocationEntries(hours.perMentor), ledger.assignments);
  const grants = entries.map((entry): AdminGrant => {
    const program = programOf.get(entry.program.id);
    const bank = entry.bank ?? false;
    const edit = writes && scopeCovers(reader.write, entry.program.id) && entry.deadline != null && (!bank || bankAdmin.has(entry.program.id));
    const others = inScope.filter((m) => m.id !== entry.mentor?.id);
    return {
      program: { id: entry.program.id, name: entry.program.name, colorIndex: entry.program.colorIndex },
      mentor: entry.mentor ? { id: entry.mentor.id, name: nameOf(entry.mentor) } : null,
      bank,
      allocated: entry.allocated,
      assigned: entry.assigned ?? entry.allocated,
      completed: entry.completed,
      missed: entry.missed,
      remaining: entry.remaining,
      forfeited: entry.forfeited,
      deadline: entry.deadline ? toDateInputValue(entry.deadline) : null,
      daysLeft: entry.deadline ? daysAway(entry.deadline, now) : null,
      expired: entry.expired,
      // The money is the grant's, where the program bills per student, and only staff read it.
      amountPaid: manages && program && program.tracksPayment && !program.hourBank ? (entry.amountPaid ?? 0) : null,
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
  const advice = logAdvice({ hours, userId: reader.user.id, reaches, status: profile.user.status });
  // The page's Exchange and its Send on exchange: whom the reader may lend them from (`sendableFrom` there, the two
  // `assertExchangeSender` takes, never a visit), where to (every running program they aren't in), and who may call
  // one off (`isParty`).
  const [exchanges, myPairings, elsewhere] = await Promise.all([
    visibleExchanges(reader.user, profile),
    canActAsMentor(reader.user) ? prisma.mentorAssignment.findMany({ where: { mentorId: reader.user.id }, select: { programId: true } }) : Promise.resolve([]),
    prisma.program.findMany({
      where: { status: "ACTIVE", id: { notIn: profile.enrollments.map((e) => e.programId) } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const pairedIn = new Set(myPairings.map((p) => p.programId));
  const sendableFrom = studiesIn(profile.enrollments).filter((e) => scopeCovers(reader.write, e.programId) || pairedIn.has(e.programId));

  const headline = studentHeadline({ mentorLens: !manages || mentorLens, reaches, hours, userId: reader.user.id, now });
  const byProgram = await programLines(profile.id, enrollments);
  const tracksPayment = enrollments.some((e) => e.program.tracksPayment && !e.program.hourBank);
  return {
    student: {
      id: profile.id,
      userId: profile.userId,
      name: nameOf(profile.user),
      email: profile.user.email,
      telegram: profile.telegramUsername,
      folderUrl: profile.folderUrl,
      // In the page's Details, which only staff read.
      registered: manages ? toDateInputValue(profile.createdAt) : null,
    },
    approved: !pending,
    programs: sortEnrollments([...enrollments]).map((e) => ({
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
    lens: manages ? "staff" : "mentor",
    headline: headline ? { figure: headline.figure, rest: headline.rest ?? null, danger: headline.danger } : null,
    log: { can: advice.canLog, reason: advice.logReason ?? null, warns: advice.logWarns },
    byProgram: byProgram.map((line) => ({
      program: programRef(enrollments.find((e) => e.programId === line.id)!.program),
      name: line.name,
      allotted: line.allotted,
      completed: line.completed,
      remaining: line.remaining,
    })),
    paid: manages && tracksPayment ? hours.paid : null,
    can: {
      approve: pending && writes,
      reject: pending && writes,
      // The website's "Allocate time": the reader may change one of the student's programs, and a mentor works in theirs.
      allocate: writes && inScope.length > 0,
      reach: reaches,
      // The pencil on the name: both readers of the page own it (`StudentNameChange`).
      rename: writes || reaches,
    },
    manage: writes
      ? {
          enrollments: sortEnrollments([...enrollments]).map((e) => ({
            id: e.id,
            program: programRef(e.program),
            levelId: e.levelId,
            cohortId: e.cohortId,
            label: enrollmentLabel(e),
          })),
          // Archived included, as the page's: a student may be in one, and the move has to show where they are.
          choices: toProgramOptions(await programOptions(scopeProgramFilter(reader.read), true)),
          hasSessions: ledger.sessions.some((s) => s.status !== SESSION_STATUS.VOIDED),
        }
      : null,
    exchanges: exchanges.map((e) => apiExchange(e, { canReturn: exchangeParty(e, reader.user.id, reader.write), withStudent: false, now })),
    lend: sendableFrom.length > 0 ? { from: sendableFrom.map((e) => ({ id: e.programId, label: enrollmentLabel(e) })), to: elsewhere } : null,
    today: programToday(now),
  };
}

const programRef = (p: { id: string; name: string; colorIndex: number }) => ({ id: p.id, name: p.name, colorIndex: p.colorIndex });
