import { describe, expect, it } from "vitest";

import {
  ASSIGNMENT_PROGRESS,
  INTERVIEW_STATUS,
  SESSION_STATUS,
  USER_STATUS,
} from "@/lib/constants";
import {
  actionableCount,
  attentionList,
  EXPIRY_WINDOW_DAYS,
  GLYPH,
  meetingStatus,
  mentorStatuses,
  programStatuses,
  rollUp,
  sessionStatuses,
  severityOf,
  sortStatuses,
  STATUS_TYPES,
  status,
  studentStatuses,
  taskStatuses,
  type Audience,
  type Status,
  type StudentStatusInput,
  type ViewerContext,
} from "@/lib/status";

const NOW = new Date("2026-09-03T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);

const view = (audience: Audience): ViewerContext => ({
  audience,
  userId: "viewer-1",
  now: NOW,
});
const AUDIENCES: Audience[] = ["staff", "mentor", "student"];

const student = (over: Partial<StudentStatusInput> = {}): StudentStatusInput => ({
  id: "sp-1",
  name: "Aziza Yusupova",
  email: "aziza@example.com",
  accountStatus: USER_STATUS.ACTIVE,
  telegramUsername: "aziza",
  allottedMinutes: 600,
  remainingMinutes: 510,
  forfeitedMinutes: 0,
  mentorCount: 1,
  ...over,
});

const types = (list: Status[]) => list.map((s) => s.type);
const find = (list: Status[], type: string) => list.find((s) => s.type === type);

/**
 * Words in a label, counting a formatted figure as one.
 *
 * "2h 30m" and "September 30" are each a single VALUE that happens to contain a
 * space, so counting them as two would make the ≤ 4-word rule impossible to
 * satisfy for any label that carries a number — which is most of the useful
 * ones. The rule exists to forbid sentences, not dates.
 */
function wordCount(text: string): number {
  return text
    .replace(/-?\d+h(\s\d+m)?/g, "FIG")
    .replace(/\d+\smin/g, "FIG")
    .replace(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s\d+/g,
      "FIG"
    )
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

describe("the status table", () => {
  it("gives every type a severity and at least one reader", () => {
    expect(STATUS_TYPES.length).toBeGreaterThan(30);
    for (const type of STATUS_TYPES) {
      expect(GLYPH[severityOf(type)]).toBeTruthy();
      const readers = AUDIENCES.filter((a) => status(type, view(a), fullDetail) !== null);
      expect(readers, `${type} is visible to nobody`).not.toHaveLength(0);
    }
  });

  // Every interpolation any label might reach for, so a label is never built
  // from a missing figure in this check.
  const fullDetail = {
    minutes: 150,
    date: inDays(27),
    name: "Aziza Yusupova",
    closedAs: "held" as const,
  };

  it("keeps every label to four words and every explanation to twelve", () => {
    const tooLong: string[] = [];
    for (const type of STATUS_TYPES) {
      for (const audience of AUDIENCES) {
        const s = status(type, view(audience), fullDetail);
        if (!s) continue;
        if (wordCount(s.label) > 4) {
          tooLong.push(`${type}/${audience} label (${wordCount(s.label)}w): "${s.label}"`);
        }
        if (s.explanation && wordCount(s.explanation) > 12) {
          tooLong.push(
            `${type}/${audience} explanation (${wordCount(s.explanation)}w): "${s.explanation}"`
          );
        }
      }
    }
    expect(tooLong).toEqual([]);
  });

  it("never produces an empty label", () => {
    for (const type of STATUS_TYPES) {
      for (const audience of AUDIENCES) {
        const s = status(type, view(audience), fullDetail);
        if (s) expect(s.label.trim(), type).not.toBe("");
      }
    }
  });

  it("only lets a blocked state exist where an action is genuinely refused", () => {
    // A `blocked` status is the one kind allowed to become a Callout, so the set
    // is deliberately small. If this list grows, the one-Callout-per-page rule
    // is about to be broken somewhere.
    const blocked = new Set<string>();
    for (const type of STATUS_TYPES) {
      for (const audience of AUDIENCES) {
        const s = status(type, view(audience), fullDetail);
        if (s?.kind === "blocked") blocked.add(`${type}/${audience}`);
      }
    }
    expect([...blocked].sort()).toEqual([
      "ALLOCATION_EXPIRED/mentor",
      "BALANCE_NONE/mentor",
      "MENTOR_UNASSIGNED/mentor",
      "STAFF_UNSCOPED/staff",
      "STUDENT_PENDING_APPROVAL/mentor",
      "STUDENT_PENDING_APPROVAL/student",
    ]);
  });
});

describe("per-audience wording", () => {
  it("tells a student about themself in the second person", () => {
    const meeting = {
      id: "i-1",
      status: INTERVIEW_STATUS.DECLINED,
      scheduledAt: inDays(4),
      sessionId: null,
      student: { id: "sp-1", name: "Aziza Yusupova" },
    };
    // The bug this replaces: INTERVIEW_STATUS_META was viewer-agnostic, so a
    // student who declined read a red chip "Student can't make it" about herself.
    expect(meetingStatus(meeting, view("student"))?.label).toBe("You can't make it");
    expect(meetingStatus(meeting, view("mentor"))?.label).toBe("Aziza can't make it");
    expect(meetingStatus(meeting, view("staff"))?.label).toBe("Aziza can't make it");
  });

  it("asks the student for an answer and tells the mentor to wait", () => {
    const meeting = {
      id: "i-2",
      status: INTERVIEW_STATUS.PROPOSED,
      scheduledAt: inDays(5),
      sessionId: null,
      student: { id: "sp-1", name: "Aziza Yusupova" },
    };
    const forStudent = meetingStatus(meeting, view("student"));
    expect(forStudent?.label).toBe("Needs your answer");
    expect(forStudent?.kind).toBe("actionable");

    const forMentor = meetingStatus(meeting, view("mentor"));
    expect(forMentor?.label).toBe("Awaiting Aziza's answer");
    expect(forMentor?.kind).toBe("informational");
  });

  it("does not invent a possessive when it has no name to own it", () => {
    // On one student's own page the subject is the page, so the detail carries
    // no name — "Awaiting the student's answer" reads worse than not naming.
    expect(status("MEETING_AWAITING_ANSWER", view("staff"), {})?.label).toBe(
      "Awaiting an answer"
    );
    expect(status("MEETING_DECLINED", view("mentor"), {})?.label).toBe("Declined");
    expect(
      status("MEETING_AWAITING_ANSWER", view("staff"), { name: "Aziza Yusupova" })?.label
    ).toBe("Awaiting Aziza's answer");
  });

    it("hides staff-only states from the people they are not about", () => {
    expect(status("FEEDBACK_LOW", view("mentor"))).toBeNull();
    expect(status("STUDENT_PLACEHOLDER_EMAIL", view("student"))).toBeNull();
    expect(status("STAFF_UNSCOPED", view("student"))).toBeNull();
  });

  it("tells a student their passed meeting is waiting on their mentor", () => {
    // This was student-invisible, and the student page could then only solve
    // an overdue meeting by not showing it — so a meeting that happened
    // yesterday disappeared without a word, which the page it replaced did
    // not do. Invisible is a fine answer for a state a reader has no business
    // knowing; it is the wrong answer for one about their own week.
    const row = status("MEETING_UNLOGGED", view("student"));
    expect(row?.label).toBe("Waiting on your mentor");
    expect(row?.kind).toBe("informational");
  });
});

describe("studentStatuses", () => {
  it("says nothing about a student in good standing", () => {
    expect(types(studentStatuses(student(), view("staff")))).toEqual([]);
  });

  it("reports an overdraw as a problem, to everyone, unsoftened", () => {
    const list = studentStatuses(
      student({ remainingMinutes: -130 }),
      view("student")
    );
    const overdrawn = find(list, "BALANCE_OVERDRAWN");
    expect(overdrawn?.severity).toBe("problem");
    expect(overdrawn?.label).toBe("Over by 2h 10m");
  });

  it("blocks a mentor who holds no allocation, and explains why", () => {
    const list = studentStatuses(
      student({ allottedMinutes: 0, remainingMinutes: 0, mentorCount: 0 }),
      view("mentor")
    );
    const none = find(list, "BALANCE_NONE");
    expect(none?.kind).toBe("blocked");
    expect(none?.label).toBe("No time with you");
  });

  it("blocks a mentor from logging against a student awaiting approval", () => {
    // Deliberately against the written spec, which had this invisible to a
    // mentor while also calling it their reason for not being able to log.
    const list = studentStatuses(
      student({ accountStatus: USER_STATUS.PENDING }),
      view("mentor")
    );
    expect(find(list, "STUDENT_PENDING_APPROVAL")?.kind).toBe("blocked");
  });

  it("reads a missing Telegram handle as never having signed in", () => {
    const list = studentStatuses(student({ telegramUsername: null }), view("staff"));
    expect(types(list)).toContain("STUDENT_NOT_SIGNED_IN");
  });

  it("prefers 'pending approval' over 'never signed in'", () => {
    const list = studentStatuses(
      student({ accountStatus: USER_STATUS.PENDING, telegramUsername: null }),
      view("staff")
    );
    expect(types(list)).toContain("STUDENT_PENDING_APPROVAL");
    expect(types(list)).not.toContain("STUDENT_NOT_SIGNED_IN");
  });

  it("warns each reader about an expiry on their own horizon", () => {
    const soon = student({ nextDeadline: inDays(20), remainingMinutes: 278 });
    // 20 days out: inside a student's month, outside a fortnight and a week.
    expect(types(studentStatuses(soon, view("student")))).toContain("ALLOCATION_EXPIRING");
    expect(types(studentStatuses(soon, view("staff")))).not.toContain("ALLOCATION_EXPIRING");
    expect(types(studentStatuses(soon, view("mentor")))).not.toContain("ALLOCATION_EXPIRING");

    const sooner = student({ nextDeadline: inDays(5), remainingMinutes: 278 });
    for (const a of AUDIENCES) {
      expect(types(studentStatuses(sooner, view(a))), a).toContain("ALLOCATION_EXPIRING");
    }
  });

  it("does not warn about time expiring when there is none left to lose", () => {
    const overdrawn = student({ remainingMinutes: -60, nextDeadline: inDays(3) });
    expect(types(studentStatuses(overdrawn, view("staff")))).not.toContain(
      "ALLOCATION_EXPIRING"
    );
  });

  it("does not warn about a deadline that has already gone", () => {
    const past = student({ nextDeadline: inDays(-2), remainingMinutes: 100 });
    expect(types(studentStatuses(past, view("staff")))).not.toContain("ALLOCATION_EXPIRING");
  });

  it("names forfeited time as a problem and blocks the mentor", () => {
    const list = studentStatuses(student({ forfeitedMinutes: 180 }), view("mentor"));
    const expired = find(list, "ALLOCATION_EXPIRED");
    expect(expired?.severity).toBe("problem");
    expect(expired?.kind).toBe("blocked");
    expect(expired?.label).toBe("3h expired unused");
  });

  it("carries a subject and a destination on every row", () => {
    const list = studentStatuses(student({ remainingMinutes: -60 }), view("staff"));
    expect(list[0].subject).toEqual({
      kind: "student",
      id: "sp-1",
      name: "Aziza Yusupova",
    });
    expect(list[0].href).toBe("/students/sp-1");
  });

  it("is a pure function of the clock it is handed", () => {
    const s = student({ nextDeadline: inDays(10), remainingMinutes: 100 });
    const later: ViewerContext = { ...view("staff"), now: inDays(30) };
    expect(types(studentStatuses(s, view("staff")))).toContain("ALLOCATION_EXPIRING");
    // Same input, a clock a month on: the deadline is now in the past.
    expect(types(studentStatuses(s, later))).not.toContain("ALLOCATION_EXPIRING");
  });
});

describe("mentorStatuses", () => {
  const mentor = (over = {}) => ({
    id: "m-1",
    name: "Valera Arakelyan",
    email: "valera@freshman.academy",
    accountStatus: USER_STATUS.ACTIVE,
    programCount: 1,
    pairingsMissingLink: 0,
    ...over,
  });

  it("says nothing about a set-up mentor", () => {
    expect(types(mentorStatuses(mentor(), view("staff")))).toEqual([]);
  });

  it("blocks an unassigned mentor and asks an admin to act", () => {
    const m = mentor({ programCount: 0, accountStatus: USER_STATUS.UNASSIGNED });
    expect(mentorStatuses(m, view("mentor"))[0]).toMatchObject({
      type: "MENTOR_UNASSIGNED",
      kind: "blocked",
      label: "Waiting for a program",
    });
    expect(mentorStatuses(m, view("staff"))[0]).toMatchObject({
      kind: "actionable",
      label: "Not in any program",
    });
  });

  it("does not nag about a booking link before there is a program to book in", () => {
    const m = mentor({ programCount: 0, pairingsMissingLink: 2 });
    expect(types(mentorStatuses(m, view("mentor")))).not.toContain("BOOKING_LINK_MISSING");
  });

  it("asks the mentor for a booking link and only tells staff", () => {
    const m = mentor({ pairingsMissingLink: 2 });
    expect(find(mentorStatuses(m, view("mentor")), "BOOKING_LINK_MISSING")?.kind).toBe(
      "actionable"
    );
    expect(find(mentorStatuses(m, view("staff")), "BOOKING_LINK_MISSING")?.kind).toBe(
      "informational"
    );
  });

  it("waits for a pattern before calling a rating low", () => {
    const twoBad = mentor({ averageRating: 2, ratingCount: 2 });
    expect(types(mentorStatuses(twoBad, view("staff")))).not.toContain("FEEDBACK_LOW");

    const several = mentor({ averageRating: 2.8, ratingCount: 6 });
    expect(types(mentorStatuses(several, view("staff")))).toContain("FEEDBACK_LOW");
  });

  it("keeps a low rating away from the mentor it is about", () => {
    const m = mentor({ averageRating: 2, ratingCount: 9 });
    expect(types(mentorStatuses(m, view("mentor")))).not.toContain("FEEDBACK_LOW");
  });
});

describe("taskStatuses", () => {
  const task = (over = {}) => ({
    id: "t-1",
    purpose: "Personal statement review",
    progress: ASSIGNMENT_PROGRESS.IN_PROGRESS,
    mentorId: "m-1",
    minuteLimit: 120,
    loggedMinutes: 60,
    ...over,
  });

  it("always says where the work stands", () => {
    expect(types(taskStatuses(task(), view("staff")))).toContain("TASK_IN_PROGRESS");
    expect(
      types(taskStatuses(task({ progress: ASSIGNMENT_PROGRESS.DONE }), view("staff")))
    ).toContain("TASK_DONE");
    expect(severityOf("TASK_DONE")).toBe("ok");
  });

  it("stays silent about an overdue task until there is a real date to judge", () => {
    // The deadline column is free text ("March-May"), so this is dormant on
    // purpose rather than guessing.
    expect(types(taskStatuses(task(), view("mentor")))).not.toContain("TASK_OVERDUE");
    expect(
      types(taskStatuses(task({ dueOn: inDays(-5) }), view("mentor")))
    ).toContain("TASK_OVERDUE");
  });

  it("does not call a finished task overdue", () => {
    const done = task({ progress: ASSIGNMENT_PROGRESS.DONE, dueOn: inDays(-5) });
    expect(types(taskStatuses(done, view("mentor")))).not.toContain("TASK_OVERDUE");
  });

  it("reports work past its budget as a problem", () => {
    const over = task({ minuteLimit: 120, loggedMinutes: 200 });
    expect(find(taskStatuses(over, view("staff")), "TASK_OVER_BUDGET")).toMatchObject({
      severity: "problem",
      label: "1h 20m over budget",
    });
  });

  it("says a task needs a mentor, in each reader's words", () => {
    const orphan = task({ mentorId: null });
    expect(find(taskStatuses(orphan, view("staff")), "TASK_NEEDS_MENTOR")?.label).toBe(
      "Needs a mentor"
    );
    expect(find(taskStatuses(orphan, view("student")), "TASK_NEEDS_MENTOR")?.label).toBe(
      "Mentor to be confirmed"
    );
  });
});

describe("sessionStatuses", () => {
  const session = (over = {}) => ({
    attended: true,
    late: false,
    status: SESSION_STATUS.ACTIVE,
    withinPlan: true,
    ...over,
  });

  it("says nothing about an ordinary session", () => {
    // Which is what removes the green "Logged" chip from every row.
    expect(sessionStatuses(session(), view("staff"))).toEqual([]);
  });

  it("names each exception once", () => {
    expect(types(sessionStatuses(session({ attended: false }), view("staff")))).toEqual([
      "SESSION_NO_SHOW",
    ]);
    expect(types(sessionStatuses(session({ late: true }), view("staff")))).toEqual([
      "SESSION_LATE",
    ]);
    expect(types(sessionStatuses(session({ withinPlan: false }), view("staff")))).toEqual([
      "SESSION_EXTRA",
    ]);
    expect(
      types(sessionStatuses(session({ status: SESSION_STATUS.VOIDED }), view("staff")))
    ).toEqual(["SESSION_VOIDED"]);
  });

  it("does not call a voided session a no-show as well", () => {
    const voided = session({ status: SESSION_STATUS.VOIDED, attended: false });
    expect(types(sessionStatuses(voided, view("staff")))).toEqual(["SESSION_VOIDED"]);
  });

  it("softens 'no-show' for the student it describes, without hiding the charge", () => {
    const noShow = session({ attended: false });
    expect(sessionStatuses(noShow, view("student"))[0].label).toBe("Missed, time charged");
    expect(sessionStatuses(noShow, view("mentor"))[0].label).toBe("No-show, time charged");
  });

  it("asks a recent, unanswered, charging session to be confirmed", () => {
    const recent = session({ date: inDays(-3) });
    expect(types(sessionStatuses(recent, view("student")))).toEqual([
      "SESSION_UNCONFIRMED",
    ]);
    // The one voice that can act on it says so; the other two are told.
    expect(sessionStatuses(recent, view("student"))[0].kind).toBe("actionable");
    expect(sessionStatuses(recent, view("mentor"))[0].kind).toBe("informational");
    expect(sessionStatuses(recent, view("staff"))[0].kind).toBe("informational");
  });

  it("stops asking once the row is a month old", () => {
    // An unanswered session from March is not a job anybody is going to do,
    // and a chip on every old row is a chip that stops meaning anything.
    expect(
      types(sessionStatuses(session({ date: inDays(-31) }), view("student")))
    ).toEqual([]);
  });

  it("never asks about time that charged nothing", () => {
    // Out of plan moved no balance, so there is nothing to agree with; a
    // voided one has already been taken back.
    expect(
      types(sessionStatuses(session({ date: inDays(-1), withinPlan: false }), view("student")))
    ).toEqual(["SESSION_EXTRA"]);
    expect(
      types(
        sessionStatuses(
          session({ date: inDays(-1), status: SESSION_STATUS.VOIDED }),
          view("student")
        )
      )
    ).toEqual(["SESSION_VOIDED"]);
  });

  it("carries the answer once it is given, and only that answer", () => {
    const confirmed = session({ date: inDays(-3), studentAnswer: "CONFIRMED" });
    expect(types(sessionStatuses(confirmed, view("staff")))).toEqual([
      "SESSION_CONFIRMED",
    ]);
    const disputed = session({ date: inDays(-3), studentAnswer: "DISPUTED" });
    expect(types(sessionStatuses(disputed, view("staff")))).toEqual([
      "SESSION_DISPUTED",
    ]);
    // A dispute is the staff member's job, not the mentor's: only an admin can
    // correct or void the row.
    expect(sessionStatuses(disputed, view("staff"))[0].kind).toBe("actionable");
    expect(sessionStatuses(disputed, view("mentor"))[0].kind).toBe("informational");
  });

  it("answers an old session's answer even past the window", () => {
    // The window governs the ASK, not the record: a confirmation given in March
    // is still a fact about that row in September.
    const old = session({ date: inDays(-200), studentAnswer: "CONFIRMED" });
    expect(types(sessionStatuses(old, view("staff")))).toEqual(["SESSION_CONFIRMED"]);
  });
});

describe("meetingStatus", () => {
  const meeting = (over = {}) => ({
    id: "i-1",
    status: INTERVIEW_STATUS.CONFIRMED,
    scheduledAt: inDays(3),
    sessionId: null,
    student: { id: "sp-1", name: "Aziza Yusupova" },
    ...over,
  });

  it("treats a meeting later today as still ahead", () => {
    // A whole-day meeting carries no time to compare against, and one at 09:00
    // must not read as overdue over lunch.
    const today = meeting({ scheduledAt: new Date("2026-09-03T09:00:00.000Z") });
    expect(meetingStatus(today, view("mentor"))?.type).toBe("MEETING_CONFIRMED");
  });

  it("calls yesterday's unlogged meeting overdue, ahead of any answer", () => {
    const stale = meeting({ status: INTERVIEW_STATUS.PROPOSED, scheduledAt: inDays(-1) });
    // Once the day is gone, whether they had confirmed stopped being the question.
    expect(meetingStatus(stale, view("mentor"))).toMatchObject({
      type: "MEETING_UNLOGGED",
      kind: "actionable",
    });
  });

  it("stops chasing a past meeting once its session is logged", () => {
    const logged = meeting({ scheduledAt: inDays(-1), sessionId: "s-1" });
    expect(meetingStatus(logged, view("mentor"))?.type).toBe("MEETING_CONFIRMED");
  });

  it("distinguishes held from cancelled", () => {
    expect(
      meetingStatus(meeting({ status: INTERVIEW_STATUS.HELD }), view("staff"))?.label
    ).toBe("Held");
    expect(
      meetingStatus(
        meeting({ status: INTERVIEW_STATUS.CANCELLED, scheduledAt: inDays(-9) }),
        view("staff")
      )?.label
    ).toBe("Cancelled");
  });

  it("gives a meeting exactly one status", () => {
    const s = meetingStatus(meeting({ status: INTERVIEW_STATUS.PROPOSED }), view("student"));
    expect(s).not.toBeNull();
    expect(s?.at).toEqual(inDays(3));
  });
});

describe("programStatuses", () => {
  it("does not call an empty new program broken", () => {
    const fresh = { id: "p-1", name: "Flexible Program", mentorCount: 0, studentCount: 0 };
    expect(types(programStatuses(fresh, view("staff")))).toEqual([]);
  });

  it("flags a program with students and nobody to teach them", () => {
    const stranded = { id: "p-1", name: "Flexible Program", mentorCount: 0, studentCount: 4 };
    expect(types(programStatuses(stranded, view("staff")))).toEqual(["PROGRAM_NO_MENTORS"]);
  });
});

describe("sortStatuses", () => {
  it("puts problems first and ok last", () => {
    const list = [
      status("MEETING_CONFIRMED", view("staff"))!,
      status("STUDENT_NOT_SIGNED_IN", view("staff"))!,
      status("BALANCE_OVERDRAWN", view("staff"), { minutes: 60 })!,
      status("BALANCE_NONE", view("staff"))!,
    ];
    expect(sortStatuses(list).map((s) => s.severity)).toEqual([
      "problem",
      "attention",
      "neutral",
      "ok",
    ]);
  });

  it("puts the soonest first inside a band", () => {
    const late = status("TASK_OVERDUE", view("staff"), { date: inDays(-1) }, { at: inDays(-1) })!;
    const later = status("TASK_OVERDUE", view("staff"), { date: inDays(-9) }, { at: inDays(-9) })!;
    expect(sortStatuses([late, later]).map((s) => s.at)).toEqual([inDays(-9), inDays(-1)]);
  });
});

describe("rollUp", () => {
  const noneFor = (id: string) =>
    studentStatuses(
      student({ id, allottedMinutes: 0, remainingMinutes: 0, mentorCount: 0 }),
      view("staff")
    ).filter((s) => s.type === "BALANCE_NONE");

  it("leaves three named students expanded", () => {
    const three = ["a", "b", "c"].flatMap(noneFor);
    expect(rollUp(three, view("staff"))).toHaveLength(3);
    expect(rollUp(three, view("staff"))[0].count).toBeUndefined();
  });

  it("collapses the imported cohort into one honest line", () => {
    // Ten students with sessions and no allocation is the real state of the
    // Master's import. Printed in full it buries everything unusual.
    const ten = "abcdefghij".split("").flatMap(noneFor);
    const rolled = rollUp(ten, view("staff"));
    expect(rolled).toHaveLength(1);
    expect(rolled[0]).toMatchObject({
      type: "BALANCE_NONE",
      count: 10,
      label: "10 students have no time allocated",
      severity: "attention",
    });
    // The row is about a count, so it names no one student.
    expect(rolled[0].subject).toBeUndefined();
  });

  it("collapses each type separately and keeps the order", () => {
    const mixed = [
      ..."abcdefghij".split("").flatMap(noneFor),
      ...["x", "y", "z", "w"].flatMap((id) =>
        studentStatuses(student({ id, remainingMinutes: -60 }), view("staff")).filter(
          (s) => s.type === "BALANCE_OVERDRAWN"
        )
      ),
    ];
    const rolled = rollUp(mixed, view("staff"));
    expect(rolled.map((s) => [s.type, s.count])).toEqual([
      ["BALANCE_OVERDRAWN", 4],
      ["BALANCE_NONE", 10],
    ]);
  });

  it("respects a caller's threshold", () => {
    const four = ["a", "b", "c", "d"].flatMap(noneFor);
    expect(rollUp(four, view("staff"), { threshold: 10 })).toHaveLength(4);
  });
});

describe("attentionList", () => {
  it("returns nothing when nothing needs anyone", () => {
    // The section still says so — `AttentionList` renders its own `empty`
    // text — but the list itself does not invent a row. It used to, and every
    // page had to filter that row back out.
    expect(attentionList([], view("mentor"))).toEqual([]);
  });

  it("drops states that are merely facts", () => {
    const facts = studentStatuses(student({ telegramUsername: null }), view("staff"));
    expect(types(facts)).toEqual(["STUDENT_NOT_SIGNED_IN"]);
        // A fact is worth a chip on a row; it is not worth a line on a home page.
    // It survives as informational, below anything actionable, and counts for
    // nothing.
    const rows = attentionList(facts, view("staff"));
    expect(actionableCount(rows)).toBe(0);
  });

  it("keeps what needs doing, rolled up and sorted", () => {
    const many = [
      ..."abcdefghij".split("").flatMap((id) =>
        studentStatuses(
          student({ id, allottedMinutes: 0, remainingMinutes: 0, mentorCount: 0 }),
          view("staff")
        )
      ),
      ...studentStatuses(student({ id: "z", remainingMinutes: -300 }), view("staff")),
    ];
    const list = attentionList(many, view("staff"));
    expect(list[0].type).toBe("BALANCE_OVERDRAWN");
    expect(list[0].severity).toBe("problem");
    expect(find(list, "BALANCE_NONE")?.count).toBe(10);
  });

  it("honours a limit", () => {
    const many = "abcdefgh".split("").flatMap((id) =>
      studentStatuses(student({ id, remainingMinutes: -60, forfeitedMinutes: 30 }), view("staff"))
    );
    expect(attentionList(many, view("staff"), { limit: 1 })).toHaveLength(1);
  });
});

describe("EXPIRY_WINDOW_DAYS", () => {
  it("gives each reader the horizon their action needs", () => {
    // A student can book inside a month; a mentor schedules a week out; staff
    // want a fortnight to top someone up before the time is lost.
    expect(EXPIRY_WINDOW_DAYS.student).toBeGreaterThan(EXPIRY_WINDOW_DAYS.staff);
    expect(EXPIRY_WINDOW_DAYS.staff).toBeGreaterThan(EXPIRY_WINDOW_DAYS.mentor);
  });
});

describe("attentionList", () => {
  const v: ViewerContext = { audience: "mentor", userId: "m1", now: new Date("2026-03-01T09:00:00Z") };

    it("returns nothing when nothing needs the viewer", () => {
    expect(attentionList([], v)).toEqual([]);
  });

  it("keeps informational rows and puts them under the actionable ones", () => {
    // A mentor whose Monday holds one thing to do and one thing to wait for.
    const list = [
      status("MEETING_AWAITING_ANSWER", v, undefined, { at: new Date("2026-03-02T10:00:00Z") })!,
      status("MEETING_UNLOGGED", v, undefined, { at: new Date("2026-02-26T10:00:00Z") })!,
    ];
    const rows = attentionList(list, v);
    expect(rows.map((r) => r.type)).toEqual(["MEETING_UNLOGGED", "MEETING_AWAITING_ANSWER"]);
    expect(rows.some((r) => r.type === "ALL_CLEAR")).toBe(false);
  });

    it("counts nothing when every row is informational", () => {
    // The honest case: things on screen, none of them yours to do. Both rows
    // stay — a mentor waiting on an answer wants to see that — and the badge
    // reads zero.
    const list = [status("MEETING_AWAITING_ANSWER", v)!, status("MEETING_CONFIRMED", v)!];
    const rows = attentionList(list, v);
    expect(rows).toHaveLength(2);
    expect(actionableCount(rows)).toBe(0);
  });

  it("keeps a blocked row, which counts for nothing but is not nothing", () => {
    // A mentor with no program cannot act, but "Nothing needs you" above
    // "Waiting for a program" is a redundant line: the blocked row already
    // explains the whole state of the page.
        const rows = attentionList([status("MENTOR_UNASSIGNED", v)!], v);
    expect(rows.map((r) => r.type)).toEqual(["MENTOR_UNASSIGNED"]);
    expect(rows[0].kind).toBe("blocked");
    expect(actionableCount(rows)).toBe(0);
  });

  it("counts only actionable rows toward the section's badge", () => {
    const list = [
      status("MEETING_UNLOGGED", v)!,
      status("MEETING_AWAITING_ANSWER", v)!,
      status("STUDENT_PENDING_APPROVAL", v)!,
    ];
    expect(actionableCount(attentionList(list, v))).toBe(1);
  });

  it("rolls up actionable and informational rows apart", () => {
    // Four of each: the roll-up must not merge two different kinds into one row.
    const list = [
      ...Array.from({ length: 4 }, (_, i) => status("MEETING_UNLOGGED", v, undefined, {
        subject: { kind: "student" as const, id: `s${i}`, name: `Student ${i}` },
      })!),
      ...Array.from({ length: 4 }, (_, i) => status("MEETING_AWAITING_ANSWER", v, undefined, {
        subject: { kind: "student" as const, id: `t${i}`, name: `Other ${i}` },
      })!),
    ];
    const rows = attentionList(list, v);
    expect(rows).toHaveLength(2);
    expect(rows[0].count).toBe(4);
    expect(rows[1].count).toBe(4);
    expect(rows[0].kind).toBe("actionable");
    expect(rows[1].kind).toBe("informational");
  });

  it("caps the list without hiding a problem behind an informational row", () => {
    const list = [
      status("MEETING_AWAITING_ANSWER", v)!,
      status("MEETING_AWAITING_ANSWER", v)!,
      status("MEETING_UNLOGGED", v)!,
    ];
    const rows = attentionList(list, v, { limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("MEETING_UNLOGGED");
  });
});

describe("meetingStatus and the program's clock", () => {
  const meeting = {
    id: "i1",
    status: "CONFIRMED",
    scheduledAt: new Date("2026-09-04T10:00:00Z"), // 10:00 Tashkent, Sep 4
    sessionId: null,
  };

  it("does not call this morning's meeting unlogged at 02:00 Tashkent", () => {
    // 02:00 Tashkent on Sep 4 is 21:00 UTC on Sep 3 — a different UTC date, so
    // a raw comparison put the meeting a day ahead and, once UTC rolled over
    // and Tashkent had not, a day behind.
    const v: ViewerContext = {
      audience: "mentor",
      userId: "m1",
      now: new Date("2026-09-03T21:00:00Z"),
    };
    expect(meetingStatus(meeting, v)?.type).toBe("MEETING_CONFIRMED");
  });

  it("still calls yesterday's unlogged meeting unlogged", () => {
    const v: ViewerContext = {
      audience: "mentor",
      userId: "m1",
      now: new Date("2026-09-05T09:00:00Z"),
    };
    expect(meetingStatus(meeting, v)?.type).toBe("MEETING_UNLOGGED");
  });

  it("leaves a meeting from earlier today alone", () => {
    // Whether it needs logging is a question for the end of the day, not lunch.
    const v: ViewerContext = {
      audience: "mentor",
      userId: "m1",
      now: new Date("2026-09-04T14:00:00Z"),
    };
    expect(meetingStatus(meeting, v)?.type).toBe("MEETING_CONFIRMED");
  });
});

describe("rollUp", () => {
  const v: ViewerContext = { audience: "staff", userId: "a1", now: new Date("2026-03-01T09:00:00Z") };
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      status("BALANCE_NONE", v, undefined, {
        subject: { kind: "student" as const, id: `s${i}`, name: `Student ${i}` },
        href: `/students/s${i}`,
      })!
    );

  it("leaves three named students named", () => {
    // Three names are more useful than the sentence "3 students…".
    expect(rollUp(many(3), v)).toHaveLength(3);
    expect(rollUp(many(3), v)[0].subject?.name).toBe("Student 0");
  });

  it("collapses a wall into one counted row", () => {
    const rolled = rollUp(many(9), v);
    expect(rolled).toHaveLength(1);
    expect(rolled[0].count).toBe(9);
    expect(rolled[0].label).toContain("9");
  });

  it("drops the subject and links the list instead", () => {
    // A row reading "9 students have no time allocated" must not navigate to
    // one of the nine — an arbitrary choice dressed up as an answer — and must
    // not name one of them either. The filtered list is the destination that
    // holds exactly the nine.
    const rolled = rollUp(many(9), v);
    expect(rolled[0].subject).toBeUndefined();
    expect(rolled[0].href).toBe("/students?time=none");
  });

  it("has no link for a type whose group is not a filter", () => {
    // A link that lands on a nearly-right list is worse than none: the reader
    // cannot tell which rows are the ones they tapped.
    const meetings = Array.from(
      { length: 9 },
      (_, i) =>
        status("MEETING_AWAITING_ANSWER", v, undefined, {
          subject: { kind: "student" as const, id: `s${i}`, name: `Student ${i}` },
          href: `/students/s${i}`,
        })!
    );
    expect(rollUp(meetings, v)[0].href).toBeUndefined();
  });

  it("keeps the count honest when the group is exactly at the threshold", () => {
    expect(rollUp(many(4), v)).toHaveLength(1);
    expect(rollUp(many(4), v)[0].count).toBe(4);
  });
});

describe("roll-up wording is the reader's, not the staff's", () => {
  const linkless = (audience: Audience, n: number) => {
    const v: ViewerContext = { audience, userId: "u1", now: new Date("2026-03-01T09:00:00Z") };
    return rollUp(
      Array.from({ length: n }, (_, i) =>
        status("BOOKING_LINK_MISSING", v, undefined, {
          subject: { kind: "mentor" as const, id: `m${i}`, name: `Mentor ${i}` },
        })!
      ),
      v
    );
  };

  it("does not say 'pairings' to a student", () => {
    // A pairing is a row in a staff table. A student read "5 pairings have no
    // booking link" on their own home page, which is the per-audience wording
    // rule leaking at exactly the point it stops applying.
    const [row] = linkless("student", 5);
    expect(row.label).toBe("5 mentors have not shared a calendar");
    expect(row.label).not.toContain("pairing");
  });

  it("still says 'pairings' to staff, who manage them", () => {
    expect(linkless("staff", 5)[0].label).toBe("5 pairings have no booking link");
  });

  it("falls back to the shared wording for an audience with none of its own", () => {
    expect(linkless("mentor", 5)[0].label).toBe("5 pairings have no booking link");
  });
});
