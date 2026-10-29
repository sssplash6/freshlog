import "server-only";

import { STUDENT_SORTS } from "@/components/students-table";
import { parsePage, PAGE_SIZE } from "@/components/ui/pagination";
import { SESSION_STATUS } from "@/lib/constants";
import { readParam, readTimeState, studentsWhere, type SearchParams } from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import { studentsWithHours } from "@/lib/queries";
import { applySort, readSort } from "@/lib/sort";
import { timeStateHolds } from "@/lib/status";

/**
 * A program's page, read once for the website (`app/programs/[id]/page.tsx`)
 * and the freshlog app (`/api/v1/programs/:id/roster` and `/programs/:id`):
 * moved here from the page, unchanged, so the two can't tell a program
 * differently. The page's comments came with the code they explain.
 */

/** Enough to see what has been happening; the rest is Sessions' job. */
export const RECENT_SESSIONS = 6;

type Level = { id: string; name: string };
type Cohort = { id: string; name: string; levelId: string | null };

/**
 * The roster as the page lists it: `/students` (§6.8) with the program fixed,
 * same `where`, same paging, and the hours this program's.
 */
export async function programRoster<L extends Level>(
  userId: string,
  id: string,
  query: SearchParams,
  now: Date,
  { levels, cohorts }: { levels: readonly L[]; cohorts: readonly Cohort[] }
) {
  const page = parsePage(readParam(query, "page"));
  const where = studentsWhere(
    query,
    { audience: "staff", userId, programIds: [id] },
    now
  );
  // THE WHOLE FILTERED SET, then the order, then the page — in that sequence
  // and not the database's. Completed and Remaining are computed per row from
  // the grants and the sessions behind them (`studentsWithHours`), so they do
  // not exist until the rows are in memory: letting SQL take twenty-five rows
  // first and ordering those would order one page of forty and call it the
  // list. A program's roster is the size of a program, and the layout above
  // already reads every row of it for the figures in the masthead.
  const matching = await studentsWithHours(where, {
    now,
    // This page IS one program, so the hours on it are that program's.
    programIds: [id],
  });
  const asked = readSort(
    {
      ...(readParam(query, "sort") ? { sort: readParam(query, "sort") } : {}),
      ...(readParam(query, "dir") ? { dir: readParam(query, "dir") } : {}),
    },
    STUDENT_SORTS
  );
  // The `?time=` chip asks the bell's question, so it gets the bell's answer:
  // `studentsWhere` can only see that a grant's date is in the window, and
  // `timeStateHolds` asks whether its minutes survived to it. The figures here
  // are already this program's.
  const timeFilter = readTimeState(query);
  const visible = timeFilter
    ? matching.filter((s) =>
        timeStateHolds(timeFilter, s, { audience: "staff", now })
      )
    : matching;
  // The level this roster is narrowed to, when the tab above names one of
  // this program's — anything else in `?level=` already matched nobody.
  const level = levels.find((l) => l.id === readParam(query, "level")) ?? null;
  // A cohort as this roster names it. Under a level tab the level goes without
  // saying; on "All students" it leads, because "Fall 2026" under Emerging and
  // under Advanced are two intakes — and leading, it sorts them level by level.
  const cohortOf =
    cohorts.length > 0
      ? (s: (typeof matching)[number]) => {
          const here = s.byProgram.get(id);
          if (!here?.cohort) return null;
          return here.level && !level
            ? `${here.level.name} · ${here.cohort.name}`
            : here.cohort.name;
        }
      : undefined;
  const ordered = asked
    ? applySort(visible, asked, {
        student: (s) => s.user.name ?? s.user.email,
        completed: (s) => s.completedMinutes,
        total: (s) => s.allottedMinutes,
        remaining: (s) => s.remainingMinutes,
        deadline: (s) => s.expiring?.date,
        seen: (s) => s.lastSessionAt,
        cohort: (s) => cohortOf?.(s),
      })
    : visible;
  const total = ordered.length;
  const students = ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return { page, total, students, level, cohortOf };
}

/** The program's latest sessions, under the roster. Struck-off rows are left to Sessions' ledger. */
export function programRecent(id: string) {
  return prisma.session.findMany({
    where: { programId: id, status: SESSION_STATUS.ACTIVE },
    include: {
      mentor: true,
      student: { include: { user: true } },
      assignment: { select: { id: true, purpose: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: RECENT_SESSIONS,
  });
}

type Person = { id: string; name: string | null; email: string; avatarUpdatedAt?: Date | null };

/**
 * The program's people, as its Mentors rail lists them.
 *
 * One line per MENTOR: somebody paired with three cohorts of this program is
 * one person teaching here, not three rows. The cohort names themselves are
 * not on the line — programs are flat by default, so on a list of fourteen
 * it was one bare date beside one name, reading as a mystery rather than a
 * fact. Settings is where a pairing's cohort is set and shown.
 *
 * EVERYONE WHO WORKS HERE, not only everyone paired to teach: somebody who
 * administers this program without a pairing in it belongs on the one list
 * of its people, and leaving them off made a program run by one admin who
 * does not mentor read as a program with nobody in it. The pairings lead,
 * in the order they were made, and the admins who teach nothing follow.
 */
export function programPeople(
  pairings: readonly { mentorId: string; mentor: Person }[],
  grants: readonly { role: string; user: Person }[]
) {
  const mentors = new Map<
    string,
    {
      mentor: Person;
      /** Paired to teach here. False for an admin who only administers it. */
      teaches: boolean;
    }
  >();
  for (const p of pairings) {
    const held = mentors.get(p.mentorId);
    mentors.set(p.mentorId, held ?? { mentor: p.mentor, teaches: true });
  }
  for (const grant of grants) {
    if (!mentors.has(grant.user.id)) {
      mentors.set(grant.user.id, { mentor: grant.user, teaches: false });
    }
  }
  const mentorRows = [...mentors.values()];
  const superAdminIds = new Set(
    grants.filter((grant) => grant.role === "ADMIN").map((grant) => grant.user.id),
  );
  return { mentorRows, superAdminIds };
}
