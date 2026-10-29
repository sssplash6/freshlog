import "server-only";

import { formatRough } from "@/lib/format";

import type { Reader } from "@/lib/api/v1/sessions";
import { toTodoRows } from "@/lib/api/v1/todo";
import type { AdminHome, ProgramRow, TodoRow } from "@/lib/api/v1/types";
import { staffAttention } from "@/lib/attention";
import { scopeCovers, scopeProgramFilter } from "@/lib/authz";
import { PROGRAM_STATUS, USER_STATUS } from "@/lib/constants";
import { programTotals } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { studentsWithHours, type StudentWithHours } from "@/lib/queries";
import { EXPIRY_WINDOW_DAYS } from "@/lib/status";
import { daysAway, programToday } from "@/lib/when";

/**
 * What /admin shows a program admin, for the freshlog app: the school in a few
 * figures, each program's, and the staff's list of what needs them.
 *
 * Every figure is the website's, asked of the same functions with the same
 * reads (`app/admin/page.tsx`): the programs in the reader's read scope, every
 * student in them with their hours (`studentsWithHours`), and the pairings.
 * What this file adds is the mapping, and the `can` flags, which come from the
 * write scope: a Leader or Sales grant reads all of it and changes none.
 */

/** What one read of the reader's school holds: the three reads /admin makes, at one instant. */
export type School = {
  now: Date;
  programs: { id: string; name: string; colorIndex: number; status: string }[];
  students: StudentWithHours[];
  pairings: { mentorId: string; programId: string }[];
};

/**
 * The reader's programs, their students with hours, and their pairings, read
 * once with the read scope applied to each. `undefined` in the filter is a
 * platform admin and means every program.
 */
export async function schoolOf(reader: Reader, now: Date = new Date()): Promise<School> {
  const programIds = scopeProgramFilter(reader.read);
  const inScope = programIds ? { in: [...programIds] } : undefined;
  const [programs, students, pairings] = await Promise.all([
    prisma.program.findMany({
      where: inScope ? { id: inScope } : {},
      select: { id: true, name: true, colorIndex: true, status: true },
    }),
    studentsWithHours(inScope ? { enrollments: { some: { programId: inScope } } } : {}, { now, programIds }),
    prisma.mentorAssignment.findMany({
      where: inScope ? { programId: inScope } : {},
      select: { mentorId: true, programId: true },
    }),
  ]);
  return { now, programs, students, pairings };
}

/**
 * Each program as a row, running ones first and then archived, each by name as
 * people read it (SQLite orders by code point, and the website re-sorts).
 *
 * A program's figures are that program's for each student in it, never the
 * student's combined row, which would put another program's hours in this
 * total and count a two-program student twice.
 */
export function programRows(reader: Reader, school: School): ProgramRow[] {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const archived = (p: { status: string }) => p.status === PROGRAM_STATUS.ARCHIVED;
  const programs = [...school.programs].sort((a, b) => Number(archived(a)) - Number(archived(b)) || byName(a, b));
  return programs.map((p) => {
    const totals = programTotals(school.students.flatMap((s) => {
      const figures = s.byProgram.get(p.id);
      return figures ? [figures] : [];
    }));
    return {
      program: { id: p.id, name: p.name, colorIndex: p.colorIndex },
      archived: archived(p),
      students: totals.students,
      mentors: new Set(school.pairings.filter((a) => a.programId === p.id).map((a) => a.mentorId)).size,
      allotted: totals.allotted,
      used: totals.completed + totals.missed,
      forfeited: totals.forfeited,
      remaining: totals.remaining,
      // The Programs page's own words for both, rounded as it rounds them (`formatRough`).
      rough: { remaining: formatRough(totals.remaining), forfeited: totals.forfeited > 0 ? formatRough(totals.forfeited) : null },
      can: { write: scopeCovers(reader.write, p.id) },
    };
  });
}

/**
 * The staff's To do as the contract's rows, with no `log` on any of them.
 *
 * `toTodoRow` prefills a session to log on every ALLOCATION_EXPIRING row about
 * a student, which is a mentor's answer to time running out. An admin's is a
 * grant, and an admin who logs does it on somebody's behalf, from a sheet that
 * asks whose meeting it was.
 */
export async function staffTodo(reader: Reader, school: School): Promise<{ todo: TodoRow[]; spilled: number }> {
  // `staffAttention` directly, never `attentionFor`: a bearer request carries no
  // lens cookie, and an admin who is also a student would be handed their own list.
  const attention = await staffAttention(reader.user, {
    now: school.now,
    programs: school.programs.map(({ id, name }) => ({ id, name })),
    students: school.students,
  });
  const rows = await toTodoRows(attention.statuses);
  return { todo: rows.map((row) => ({ ...row, log: null })), spilled: attention.spilled };
}

/** The admin's home. The route has already turned away a reader with nothing to read. */
export async function adminHomeFor(reader: Reader, now: Date = new Date()): Promise<AdminHome> {
  const school = await schoolOf(reader, now);
  const [{ todo, spilled }, unread] = await Promise.all([
    staffTodo(reader, school),
    prisma.notification.count({ where: { userId: reader.user.id, read: false } }),
  ]);
  const { students } = school;
  // Over the combined rows, as the website's strip sums them: each student once.
  const overall = programTotals(students);
  return {
    summary: {
      remaining: overall.remaining,
      students: overall.students,
      programs: school.programs.length,
      pending: students.filter((s) => s.user.status === USER_STATUS.PENDING).length,
      // The staff's window, as ALLOCATION_EXPIRING reckons it: today counts.
      expiring: students.filter((s) => {
        if (!s.expiring) return false;
        const days = daysAway(s.expiring.date, now);
        return days >= 0 && days <= EXPIRY_WINDOW_DAYS.staff;
      }).length,
    },
    programs: programRows(reader, school),
    todo,
    todoSpilled: spilled,
    unread,
    platformAdmin: reader.user.platformAdmin,
    today: programToday(now),
  };
}
