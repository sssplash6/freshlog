import "server-only";

import { attentionFor } from "@/lib/attention";
import { SESSION_STATUS } from "@/lib/constants";
import { formatBalance, formatDuration } from "@/lib/format";
import { mentorOwnTasks } from "@/lib/mentor-tasks";
import { prisma } from "@/lib/prisma";
import type { Profile } from "@/lib/profile";
import { mentorCaseload, type CaseloadStudent } from "@/lib/queries";
import { applySort, readSort } from "@/lib/sort";
import { spaceOf } from "@/lib/space";
import type { ViewerContext } from "@/lib/status";
import type { User } from "@/generated/prisma/client";

/**
 * A mentor's Home, read once for the website (`app/mentor/page.tsx`) and the
 * freshlog app (`/api/v1/mentor/home`): moved here from the page, unchanged, so
 * the two can't tell a caseload differently. The page's comments came with the
 * code they explain.
 */

/**
 * What a caseload row's balance says, in the words and the ink it is said in.
 *
 * One answer for the table cell, the phone row and the sort, so the three can
 * never disagree. Two states used to be drawn wrong: hours that expired unused
 * read "0 min", as if the student had spent them, and a student whose only
 * time sat in the unassigned pool read "—", as if there were none.
 */
export function balanceOf(s: CaseloadStudent): {
  text: string;
  /** The page's ink for it (its `TONE`). */
  tone: "danger" | "ink" | "muted";
  /** 0 needs the mentor first, 1 holds time, 2 has time to claim, 3 nothing. */
  rank: 0 | 1 | 2 | 3;
} {
  const forfeited = s.expired
    ? Math.max(0, s.allocated - s.completed - s.missed)
    : 0;
  if (s.remaining < 0) {
    return { text: formatBalance(s.remaining), tone: "danger", rank: 0 };
  }
  if (forfeited > 0) {
    return { text: `${formatDuration(forfeited)} expired`, tone: "danger", rank: 0 };
  }
  if (s.remaining > 0) {
    return { text: formatDuration(s.remaining), tone: "ink", rank: 1 };
  }
  if (s.pool && s.pool > 0) {
    return {
      text: `${formatDuration(s.pool)} ${s.bank ? "in their bank" : "unassigned"}`,
      tone: "muted",
      rank: 2,
    };
  }
  // Nothing granted and nothing spent: an em dash, not "0 min", which reads as
  // time that ran out.
  if (s.allocated === 0) return { text: "—", tone: "muted", rank: 3 };
  return { text: formatDuration(0), tone: "muted", rank: 3 };
}

/**
 * The page's own order, when the reader has not asked for one: whoever needs
 * the mentor first. Expired or overdrawn time leads, then time that is still
 * theirs by soonest use-by date, then time waiting to be claimed.
 *
 * It sorted by the largest balance, which put the one student whose hours had
 * already run out twelfth of thirteen, below the fold — and a student due to
 * lose eight hours next week sixth, under four who had until February.
 */
export function byUrgency(a: CaseloadStudent, b: CaseloadStudent): number {
  const ra = balanceOf(a).rank;
  const rb = balanceOf(b).rank;
  if (ra !== rb) return ra - rb;
  const da = a.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
  const db = b.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  if (a.remaining !== b.remaining) return b.remaining - a.remaining;
  return nameOf(a).localeCompare(nameOf(b));
}

export const nameOf = (s: CaseloadStudent) => s.profile.user.name ?? s.profile.user.email;

/** What each of those headings orders by. `Column.sort` names the key. */
export const CASELOAD_SORTS = [
  "student",
  "program",
  "level",
  "remaining",
  "deadline",
  "seen",
] as const;

/** What the page is asked: a program tab, a level tab, and an order. */
export type MentorHomeParams = { program?: string; level?: string; sort?: string; dir?: string };

/**
 * Everything the page reads and works out before it draws. `lensOf` is the
 * frame the shell draws in: the cookie's, on the website; the mentor's, always,
 * for the app, which reads this home only as a mentor.
 */
