import "server-only";

import { DISPUTED, nameOf } from "@/lib/api/v1/sessions";
import { toTodoRows } from "@/lib/api/v1/todo";
import type { CaseloadRow, MentorHome } from "@/lib/api/v1/types";
import { caseloadStatuses } from "@/lib/attention";
import { canActAsMentor } from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";
import { unreadOf } from "@/lib/api/v1/inbox";
import { prisma } from "@/lib/prisma";
import { type CaseloadStudent } from "@/lib/queries";
import { forfeitedOf, mentorHomeView, type MentorHomeParams } from "@/lib/screens/mentor-home";
import { SEVERITY_RANK, type Status, type ViewerContext } from "@/lib/status";
import { daysAway } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

/**
 * What /mentor shows a mentor, for the freshlog app: who they hold time with and
 * how each stands, and the list the website's bell shows them.
 *
 * Read through the page's own `mentorHomeView`, with the page's own tabs and
 * order (`params`), so the app says what the page beside it says: the same
 * rows in the same order, the time to claim apart, the figures following the
 * tabs. What this file adds is the mapping into the contract's shapes.
 */

/**
 * The home of `user`, who must be able to act as a mentor.
 *
 * `now` is the instant each row's days left and status are reckoned from. The
 * To do list is freshform's own and is read at the moment it is asked.
 */
export async function mentorHomeFor(user: User, params: MentorHomeParams = {}, now: Date = new Date()): Promise<MentorHome> {
  // `attentionFor` answers somebody who cannot act as a mentor with their own
  // lens's list, whatever lens it is asked for: the staff's, for an admin, and a
  // student's own, for a student. Neither is a mentor's To do. The route turns
  // such a person away first; this is here so that forgetting to cannot hand
  // one over.
  if (!canActAsMentor(user)) throw new Error("mentorHomeFor: this person cannot act as a mentor");

  const [view, disputed, unread] = await Promise.all([
    // The mentor's frame, always: a bearer request carries no lens cookie, and
    // without one a mentor who also administers would be read as an admin.
    mentorHomeView(user, params, now, async () => "mentor"),
    // The ledger's own rule, so this is what its `answer=disputed` lists.
    prisma.session.count({ where: { AND: [{ mentorId: user.id }, DISPUTED] } }),
    unreadOf(user.id),
  ]);
  const { viewer } = view;
  const row = (s: CaseloadStudent) => toCaseloadRow(s, viewer, view);
  const todo = await toTodoRows(view.attention.statuses);
  // The program tabs as the page draws them: each program the mentor is paired in, once, in the order it came.
  const tabs = new Map<string, { id: string; name: string; colorIndex: number }>();
  for (const a of view.assignments) {
    if (!tabs.has(a.programId)) tabs.set(a.programId, { id: a.program.id, name: a.program.name, colorIndex: a.program.colorIndex });
  }

  return {
    summary: {
      // The page's strip: what is left and what is done, of the students in
      // view, following the tabs; an overdraw nets against what is left.
      remaining: view.remaining,
      completed: view.completed,
      // The page's Your students count: one a (student, program) row, the time to claim apart.
      students: view.inView.length,
      // Rows with time running out, whatever else is wrong with them.
      expiring: view.inView.filter((s) => caseloadStatuses(s, viewer).some((st) => st.type === "ALLOCATION_EXPIRING")).length,
      disputed,
    },
    // In freshform's order (`attentionList`): what asks something of the mentor
    // before what only tells them, the worst first.
    todo,
    // The page's Your students, in its order: whoever needs the mentor first, or the order asked.
    students: view.sortedCaseload.map(row),
    // The page's Time to claim, apart from them.
    claim: view.claimRows.map(row),
    tabs: { programs: [...tabs.values()], levels: view.caseloadLevels.map((l) => ({ id: l.id, name: l.name })) },
    view: {
      program: view.selected || null,
      level: view.selectedLevel || null,
      sort: (view.asked?.key as MentorHome["view"]["sort"]) ?? null,
      dir: view.asked?.dir ?? null,
    },
    columns: { program: view.showProgram, level: view.showLevel },
    ...unread,
    // How many rows the website's cap left out of To do, so a capped list cannot
    // read as a whole one.
    todoSpilled: view.attention.spilled,
  };
}

/** One (student, program) row of the caseload, in the contract's words. */
function toCaseloadRow(
  s: CaseloadStudent,
  viewer: ViewerContext,
  view: { levelOf: (s: CaseloadStudent) => { name: string } | null; lastSeen: Map<string, Date | null> }
): CaseloadRow {
  const { profile } = s;
  const seen = view.lastSeen.get(profile.id);
  return {
    student: { id: profile.id, userId: profile.user.id, name: nameOf(profile.user) },
    program: { id: s.program.id, name: s.program.name, colorIndex: s.program.colorIndex },
    allocated: s.allocated,
    remaining: s.remaining,
    useBy: s.deadline ? toDateInputValue(s.deadline) : null,
    daysLeft: s.deadline ? daysAway(s.deadline, viewer.now) : null,
    expired: s.expired,
    // Unassigned time, which a meeting claims. A bank is not that: every meeting
    // draws it, whoever holds it, so it is not "time to claim".
    pool: s.bank ? null : (s.pool ?? null),
    // What is left in the bank, which the website's caseload reads from the same
    // `pool` when the row is a bank.
    bankLeft: s.bank ? (s.pool ?? 0) : null,
    approved: s.approved,
    status: mostSerious(caseloadStatuses(s, viewer)),
    telegram: profile.telegramUsername,
    email: profile.user.email,
    // The page's Level column, in an institute.
    level: view.levelOf(s)?.name ?? null,
    // The page's Last session: the latest that counts with this mentor.
    lastSession: seen ? toDateInputValue(seen) : null,
    // What the page says an expired row lost ("6h 30m expired").
    forfeited: forfeitedOf(s),
  };
}

/**
 * The status of a row that matters most, which is the one with the worst
 * severity. Of two as bad, the one freshform lists first: account first, then
 * the balance, then the use-by date.
 */
function mostSerious(statuses: Status[]): CaseloadRow["status"] {
  let worst: Status | undefined;
  for (const status of statuses) {
    if (!worst || SEVERITY_RANK[status.severity] < SEVERITY_RANK[worst.severity]) worst = status;
  }
  return worst ? { type: worst.type, severity: worst.severity } : null;
}
