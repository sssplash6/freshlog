import "server-only";

import { nameOf, type Reader } from "@/lib/api/v1/sessions";
import type { RosterPage, RosterQuery, RosterRow } from "@/lib/api/v1/types";
import { scopeProgramFilter } from "@/lib/authz";
import { USER_STATUS } from "@/lib/constants";
import { sortEnrollments } from "@/lib/enrollments";
import { studentsWhere, type SearchParams } from "@/lib/filters";
import { toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { studentsWithHours, type StudentWithHours } from "@/lib/queries";
import { applySort } from "@/lib/sort";
import { timeStateHolds } from "@/lib/status";
import { daysAway, programToday } from "@/lib/when";
import { programCohorts, programLevels } from "@/app/programs/reads";
import { programRoster } from "@/lib/screens/program";
import type { Program } from "@/generated/prisma/client";

/**
 * The admin's roster, as the website's /students reads it for somebody who
 * administers (`app/students/page.tsx`): the students in the reader's read
 * scope, their figures summed over those programs only, 25 a page.
 *
 * Paged the way that page pages. By name, the database slices. A `time` filter,
 * or any other order, is a question asked of figures summed after the query,
 * so the whole matching set is read and filtered, ordered and paged here. The
 * website's own comment prices that at this school's size.
 */

const PAGE_SIZE = 25;

/** The page of the roster `query` asks for. */
export async function rosterFor(reader: Reader, query: RosterQuery, now: Date = new Date()): Promise<RosterPage> {
  const programIds = scopeProgramFilter(reader.read);
  // The website's own filters, by the website's own names. `program`, `level`
  // and `cohort` can only narrow inside the scope `studentsWhere` ANDs in first.
  const params: SearchParams = {
    q: query.q,
    program: query.program,
    level: query.level,
    cohort: query.cohort,
    status: query.status,
    time: query.time,
  };
  const where = studentsWhere(params, { audience: "staff", userId: reader.user.id, programIds }, now);
  const page = query.page ?? 1;
  const sort = query.sort && query.sort !== "student" ? query.sort : null;
  const readAll = sort !== null || query.time !== undefined;

  const [programs, matching, total] = await Promise.all([
    prisma.program.findMany({
      where: programIds ? { id: { in: [...programIds] } } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true, colorIndex: true },
    }),
    studentsWithHours(where, {
      ...(readAll ? {} : { slice: { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE } }),
      now,
      programIds,
    }),
    prisma.studentProfile.count({ where }),
  ]);

  const lens = { audience: "staff" as const, now };
  const time = query.time;
  const visible = time
    ? matching.filter((s) => {
        // Filtered to a program, the question is asked of that program's figures.
        const figures = query.program ? s.byProgram.get(query.program) : s;
        return figures != null && timeStateHolds(time, figures, lens);
      })
    : matching;
  const shown = time ? visible.length : total;
  // The most urgent first: the least left, the soonest to run out, the longest since a session.
  const ordered = sort
    ? applySort(visible, { key: sort, dir: "asc" }, {
        remaining: (s) => s.remainingMinutes,
        deadline: (s) => s.expiring?.date,
        seen: (s) => s.lastSessionAt,
      })
    : visible;
  const rows = readAll ? ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : ordered;

  return {
    rows: rows.map((s) => toRosterRow(s, now)),
    page,
    pages: Math.max(1, Math.ceil(shown / PAGE_SIZE)),
    shown,
    programs: programs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    today: programToday(now),
  };
}

/** One student, field by field: the row carries the whole User, and none of it but these belongs on a phone. */
export function toRosterRow(s: StudentWithHours, now: Date): RosterRow {
  return {
    student: { id: s.id, userId: s.userId, name: nameOf(s.user) },
    approved: s.user.status !== USER_STATUS.PENDING,
    signedIn: s.telegramUsername != null,
    programs: sortEnrollments(s.enrollments).map((e) => ({ id: e.program.id, name: e.program.name, colorIndex: e.program.colorIndex })),
    completed: s.completedMinutes,
    remaining: s.remainingMinutes,
    used: s.completedMinutes + s.missedMinutes,
    forfeited: s.forfeitedMinutes,
    expiring: s.expiring
      ? { minutes: s.expiring.minutes, day: toDateInputValue(s.expiring.date), daysLeft: daysAway(s.expiring.date, now) }
      : null,
    lastSession: s.lastSessionAt ? toDateInputValue(s.lastSessionAt) : null,
    // `canManageStudent` turns away a student in no program, even for a
    // platform admin, who is the only reader such a row reaches.
    openable: s.enrollments.length > 0,
  };
}

/**
 * A program's roster as its page lists it (`app/programs/[id]/page.tsx`, read
 * through `programRoster`): the hours this program's, not the sum over every
 * program the reader reads, which is `/students`' rule and `rosterFor`'s. The
 * page's own filters, order and paging.
 */
export async function programRosterFor(program: Program, reader: Reader, query: RosterQuery, now: Date = new Date()): Promise<RosterPage> {
  const [levels, cohorts] = await Promise.all([programLevels(program.id), programCohorts(program.id)]);
  // The page's own params, by the page's own names. The program is the page itself, so `program` is not one.
  const params: SearchParams = {
    q: query.q,
    level: query.level,
    cohort: query.cohort,
    status: query.status,
    time: query.time,
    sort: query.sort,
    page: query.page ? String(query.page) : undefined,
  };
  const { page, total, students } = await programRoster(reader.user.id, program.id, params, now, { levels, cohorts });
  return {
    rows: students.map((s) => toRosterRow(s, now)),
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    shown: total,
    programs: [{ id: program.id, name: program.name, colorIndex: program.colorIndex }],
    today: programToday(now),
  };
}