export async function mentorHomeView(
  user: User,
  { program = "", level = "", sort, dir }: MentorHomeParams,
  now: Date,
  lensOf: (user: User) => Promise<Profile>
) {
  // One instant for the whole page, so two sections cannot disagree about what
  // "today" is — and so nothing reads the clock during a render.
  const viewer: ViewerContext = { audience: "mentor", userId: user.id, now };

  const [caseload, attention, adminTasks, space] = await Promise.all([
    mentorCaseload(user.id),
    attentionFor(user, "mentor"),
    mentorOwnTasks(user.id, viewer.now),
    // The frame the shell already drew, asked again for free (request-cached).
    lensOf(user).then((lens) => spaceOf(user, lens)),
  ]);
  const openAdminTasks = adminTasks.filter((a) => !a.completedAt).length;
  const { students, assignments } = caseload;

  // The date of this mentor's most recent session with each student. A
  // caseload row without it cannot answer "who have I not seen in a while",
  // which is the whole reason to look at the list.
  const lastSessions = await prisma.session.groupBy({
    by: ["studentId"],
    where: { mentorId: user.id, status: SESSION_STATUS.ACTIVE },
    _max: { date: true },
  });
  const lastSeen = new Map(lastSessions.map((s) => [s.studentId, s._max.date]));

  const programs = new Map<string, string>();
  for (const a of assignments) {
    if (!programs.has(a.programId)) programs.set(a.programId, a.program.name);
  }
  const selected = programs.has(program) ? program : "";
  // A caseload row is one (student, program) balance, so filtering by program
  // is a question about the row rather than about the person: a student in two
  // of this mentor's programs contributes one row to each.
  const inProgram = selected ? students.filter((s) => s.program.id === selected) : students;

  // In an institute every row is the one program, so the program tabs never
  // appear, and what a mentor there tells their students apart by is the
  // level. A row's level is the student's membership in the row's program —
  // the ledger carries none, so it is their level now (lib/space.ts).
  const institute = space.kind === "institute" ? space : null;
  const levelOf = (s: CaseloadStudent) => {
    if (!institute || s.program.id !== institute.programId) return null;
    const id = s.profile.enrollments.find((e) => e.programId === s.program.id)?.levelId;
    return institute.levels.find((l) => l.id === id) ?? null;
  };
  // Only the levels somebody in the caseload is in, in the sidebar's order: a
  // tab that can only ever show an empty table is a question with no answer.
  const caseloadLevels = institute
    ? institute.levels.filter((l) => students.some((s) => levelOf(s)?.id === l.id))
    : [];
  const selectedLevel = caseloadLevels.some((l) => l.id === level) ? level : "";
  const inLens = selectedLevel
    ? inProgram.filter((s) => levelOf(s)?.id === selectedLevel)
    : inProgram;
  // Unassigned time is every mentor's in the program to claim, so the same
  // student sat in "Your students" for each of them, and mentors wrote in
  // asking why somebody else's students were assigned to them. They are still
  // reached — the caseload, the log picker and the student's page all keep
  // them — but listed apart, as time to claim rather than as students. A bank
  // stays in the caseload: every meeting draws it, whoever delivers it.
  const toClaim = (s: CaseloadStudent) => s.reach === "pool" && !s.bank;
  const inView = inLens.filter((s) => !toClaim(s));
  const claimRows = inLens.filter(toClaim).sort(byUrgency);

  // -------------------------------------------------------------- Title figure
  //
  // The balance as every other page sums it — the mentor's own record, a
  // program's header — so an overdraw nets against what is left. Summing only
  // the positive rows made "Remaining" here 2h larger than the same mentor's
  // record said, under a label counting one student above a table of three.
  const remaining = inView.reduce((sum, s) => sum + s.remaining, 0);
  // Everything this mentor has actually delivered against the grants in view.
  // Lifetime, and it moves with the program tabs, because the question is
  // "what have I done here" and the tabs are how a mentor asks it of one
  // program.
  // Meetings drawn from a student's hour bank count too: the mentor held
  // them, and the admin's page for this mentor already says so.
  const completed = inView.reduce((sum, s) => sum + s.completed + (s.bankCompleted ?? 0), 0);

  // Two rows for one student in two programs is not a duplicate, and the
  // column is what says so.
  const showProgram = new Set(inView.map((s) => s.program.id)).size > 1;
  // The same rule one step down: under a level tab every row says the same.
  const showLevel = new Set(inView.map((s) => levelOf(s)?.id ?? null)).size > 1;

  // The reader's own order when they have asked for one; otherwise the page's,
  // which is the answer to "who needs me first".
  const asked = readSort(
    { ...(sort ? { sort } : {}), ...(dir ? { dir } : {}) },
    CASELOAD_SORTS
  );
  const sortedCaseload = asked
    ? applySort(inView, asked, {
        student: nameOf,
        program: (s) => s.program.name,
        level: (s) => levelOf(s)?.name ?? null,
        remaining: (s) => s.remaining,
        deadline: (s) => s.deadline,
        seen: (s) => lastSeen.get(s.profile.id) ?? null,
      })
    : [...inView].sort(byUrgency);
  return {
    viewer,
    caseload,
    attention,
    adminTasks,
    openAdminTasks,
    space,
    students,
    assignments,
    lastSeen,
    programs,
    selected,
    inProgram,
    institute,
    levelOf,
    caseloadLevels,
    selectedLevel,
    inLens,
    inView,
    claimRows,
    remaining,
    completed,
    showProgram,
    showLevel,
    asked,
    sortedCaseload,
  };
}
