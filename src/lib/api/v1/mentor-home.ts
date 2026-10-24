import "server-only";

import { DISPUTED, nameOf } from "@/lib/api/v1/sessions";
import { toTodoRows } from "@/lib/api/v1/todo";
import type { CaseloadRow, MentorHome } from "@/lib/api/v1/types";
import { attentionFor, caseloadStatuses } from "@/lib/attention";
import { canActAsMentor } from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { mentorCaseload, type CaseloadStudent } from "@/lib/queries";
import { SEVERITY_RANK, type Status, type ViewerContext } from "@/lib/status";
import { daysAway } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

/**
 * What /mentor shows a mentor, for the freshlog app: who they hold time with and
 * how each stands, and the list the website's bell shows them.
 *
 * Every figure is one the website already computes, asked of the same functions
 * (`mentorCaseload`, `attentionFor`), so the app says what the page beside it
 * says. What this file adds is the mapping into the contract's shapes.
 */

/**
 * The home of `user`, who must be able to act as a mentor.
 *
 * `now` is the instant each row's days left and status are reckoned from. The
 * To do list is freshform's own and is read at the moment it is asked.
 */
export async function mentorHomeFor(user: User, now: Date = new Date()): Promise<MentorHome> {
  // `attentionFor` answers somebody who cannot act as a mentor with their own
  // lens's list, whatever lens it is asked for: the staff's, for an admin, and a
  // student's own, for a student. Neither is a mentor's To do. The route turns
  // such a person away first; this is here so that forgetting to cannot hand
  // one over.
  if (!canActAsMentor(user)) throw new Error("mentorHomeFor: this person cannot act as a mentor");

  const viewer: ViewerContext = { audience: "mentor", userId: user.id, now };
  const [{ students }, attention, disputed] = await Promise.all([
    mentorCaseload(user.id),
    // The literal "mentor", never `profileOf(user)`: a bearer request carries no
    // lens cookie, and without one a mentor who also administers is read as an
    // admin and handed the staff's list.
    attentionFor(user, "mentor"),
    // The ledger's own rule, so this is what its `answer=disputed` lists.
    prisma.session.count({ where: { AND: [{ mentorId: user.id }, DISPUTED] } }),
  ]);

  const rows = students.map((s) => toCaseloadRow(s, viewer));
  const todo = await toTodoRows(attention.statuses);

  return {
    summary: {
      // The balance as every freshform page sums it, so an overdraw nets against
      // what is left: summing only the positive rows made the website's figure
      // larger than the same mentor's record said (src/app/mentor/page.tsx).
      remaining: rows.reduce((sum, row) => sum + row.remaining, 0),
      // A student in two of the mentor's programs is two rows and one student.
      students: new Set(rows.map((row) => row.student.id)).size,
      expiring: rows.filter((row) => row.status?.type === "ALLOCATION_EXPIRING").length,
      disputed,
    },
    // In freshform's order (`attentionList`): what asks something of the mentor
    // before what only tells them, the worst first.
    todo,
    // In `mentorCaseload`'s order. The website sorts by urgency on top of it,
    // but only for the table it draws.
    students: rows,
    // Task F6 fills these; until it lands they are zero so the contract holds.
    unread: 0,
    todoSpilled: 0,
  };
}

/** One (student, program) row of the caseload, in the contract's words. */
function toCaseloadRow(s: CaseloadStudent, viewer: ViewerContext): CaseloadRow {
  const { profile } = s;
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
