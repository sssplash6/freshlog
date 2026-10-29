import "server-only";

import { slotTime } from "@/lib/api/v1/practice";
import { nameOf, readerFor, SESSION_INCLUDE, toApiSession } from "@/lib/api/v1/sessions";
import { toTodoRows } from "@/lib/api/v1/todo";
import { workOf } from "@/lib/api/v1/work";
import type { HomeMeeting, StudentGrant, StudentHome } from "@/lib/api/v1/types";
import { studentRows } from "@/lib/attention";
import { toDateInputValue } from "@/lib/format";
import { templateName } from "@/lib/interview-templates";
import { agendaLists, isFirstRun, withoutRepeats } from "@/lib/screens/student-home";
import { meetingCount, meetingLog } from "@/lib/session-entries";
import { interviewsForLog } from "@/lib/student-interviews";
import { allocationSummary, type AllocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { assignmentsForStudentWhere, studentLedger, type LedgerSession } from "@/lib/queries";
import { EXPIRY_WINDOW_DAYS, sessionStatuses, type ViewerContext } from "@/lib/status";
import { daysAway, programToday } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

/**
 * What /student shows a student, for the freshlog app: their hours, whose time
 * each part of them is and how to book it, and the list the website calls
 * "Things to check".
 *
 * Every figure is one the website already computes, asked of the same functions
 * (`allocationSummary`, `studentRows`), so the app says what the page beside it
 * says. What this file adds is the mapping into the contract's shapes, and what
 * it leaves out: what the student paid for their time, and everything a mentor
 * wrote about a session. The ledger is read for the rows and goes nowhere else,
 * so no session is in this answer.
 */

/**
 * The home of `user`, or null when they have no student record.
 *
 * `now` is the instant each grant's days left, and each row of "Things to
 * check", are reckoned from. `allocationSummary` reads the clock itself to say
 * which grants have run out.
 */
export async function studentHomeFor(user: User, now: Date = new Date()): Promise<StudentHome | null | "onboarding"> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    include: { enrollments: true },
  });
  if (!profile) return null;
  // /student sends a student with no name or Telegram yet to onboarding, and so does this.
  if (!user.name?.trim() || !profile.telegramUsername) return "onboarding";

  const [hours, ledger, pairings, unread, reader, interviews] = await Promise.all([
    // Every program the student is in, as /student reads it: their balance is
    // one figure however many programs hold it.
    allocationSummary(profile.id),
    studentLedger(profile.id),
    // The pairings this student may book through, the Book page's own question.
    prisma.mentorAssignment.findMany({
      where: assignmentsForStudentWhere(profile),
      select: { mentorId: true, programId: true, calendlyUrl: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.notification.count({ where: { userId: user.id, read: false } }),
    readerFor(user),
    interviewsForLog(user.id, now),
  ]);
  const viewer: ViewerContext = { audience: "student", userId: user.id, now };
  const bookingUrlOf = bookingLinks(pairings);

  // In freshform's order (`attentionList`): what asks something of the student
  // before what only tells them, the worst first.
  // Thinned as the page thins it (`withoutRepeats`): an overdue task is in a list of its own, the use-by row goes once
  // the balance says the date, and every mentor with no booking link is one row.
  const todo = await toTodoRows(withoutRepeats(await studentRows(user, profile, hours, ledger, now), { useByShown: hours.expiring != null }));
  const work = workOf(reader, { id: profile.id, userId: user.id, user: { name: user.name, email: user.email } }, ledger, now);
  // The page's agenda order: in progress, then not started, then finished, which it folds.
  const agenda = agendaLists(work.plan.map((item) => ({ task: item })));
  // The page's Meetings: sessions and practice interviews as one history, the latest three, and its count.
  const log = meetingLog(ledger.sessions, interviews).slice(0, HOME_MEETINGS);
  const sessionRows = await prisma.session.findMany({
    where: { id: { in: log.flatMap((item) => (item.kind === "session" ? [item.session.id] : [])) } },
    include: SESSION_INCLUDE,
  });
  const sessionById = new Map(sessionRows.map((row) => [row.id, row]));
  const mentors = new Set([...ledger.tasks.map((t) => t.mentorId), ...ledger.assignments.map((a) => a.mentorId)]);

  return {
    hours: {
      allotted: hours.allotted,
      completed: hours.completed,
      missed: hours.missed,
      used: hours.used,
      remaining: hours.remaining,
      forfeited: hours.forfeited,
      extra: hours.extra,
    },
    expiring: hours.expiring
      ? {
          minutes: hours.expiring.minutes,
          day: toDateInputValue(hours.expiring.date),
          // The page's DeadlineText for it: soon within the student's window, said as today, tomorrow or in N days.
          daysLeft: daysAway(hours.expiring.date, now),
          soon: hours.expiring.date.getTime() >= now.getTime() && daysAway(hours.expiring.date, now) <= EXPIRY_WINDOW_DAYS.student,
        }
      : null,
    grants: hours.perMentor.map((grant) => toGrant(grant, bookingUrlOf, now)),
    todo,
    // Counted from the sessions, not summed from the rows: a row's `count` is null
    // for a session on its own, and set only on the one row that four or more
    // sessions are rolled into.
    toConfirm: ledger.sessions.filter((session) => isAwaitingAnswer(session, viewer)).length,
    // The student's own work, from the ledger already read: no plan item carries
    // its note, since the reader is the student it is about.
    tasks: work.tasks,
    plan: [...agenda.live, ...agenda.finished].map((entry) => entry.task),
    firstRun: isFirstRun({ used: hours.used, held: ledger.sessions.length, myTasks: ledger.tasks.length, tasks: ledger.assignments.length }),
    // The page's task rows name the program only to a student in several, and the mentor only when several are involved.
    columns: { program: profile.enrollments.length > 1, mentor: mentors.size > 1 },
    meetings: {
      count: meetingCount(ledger.sessions) + interviews.filter((i) => i.phase === "completed").length,
      latest: log.flatMap((item): HomeMeeting[] => {
        if (item.kind === "interview") {
          const i = item.interview;
          return [
            {
              kind: "interview" as const,
              id: i.id,
              template: templateName(i.template),
              when: slotTime({ startsAt: i.startsAt, minutes: i.minutes }),
              partner: { id: i.partner.id, name: i.partner.name ?? "A classmate" },
              phase: i.phase,
            },
          ];
        }
        const row = sessionById.get(item.session.id);
        return row ? [{ kind: "session" as const, session: toApiSession(reader, row, now) }] : [];
      }),
    },
    unread,
    today: programToday(now),
  };
}

/** The page's Meetings shows the latest three. */
const HOME_MEETINGS = 3;

/** One mentor in one program. The program is part of it: the same mentor may hold separate time, and a separate link, in two. */
const pairKey = (programId: string, mentorId: string) => `${programId}:${mentorId}`;

/** Where a mentor can be booked for time held in a program, if anywhere. */
type BookingUrlOf = (programId: string, mentorId: string) => string | null;

/**
 * Where each mentor can be booked, found as the Book page finds it: by the link
 * of the pairing in the program the time is in or, when that has none, by the
 * mentor's link from another of the student's pairings. It is the same person's
 * calendar either way.
 *
 * A mentor can be paired twice in a program, once for all of it and once for the
 * student's cohort, so a pair's link is whichever of the two carries one. Both
 * lookups take the first made (`pairings` arrive oldest first).
 */
function bookingLinks(
  pairings: readonly { mentorId: string; programId: string; calendlyUrl: string | null }[]
): BookingUrlOf {
  const ofPair = new Map<string, string>();
  const ofMentor = new Map<string, string>();
  for (const pairing of pairings) {
    if (!pairing.calendlyUrl) continue;
    const pair = pairKey(pairing.programId, pairing.mentorId);
    if (!ofPair.has(pair)) ofPair.set(pair, pairing.calendlyUrl);
    if (!ofMentor.has(pairing.mentorId)) ofMentor.set(pairing.mentorId, pairing.calendlyUrl);
  }
  return (programId, mentorId) => ofPair.get(pairKey(programId, mentorId)) ?? ofMentor.get(mentorId) ?? null;
}

/**
 * One row of the student's hours, in the contract's words.
 *
 * Copied field by field: the grant carries what was paid for it (`amountPaid`)
 * and the mentor is their whole account, and neither belongs on a phone.
 */
function toGrant(
  grant: AllocationSummary["perMentor"][number],
  bookingUrlOf: BookingUrlOf,
  now: Date
): StudentGrant {
  const { mentor, program, deadline } = grant;
  return {
    // Time with no mentor behind it has none to name: an hour bank, or time
    // nobody has been chosen for yet, which `bank` tells apart.
    mentor: mentor ? { id: mentor.id, name: nameOf(mentor) } : null,
    bank: grant.bank,
    program: { id: program.id, name: program.name, colorIndex: program.colorIndex },
    allocated: grant.allocated,
    remaining: grant.remaining,
    forfeited: grant.forfeited,
    expired: grant.expired,
    useBy: deadline ? toDateInputValue(deadline) : null,
    daysLeft: deadline ? daysAway(deadline, now) : null,
    bookingUrl: mentor ? bookingUrlOf(program.id, mentor.id) : null,
  };
}

/**
 * Whether the website is asking the student about this session: its own
 * question, window and all (`sessionStatuses`), the one that makes a session a
 * row of "Things to check".
 */
const isAwaitingAnswer = (session: LedgerSession, viewer: ViewerContext) =>
  sessionStatuses(session, viewer).some((row) => row.type === "SESSION_UNCONFIRMED");
