import {
  ASSIGNMENT_PROGRESS,
  CONFIRM_WINDOW_DAYS,
  INTERVIEW_STATUS,
  PLACEHOLDER_EMAIL_DOMAIN,
  SESSION_ANSWER,
  SESSION_STATUS,
  USER_STATUS,
} from "@/lib/constants";
import { formatDate, formatDuration } from "@/lib/format";
import { programWallClock } from "@/lib/when";

/**
 * Every state the product can be in, in one file.
 *
 * Before this existed, a state was re-derived wherever it was needed: 19 free-text
 * `Chip` labels, `flagsFor()` on the program page, the `Deadline` component, three
 * copies of a progress-to-colour map, and `INTERVIEW_STATUS_META`'s labels that
 * told a student "Student can't make it" about themself. The same fact wore
 * different words and different colours depending on which page you were on, and
 * adding a page meant inventing the wording again.
 *
 * So: a state has ONE type, ONE severity, and its wording is a property of the
 * type and the reader — not of the page. A page asks what is true and renders
 * what it is told.
 *
 * THREE RULES that the rest of the design leans on:
 *
 * 1. `severity` is the only thing that picks a colour, and a glyph and a word
 *    always ride along (see `GLYPH`). Nothing is ever colour-only.
 * 2. `now` arrives on `ViewerContext` and is never read from the clock in here.
 *    Every "is it expired" question in the app used to call `Date.now()` during a
 *    render, which is impure and made the answer depend on when a component
 *    happened to paint.
 * 3. `audience` comes from role and lens — never from authority. What a person
 *    may DO is decided by `lib/authz.ts`; this file decides what they are TOLD.
 *    A dual-role admin reading in mentor lens keeps every one of their rights and
 *    simply gets a mentor's wording.
 */

export type Severity = "neutral" | "ok" | "attention" | "problem";

/**
 * What the reader can do about it.
 *
 * `blocked` is the scarce one: it means an action this person would otherwise
 * take is unavailable, and the status is the reason. Only a `blocked` state may
 * become a `Callout`, at most one per page — which is what stops the three
 * stacked callouts the student home used to open with.
 */
export type Kind = "actionable" | "informational" | "blocked";

/** Who is reading. Not who they are — a dual-role admin is `staff` or `mentor`. */
export type Audience = "staff" | "mentor" | "student";

export type StatusType =
  // A student's account
  | "STUDENT_PENDING_APPROVAL"
  | "STUDENT_NOT_SIGNED_IN"
  | "STUDENT_PLACEHOLDER_EMAIL"
  // Their balance
  | "BALANCE_OVERDRAWN"
  | "BALANCE_NONE"
  | "POOL_UNASSIGNED"
  | "NO_MENTOR"
  | "ALLOCATION_EXPIRING"
  | "ALLOCATION_EXPIRED"
  // A meeting in the diary
  | "MEETING_AWAITING_ANSWER"
  | "MEETING_CONFIRMED"
  | "MEETING_DECLINED"
  | "MEETING_UNLOGGED"
  | "MEETING_CLOSED"
  // A session already logged
  | "SESSION_NO_SHOW"
  | "SESSION_LATE"
  | "SESSION_EXTRA"
  | "SESSION_RESCHEDULED"
  | "SESSION_VOIDED"
  | "SESSION_UNCONFIRMED"
  | "SESSION_CONFIRMED"
  | "SESSION_DISPUTED"
  // A piece of planned work
  | "TASK_NOT_STARTED"
  | "TASK_IN_PROGRESS"
  | "TASK_DONE"
  | "TASK_OVERDUE"
  | "TASK_OVER_BUDGET"
  | "TASK_NEEDS_MENTOR"
  // A mentor's setup
  | "BOOKING_LINK_MISSING"
  | "MENTOR_UNASSIGNED"
  | "MENTOR_NAME_MISSING"
  | "FEEDBACK_LOW"
  // A program, and the reader themself
  | "PROGRAM_ARCHIVED"
  | "PROGRAM_NO_MENTORS"
  | "STAFF_UNSCOPED"
  | "DIGEST_OFF"
  | "ALL_CLEAR";

export type Status = {
  type: StatusType;
  severity: Severity;
  kind: Kind;
  /** ≤ 4 words, a formatted figure counting as one. Already in this audience's words. */
  label: string;
  /** ≤ 12 words, says what to do about it. */
  explanation?: string;
  href?: string;
  subject?: { kind: "student" | "mentor" | "program" | "task"; id: string; name: string };
  program?: { id: string; name: string };
  /** Orders rows inside a severity band: soonest or oldest first. */
  at?: Date;
  /** Set only by `rollUp`. */
  count?: number;
};

export type ViewerContext = {
  audience: Audience;
  userId: string;
  /** Computed once per request, at the query layer. */
  now: Date;
};

/** Sort order for an attention list. Problems first; "ok" last and quiet. */
export const SEVERITY_RANK: Record<Severity, number> = {
  problem: 0,
  attention: 1,
  neutral: 2,
  ok: 3,
};

/**
 * The glyph that rides with every severity, so a status is never colour alone —
 * which is both WCAG 1.4.1 and the only way the two remaining status hues stay
 * legible to a colour-blind reader.
 */
export const GLYPH: Record<Severity, string> = {
  neutral: "○",
  ok: "✓",
  attention: "!",
  problem: "×",
};

/**
 * How far ahead an expiry starts asking for attention, per reader.
 *
 * Different because the useful action is different: a student can book inside a
 * month, a mentor schedules a week out, and staff want a fortnight's warning to
 * top someone up before the time is lost.
 */
export const EXPIRY_WINDOW_DAYS = { staff: 14, mentor: 7, student: 30 } as const;

const DAY = 24 * 60 * 60 * 1000;
const daysUntil = (date: Date, now: Date) => (date.getTime() - now.getTime()) / DAY;
/** Whole days since something happened. Negative for a date in the future. */
const daysSince = (date: Date, now: Date) => (now.getTime() - date.getTime()) / DAY;

/**
 * Everything a label might need to interpolate.
 *
 * One loose bag rather than a per-type parameter map: every producer lives in
 * this file, so a missing figure is a local mistake caught by this file's tests,
 * and thirty type-level entries would buy compile-time safety inside a single
 * module that already has a test asserting each type renders.
 */
type Detail = {
  minutes?: number;
  date?: Date | null;
  name?: string | null;
  closedAs?: "held" | "cancelled";
};

const dur = (d: Detail) => formatDuration(Math.abs(d.minutes ?? 0));
const when = (d: Detail) => (d.date ? formatDate(d.date) : "soon");
const who = (d: Detail) => d.name?.split(" ")[0] ?? "the student";
/**
 * A possessive needs a name to own it. Where the subject is already the page —
 * one student's workspace — there is no name in the detail, and "Awaiting the
 * student's answer" reads worse than simply not naming them.
 */
const awaitingAnswerLabel = (d: Detail) =>
  d.name ? `Awaiting ${who(d)}'s answer` : "Awaiting an answer";

type Voice = {
  kind: Kind;
  label: (d: Detail) => string;
  explanation?: (d: Detail) => string;
  /**
   * This audience's wording when `rollUp` collapses several into one row.
   *
   * Needed because the shared `many` below is written in staff vocabulary, and
   * it leaked: a student with five link-less mentors read "5 pairings have no
   * booking link" on their own home page. A pairing is a row in a staff table.
   */
  many?: (count: number) => string;
};

type Meta = {
  severity: Severity;
  /**
   * Present only for the audiences that see this state at all. An absent
   * audience never gets the status — which is how a student is spared "Needs a
   * real email" and a mentor is spared "Low rating".
   */
    voices: Partial<Record<Audience, Voice>>;
  /** The default roll-up wording, overridden per audience by `Voice.many`. */
  many?: (count: number) => string;
};

/**
 * The table. Severity and wording live here; which states are TRUE is decided by
 * the producers below.
 *
 * Two entries deliberately contradict the written spec, both for the same
 * reason. `STUDENT_PENDING_APPROVAL` and `BALANCE_NONE` were specified as
 * invisible to a mentor while also being the mentor's reason they cannot log a
 * session — but a status nobody can see cannot explain a disabled button, and
 * `logSession` genuinely refuses both cases (a non-ACTIVE student, and a mentor
 * with no allocation). A mentor gets told, as `blocked`.
 */
const META: Record<StatusType, Meta> = {
  STUDENT_PENDING_APPROVAL: {
    severity: "attention",
    voices: {
      staff: {
        kind: "actionable",
        label: () => "Pending approval",
        explanation: () => "They signed up themselves. Approve, then allocate time.",
      },
      mentor: {
        kind: "blocked",
        label: () => "Pending approval",
        explanation: () => "You cannot log time until an admin approves them.",
      },
      student: {
        kind: "blocked",
        label: () => "Awaiting approval",
        explanation: () => "An admin is reviewing your registration.",
      },
    },
    many: (n) => `${n} students awaiting approval`,
  },

  STUDENT_NOT_SIGNED_IN: {
    severity: "neutral",
    voices: {
      staff: { kind: "informational", label: () => "Hasn't signed in" },
      mentor: { kind: "informational", label: () => "Hasn't signed in" },
    },
    many: (n) => `${n} students have never signed in`,
  },

  STUDENT_PLACEHOLDER_EMAIL: {
    severity: "attention",
    voices: {
      staff: {
        kind: "actionable",
        label: () => "Needs a real email",
        explanation: () => "Imported without one, so they cannot sign in yet.",
      },
    },
    many: (n) => `${n} students cannot sign in yet`,
  },

  BALANCE_OVERDRAWN: {
    severity: "problem",
    voices: {
      staff: {
        kind: "actionable",
        label: (d) => `Over by ${dur(d)}`,
        explanation: () => "More time was logged than was ever granted.",
      },
      mentor: { kind: "informational", label: (d) => `Over by ${dur(d)}` },
      student: {
        kind: "informational",
        label: (d) => `Over by ${dur(d)}`,
        explanation: () => "Your program can grant more time.",
      },
    },
    many: (n) => `${n} students are overdrawn`,
  },

  BALANCE_NONE: {
    severity: "attention",
    voices: {
      staff: {
        kind: "actionable",
        label: () => "No time allocated",
        explanation: () => "Allocate time from a mentor on their page.",
      },
      mentor: {
        kind: "blocked",
        label: () => "No time with you",
        explanation: () => "An admin allocates it before you can log against it.",
      },
      student: {
        kind: "informational",
        label: () => "No time yet",
        explanation: () => "Your team is still arranging it.",
      },
    },
    many: (n) => `${n} students have no time allocated`,
  },

  POOL_UNASSIGNED: {
    severity: "neutral",
    voices: {
      staff: {
        kind: "informational",
        label: (d) => `${dur(d)} unassigned`,
        explanation: () => "Granted before a mentor was chosen.",
      },
      mentor: {
        kind: "informational",
        label: (d) => `${dur(d)} unassigned`,
        explanation: () => "Any mentor here may log against it; logging claims it.",
      },
      student: { kind: "informational", label: (d) => `${dur(d)} unassigned` },
    },
  },

  NO_MENTOR: {
    severity: "attention",
    voices: {
      staff: {
        kind: "actionable",
        label: () => "No mentor yet",
        explanation: () => "Allocate their time from a mentor to pair them.",
      },
      student: { kind: "informational", label: () => "No mentor yet" },
    },
    many: (n) => `${n} students have no mentor`,
  },

  ALLOCATION_EXPIRING: {
    severity: "attention",
    voices: {
      staff: {
        kind: "actionable",
        label: (d) => `${dur(d)} expires ${when(d)}`,
        explanation: () => "Unused time is forfeited on the day it expires.",
      },
      mentor: {
        kind: "actionable",
        label: (d) => `${dur(d)} expires ${when(d)}`,
        explanation: () => "Schedule a meeting before it is lost.",
      },
      student: {
        kind: "actionable",
        label: (d) => `${dur(d)} expires ${when(d)}`,
        explanation: () => "Book a session before then to use it.",
      },
    },
    many: (n) => `${n} allocations expire soon`,
  },

  ALLOCATION_EXPIRED: {
    severity: "problem",
    voices: {
      staff: {
        kind: "informational",
        label: (d) => `${dur(d)} expired unused`,
        explanation: () => "Forfeited on its use-by date. Grant more to replace it.",
      },
      mentor: {
        kind: "blocked",
        label: (d) => `${dur(d)} expired unused`,
        explanation: () => "You cannot log against an expired allocation.",
      },
      student: {
        kind: "informational",
        label: (d) => `${dur(d)} expired unused`,
        explanation: () => "It passed its use-by date. Ask about replacing it.",
      },
    },
    many: (n) => `${n} students lost time to an expiry`,
  },

  MEETING_AWAITING_ANSWER: {
    severity: "attention",
    voices: {
      staff: { kind: "informational", label: (d) => awaitingAnswerLabel(d) },
      mentor: {
        kind: "informational",
        label: (d) => awaitingAnswerLabel(d),
        explanation: () => "They have not said whether they will be there.",
      },
      student: {
        kind: "actionable",
        label: () => "Needs your answer",
        explanation: () => "Say whether you can make it.",
      },
    },
    many: (n) => `${n} meetings await an answer`,
  },

  MEETING_CONFIRMED: {
    severity: "ok",
    voices: {
      staff: { kind: "informational", label: () => "Confirmed" },
      mentor: { kind: "informational", label: () => "Confirmed" },
      student: { kind: "informational", label: () => "You're confirmed" },
    },
  },

  MEETING_DECLINED: {
    severity: "problem",
    voices: {
      staff: {
        kind: "informational",
        label: (d) => (d.name ? `${who(d)} can't make it` : "Declined"),
      },
      mentor: {
        kind: "actionable",
        label: (d) => (d.name ? `${who(d)} can't make it` : "Declined"),
        explanation: () => "Move it to another time, or cancel it.",
      },
      student: { kind: "informational", label: () => "You can't make it" },
    },
    many: (n) => `${n} meetings were declined`,
  },

    MEETING_UNLOGGED: {
    severity: "attention",
    voices: {
      staff: { kind: "informational", label: () => "Nothing logged" },
      mentor: {
        kind: "actionable",
        label: () => "Nothing logged",
        explanation: () => "It has passed. Log what happened, or cancel it.",
      },
      // A student had no voice here, so their page could only solve it by
      // hiding the meeting — and a meeting that happened yesterday vanishing
      // without a word is worse than an unresolved row. It is not theirs to
      // do anything about, so it is informational, and the explanation is the
      // reassurance the page this replaced actually gave them.
      student: {
        kind: "informational",
        label: () => "Waiting on your mentor",
        explanation: () => "It has passed. Your mentor will log the time.",
      },
    },
    many: (n) => `${n} past meetings have nothing logged`,
  },

  MEETING_CLOSED: {
    severity: "neutral",
    voices: {
      staff: { kind: "informational", label: (d) => (d.closedAs === "cancelled" ? "Cancelled" : "Held") },
      mentor: { kind: "informational", label: (d) => (d.closedAs === "cancelled" ? "Cancelled" : "Held") },
      student: { kind: "informational", label: (d) => (d.closedAs === "cancelled" ? "Cancelled" : "Held") },
    },
  },

  SESSION_NO_SHOW: {
    severity: "attention",
    voices: {
      staff: { kind: "informational", label: () => "No-show, time charged" },
      mentor: { kind: "informational", label: () => "No-show, time charged" },
      student: { kind: "informational", label: () => "Missed, time charged" },
    },
  },

  SESSION_LATE: {
    severity: "neutral",
    voices: {
      staff: { kind: "informational", label: () => "Came late" },
      mentor: { kind: "informational", label: () => "Came late" },
      student: { kind: "informational", label: () => "Started late" },
    },
  },

  SESSION_UNCONFIRMED: {
    severity: "attention",
    voices: {
      // The one voice that can act. Staff and mentors get told, because "the
      // student has not said yes" is the difference between a settled row and
      // one that might still be corrected — but neither of them can answer it.
      student: {
        kind: "actionable",
        label: () => "Confirm this session",
        explanation: () => "Say whether it happened, and how it went.",
      },
      mentor: { kind: "informational", label: () => "Not confirmed yet" },
      staff: { kind: "informational", label: () => "Not confirmed yet" },
    },
    many: (n) => `${n} sessions are waiting to be confirmed`,
  },

  SESSION_CONFIRMED: {
    severity: "ok",
    voices: {
      staff: { kind: "informational", label: () => "Confirmed" },
      mentor: { kind: "informational", label: () => "Confirmed" },
      student: { kind: "informational", label: () => "You confirmed this" },
    },
  },

  SESSION_DISPUTED: {
    severity: "problem",
    voices: {
      staff: {
        kind: "actionable",
        label: () => "Disputed",
        explanation: () => "Edit or void the session, or ask them what happened.",
      },
      mentor: {
        kind: "informational",
        label: () => "Disputed",
        explanation: () => "An admin corrects it. Their note says what is wrong.",
      },
      student: { kind: "informational", label: () => "You raised this" },
    },
    many: (n) => `${n} sessions are disputed`,
  },

  SESSION_EXTRA: {
    severity: "neutral",
    voices: {
      staff: { kind: "informational", label: () => "Extra, no time charged" },
      mentor: { kind: "informational", label: () => "Extra, no time charged" },
      student: { kind: "informational", label: () => "Extra, no time charged" },
    },
  },

  SESSION_RESCHEDULED: {
    severity: "neutral",
    voices: {
      staff: { kind: "informational", label: () => "Rescheduled, no time charged" },
      mentor: { kind: "informational", label: () => "Rescheduled, no time charged" },
      student: { kind: "informational", label: () => "Rescheduled, no time charged" },
    },
  },

  SESSION_VOIDED: {
    severity: "neutral",
    voices: {
      staff: { kind: "informational", label: () => "Voided, time returned" },
      mentor: { kind: "informational", label: () => "Voided, time returned" },
      student: { kind: "informational", label: () => "Cancelled, time returned" },
    },
  },

  TASK_NOT_STARTED: {
    severity: "neutral",
    voices: {
      staff: { kind: "informational", label: () => "Not started" },
      mentor: { kind: "informational", label: () => "Not started" },
      student: { kind: "informational", label: () => "Not started" },
    },
  },

  TASK_IN_PROGRESS: {
    severity: "neutral",
    voices: {
      staff: { kind: "informational", label: () => "In progress" },
      mentor: { kind: "informational", label: () => "In progress" },
      student: { kind: "informational", label: () => "In progress" },
    },
  },

  TASK_DONE: {
    severity: "ok",
    voices: {
      staff: { kind: "informational", label: () => "Done" },
      mentor: { kind: "informational", label: () => "Done" },
      student: { kind: "informational", label: () => "Done" },
    },
  },

  TASK_OVERDUE: {
    severity: "attention",
    voices: {
      staff: { kind: "actionable", label: (d) => `Due ${when(d)}, not done` },
      mentor: {
        kind: "actionable",
        label: (d) => `Due ${when(d)}, not done`,
        explanation: () => "Log progress, or ask an admin to move the date.",
      },
      student: {
        kind: "actionable",
        label: (d) => `Was due ${when(d)}`,
        explanation: () => "Still outstanding.",
      },
    },
    many: (n) => `${n} tasks are overdue`,
  },

  TASK_OVER_BUDGET: {
    severity: "problem",
    voices: {
      staff: { kind: "informational", label: (d) => `${dur(d)} over budget` },
      mentor: { kind: "informational", label: (d) => `${dur(d)} over budget` },
    },
  },

  TASK_NEEDS_MENTOR: {
    severity: "attention",
    voices: {
      staff: {
        kind: "actionable",
        label: () => "Needs a mentor",
        explanation: () => "Budgeted, but on nobody's list yet.",
      },
      mentor: { kind: "informational", label: () => "Needs a mentor" },
      student: { kind: "informational", label: () => "Mentor to be confirmed" },
    },
    many: (n) => `${n} tasks need a mentor`,
  },

  BOOKING_LINK_MISSING: {
    severity: "attention",
    voices: {
      staff: { kind: "informational", label: () => "No booking link" },
      mentor: {
        kind: "actionable",
        label: () => "No booking link",
        explanation: () => "Students cannot book you until you add one.",
      },
            student: {
        kind: "informational",
        label: () => "No booking link yet",
        many: (n) => `${n} mentors have not shared a calendar`,
      },
    },
    many: (n) => `${n} pairings have no booking link`,
  },

  MENTOR_UNASSIGNED: {
    severity: "attention",
    voices: {
      staff: {
        kind: "actionable",
        label: () => "Not in any program",
        explanation: () => "They signed in but cannot work until assigned.",
      },
      mentor: {
        kind: "blocked",
        label: () => "Waiting for a program",
        explanation: () => "An admin assigns you before you can log sessions.",
      },
    },
    many: (n) => `${n} mentors are not in any program`,
  },

  MENTOR_NAME_MISSING: {
    severity: "attention",
    voices: {
      staff: { kind: "informational", label: () => "Name missing" },
      mentor: {
        kind: "actionable",
        label: () => "Name missing",
        explanation: () => "Add your full name so students know who you are.",
      },
    },
  },

  FEEDBACK_LOW: {
    severity: "attention",
    voices: {
      staff: {
        kind: "actionable",
        label: () => "Low rating",
        explanation: () => "Worth reading before it becomes a pattern.",
      },
    },
    many: (n) => `${n} mentors are rated low`,
  },

  PROGRAM_ARCHIVED: {
    severity: "neutral",
    voices: {
      staff: { kind: "informational", label: () => "Archived" },
      mentor: { kind: "informational", label: () => "Archived" },
    },
  },

  PROGRAM_NO_MENTORS: {
    severity: "attention",
    voices: {
      staff: {
        kind: "actionable",
        label: () => "No mentors",
        explanation: () => "Nobody can be allocated time here yet.",
      },
    },
    many: (n) => `${n} programs have no mentors`,
  },

  STAFF_UNSCOPED: {
    severity: "problem",
    voices: {
      staff: {
        kind: "blocked",
        label: () => "No programs granted",
        explanation: () => "A platform admin grants you a program to work in.",
      },
    },
  },

  DIGEST_OFF: {
    severity: "neutral",
    voices: {
      staff: { kind: "informational", label: () => "Weekly email off" },
      mentor: { kind: "informational", label: () => "Weekly email off" },
      student: { kind: "informational", label: () => "Weekly email off" },
    },
  },

  ALL_CLEAR: {
    severity: "ok",
    voices: {
      staff: { kind: "informational", label: () => "Nothing needs you" },
      mentor: { kind: "informational", label: () => "Nothing needs you" },
      student: { kind: "informational", label: () => "Nothing needs you" },
    },
  },
};

/**
 * Build one status, in this audience's words — or `null` when this audience is
 * never told about it. Every producer goes through here, so no page can invent a
 * label or pick a severity of its own.
 */
export function status(
  type: StatusType,
  v: ViewerContext,
  detail: Detail = {},
  extra: Pick<Status, "href" | "subject" | "program" | "at"> = {}
): Status | null {
  const meta = META[type];
  const voice = meta.voices[v.audience];
  if (!voice) return null;
  return {
    type,
    severity: meta.severity,
    kind: voice.kind,
    label: voice.label(detail),
    ...(voice.explanation ? { explanation: voice.explanation(detail) } : {}),
    ...extra,
  };
}

/** Severity for a type, without building a status. For sorting a mixed list. */
export const severityOf = (type: StatusType): Severity => META[type].severity;

/**
 * Severity for a state that may be the ordinary one.
 *
 * The attendance and time-kind tables leave `status` unset for "attended" and
 * "in plan", because an ordinary session has nothing to announce. A caller
 * mapping such a table wants grey rather than a branch.
 */
export const severityOrNeutral = (type: StatusType | undefined): Severity =>
  type ? severityOf(type) : "neutral";

/** Every type, for the tests that hold the copy rules. */
export const STATUS_TYPES = Object.keys(META) as StatusType[];

// ---------------------------------------------------------------------------
// Producers — what is TRUE about a thing. One per kind of thing in the domain.
// ---------------------------------------------------------------------------

export type StudentStatusInput = {
  id: string;
  name: string | null;
  email: string;
  /** `USER_STATUS`. */
  accountStatus: string;
  telegramUsername: string | null;
  allottedMinutes: number;
  remainingMinutes: number;
  forfeitedMinutes: number;
  /** Live, unassigned pool minutes. */
  poolMinutes?: number;
  /**
   * The soonest use-by date still ahead, and only the minutes that expire ON
   * it — from `soonestExpiry` in `lib/deadlines.ts`.
   *
   * One object rather than two fields, because two fields disagreed: this took
   * `nextDeadline` on its own and paired it with `remainingMinutes`, so a
   * student with 2h ending on the 20th and 43h 30m ending in 2027 was told
   * "45h 30m expires September 20". A date and an amount that mean different
   * things must not be assemblable into one sentence by accident.
   */
  expiring?: { minutes: number; date: Date } | null;
  mentorCount?: number;
  program?: { id: string; name: string };
};

export function studentStatuses(
  s: StudentStatusInput,
  v: ViewerContext
): Status[] {
  const subject = {
    kind: "student" as const,
    id: s.id,
    name: s.name ?? s.email,
  };
    // A student reading their own rows is not a subject to be named, and
  // `/students/<id>` is a staff route that only bounces them home: every row
  // was a link that navigated to the page it was already on, captioned with
  // the reader's own name. Staff and mentors get both; the student gets
  // neither, and the page supplies its own destinations.
  const extra =
    v.audience === "student"
      ? {}
      : { subject, href: `/students/${s.id}`, ...(s.program ? { program: s.program } : {}) };
  const of = (type: StatusType, detail: Detail = {}, at?: Date) =>
    status(type, v, detail, at ? { ...extra, at } : extra);

  const out: (Status | null)[] = [];

  if (s.accountStatus === USER_STATUS.PENDING) {
    out.push(of("STUDENT_PENDING_APPROVAL"));
  } else if (!s.telegramUsername) {
    // Never having set a Telegram handle is the only signal we have that a
    // registered student has not yet completed a first sign-in.
    out.push(of("STUDENT_NOT_SIGNED_IN"));
  }
  if (s.email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`)) {
    out.push(of("STUDENT_PLACEHOLDER_EMAIL"));
  }

  if (s.remainingMinutes < 0) {
    out.push(of("BALANCE_OVERDRAWN", { minutes: s.remainingMinutes }));
  }
  if (s.allottedMinutes === 0) {
    out.push(of("BALANCE_NONE"));
  }
  if (s.forfeitedMinutes > 0) {
    out.push(of("ALLOCATION_EXPIRED", { minutes: s.forfeitedMinutes }));
  }
  if ((s.poolMinutes ?? 0) > 0) {
    out.push(of("POOL_UNASSIGNED", { minutes: s.poolMinutes }));
  }
  if (s.allottedMinutes > 0 && s.mentorCount === 0) {
    out.push(of("NO_MENTOR"));
  }

  // Only time that is still spendable can expire, and only the time actually
  // behind THIS date: `soonestExpiry` has already excluded passed deadlines,
  // empty grants and every grant that runs later, so nothing here needs to
  // consult the total balance.
  if (s.expiring && s.expiring.minutes > 0) {
    const days = daysUntil(s.expiring.date, v.now);
    if (days >= 0 && days <= EXPIRY_WINDOW_DAYS[v.audience]) {
      out.push(
        of(
          "ALLOCATION_EXPIRING",
          { minutes: s.expiring.minutes, date: s.expiring.date },
          s.expiring.date
        )
      );
    }
  }

  return out.filter((x): x is Status => x !== null);
}

export type MentorStatusInput = {
  id: string;
  name: string | null;
  email: string;
  /** `USER_STATUS`. */
  accountStatus: string;
  programCount: number;
  /** Pairings with no booking link set. */
  pairingsMissingLink: number;
  averageRating?: number | null;
  ratingCount?: number;
};

/** Below this a mentor's average is worth an admin reading the comments. */
export const LOW_RATING = 3.5;
/** Fewer ratings than this is not yet a pattern. */
const LOW_RATING_MIN_COUNT = 3;

export function mentorStatuses(m: MentorStatusInput, v: ViewerContext): Status[] {
  const extra = {
    subject: { kind: "mentor" as const, id: m.id, name: m.name ?? m.email },
    href: `/mentors/${m.id}`,
  };
  const of = (type: StatusType, detail: Detail = {}) => status(type, v, detail, extra);
  const out: (Status | null)[] = [];

  if (!m.name?.trim()) out.push(of("MENTOR_NAME_MISSING"));
  if (m.programCount === 0 || m.accountStatus === USER_STATUS.UNASSIGNED) {
    out.push(of("MENTOR_UNASSIGNED"));
  } else if (m.pairingsMissingLink > 0) {
    // Only worth saying once they have somewhere to be booked for.
    out.push(of("BOOKING_LINK_MISSING"));
  }
  if (
    m.averageRating != null &&
    m.averageRating < LOW_RATING &&
    (m.ratingCount ?? 0) >= LOW_RATING_MIN_COUNT
  ) {
    out.push(of("FEEDBACK_LOW"));
  }

  return out.filter((x): x is Status => x !== null);
}

export type ProgramStatusInput = {
  id: string;
  name: string;
  /** `ACTIVE` | `ARCHIVED`. Absent until the program-status migration lands. */
  status?: string;
  mentorCount: number;
  studentCount: number;
};

export function programStatuses(p: ProgramStatusInput, v: ViewerContext): Status[] {
  const extra = {
    subject: { kind: "program" as const, id: p.id, name: p.name },
    program: { id: p.id, name: p.name },
    href: `/programs/${p.id}`,
  };
  const out: (Status | null)[] = [];

  if (p.status === "ARCHIVED") out.push(status("PROGRAM_ARCHIVED", v, {}, extra));
  // A program with nobody in it is simply new, not broken.
  if (p.mentorCount === 0 && p.studentCount > 0) {
    out.push(status("PROGRAM_NO_MENTORS", v, {}, extra));
  }

  return out.filter((x): x is Status => x !== null);
}

export type TaskStatusInput = {
  id: string;
  purpose: string;
  /** `ASSIGNMENT_PROGRESS`. */
  progress: string;
  mentorId: string | null;
  minuteLimit: number | null;
  loggedMinutes: number;
  /**
   * A real due date. Null until the free-text `deadline` column is split into
   * `dueNote` + `dueOn`, so `TASK_OVERDUE` stays dormant until then rather than
   * guessing at "March-May".
   */
    dueOn?: Date | null;
  student?: { id: string; name: string };
  program?: { id: string; name: string };
};

export function taskStatuses(t: TaskStatusInput, v: ViewerContext): Status[] {
    const extra = {
    ...(t.student
      ? {
          subject: { kind: "student" as const, id: t.student.id, name: t.student.name },
          href: `/students/${t.student.id}`,
        }
      : // With no student to name, the task names itself. A row reading
        // "Overdue" with nothing beside it is a row about nothing.
        { subject: { kind: "task" as const, id: t.id, name: t.purpose } }),
    // Named for the same reason a student's row names it: a staff list spans
    // programs, and a row without one leaves the reader to guess whose it is.
    ...(t.program ? { program: t.program } : {}),
  };
  const of = (type: StatusType, detail: Detail = {}, at?: Date) =>
    status(type, v, detail, at ? { ...extra, at } : extra);
  const out: (Status | null)[] = [];

  const done = t.progress === ASSIGNMENT_PROGRESS.DONE;
  out.push(
    of(
      done
        ? "TASK_DONE"
        : t.progress === ASSIGNMENT_PROGRESS.IN_PROGRESS
          ? "TASK_IN_PROGRESS"
          : "TASK_NOT_STARTED"
    )
  );

  if (!t.mentorId) out.push(of("TASK_NEEDS_MENTOR"));
  if (!done && t.dueOn && t.dueOn.getTime() < v.now.getTime()) {
    out.push(of("TASK_OVERDUE", { date: t.dueOn }, t.dueOn));
  }
  // Work given beyond its budget still counts toward the task, so this is a
  // fact about the plan rather than about the hours.
  if (t.minuteLimit != null && t.loggedMinutes > t.minuteLimit) {
    out.push(of("TASK_OVER_BUDGET", { minutes: t.loggedMinutes - t.minuteLimit }));
  }

  return out.filter((x): x is Status => x !== null);
}

export type SessionStatusInput = {
  attended: boolean;
  late: boolean;
  /** `SESSION_STATUS`. */
  status: string;
  withinPlan: boolean;
  /** `SESSION_ANSWER`, or null while the student has not answered. */
  studentAnswer?: string | null;
  /** The day it was logged, for the window the row keeps asking inside. */
  date?: Date;
};

/**
 * What a logged session says about itself. Exception states only — a plain,
 * attended, in-plan session gets no chip at all, which is what removes the
 * green "Logged" badge from every row of the sessions table.
 */
export function sessionStatuses(s: SessionStatusInput, v: ViewerContext): Status[] {
  const out: (Status | null)[] = [];

  if (s.status === SESSION_STATUS.VOIDED) out.push(status("SESSION_VOIDED", v));
  else if (s.status === SESSION_STATUS.RESCHEDULED) {
    out.push(status("SESSION_RESCHEDULED", v));
  } else {
    if (!s.attended) out.push(status("SESSION_NO_SHOW", v));
    else if (s.late) out.push(status("SESSION_LATE", v));
  }
  if (!s.withinPlan) out.push(status("SESSION_EXTRA", v));

  // What the student said about it, and — while it is still recent and still
  // live — that they have not said anything. Only for a session that charged
  // something: an extra hour given on top of the plan moved no balance, so
  // there is nothing for a student to be asked to agree with.
  if (s.status === SESSION_STATUS.ACTIVE && s.withinPlan) {
    if (s.studentAnswer === SESSION_ANSWER.CONFIRMED) {
      out.push(status("SESSION_CONFIRMED", v));
    } else if (s.studentAnswer === SESSION_ANSWER.DISPUTED) {
      out.push(status("SESSION_DISPUTED", v));
    } else if (
      // A month, then the row stops asking. An unanswered session from March is
      // not a job anybody is going to do, and a permanent chip on every old row
      // is a chip that stops meaning anything.
      s.date &&
      daysSince(s.date, v.now) <= CONFIRM_WINDOW_DAYS
    ) {
      out.push(status("SESSION_UNCONFIRMED", v));
    }
  }

  return out.filter((x): x is Status => x !== null);
}

export type MeetingStatusInput = {
  id: string;
  /** `INTERVIEW_STATUS`. */
  status: string;
    scheduledAt: Date;
  sessionId: string | null;
  student?: { id: string; name: string };
  program?: { id: string; name: string };
};

/**
 * One status per meeting: a meeting is in exactly one state, and a row that
 * carried two chips would be describing two different meetings.
 *
 * "Passed with nothing logged" outranks the answer it was waiting for: once the
 * day is gone, whether the student had confirmed stopped being the open
 * question.
 */
export function meetingStatus(i: MeetingStatusInput, v: ViewerContext): Status | null {
    const extra = {
    at: i.scheduledAt,
    ...(i.student
      ? {
          subject: { kind: "student" as const, id: i.student.id, name: i.student.name },
          href: `/students/${i.student.id}`,
        }
      : {}),
    ...(i.program ? { program: i.program } : {}),
  };
  const detail = { name: i.student?.name ?? null };

  if (i.status === INTERVIEW_STATUS.HELD || i.status === INTERVIEW_STATUS.CANCELLED) {
    return status(
      "MEETING_CLOSED",
      v,
      { closedAs: i.status === INTERVIEW_STATUS.CANCELLED ? "cancelled" : "held" },
      extra
    );
  }

  // Same day counts as still ahead: a whole-day meeting has no time to compare
  // against, and one at 09:00 should not read as overdue over lunch.
    const overdue = startOfDay(i.scheduledAt) < startOfToday(v.now) && !i.sessionId;
  if (overdue) return status("MEETING_UNLOGGED", v, detail, extra);

  if (i.status === INTERVIEW_STATUS.DECLINED) {
    return status("MEETING_DECLINED", v, detail, extra);
  }
  if (i.status === INTERVIEW_STATUS.PROPOSED) {
    return status("MEETING_AWAITING_ANSWER", v, detail, extra);
  }
  return status("MEETING_CONFIRMED", v, detail, extra);
}

/**
 * Midnight of a date, matching how meeting times are stored and read.
 *
 * Only correct for a stored `scheduledAt`, which is the program's wall clock
 * kept in a UTC field. A real instant — `viewer.now` — has to go through
 * `programWallClock` first, or the two sit on different calendar days for the
 * five hours after midnight in Tashkent and a meeting later that morning reads
 * as already overdue.
 */
const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const startOfToday = (now: Date) => startOfDay(programWallClock(now));

// ---------------------------------------------------------------------------
// Presentation of a whole list
// ---------------------------------------------------------------------------

/** Problems first, then soonest within a band. Stable for equal rows. */
export function sortStatuses(list: Status[]): Status[] {
  return [...list].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.at && b.at) return a.at.getTime() - b.at.getTime();
    if (a.at) return -1;
    if (b.at) return 1;
    return 0;
  });
}

/**
 * Collapse a run of identical states into one row.
 *
 * This is what keeps a first screen calm regardless of the data. Ten imported
 * students with no allocation are ten true `BALANCE_NONE` statuses; printed in
 * full they are a wall of red that buries the one thing that is actually
 * unusual. Collapsed they are a single honest line — "10 students have no time
 * allocated →" — that hides the rows but never the magnitude.
 *
 * A group at or under the threshold stays expanded, because three named students
 * are more useful than the sentence "3 students…".
 */
/**
 * Where a rolled-up row goes: the filtered list holding exactly its rows.
 *
 * Only the types whose whole group IS a filter appear here. A roll-up of
 * meetings or tasks has no list yet that says the same thing, and a link that
 * lands on a nearly-right list is worse than a row that does not offer one —
 * the reader cannot tell which rows are the eight they tapped.
 */
const ROLLED_UP_LIST: Partial<Record<StatusType, string>> = {
  STUDENT_PENDING_APPROVAL: "/students?status=pending",
  STUDENT_NOT_SIGNED_IN: "/students?status=not-signed-in",
  BALANCE_NONE: "/students?time=none",
  ALLOCATION_EXPIRING: "/students?time=expiring",
  ALLOCATION_EXPIRED: "/students?time=expired",
  MENTOR_UNASSIGNED: "/mentors?status=unassigned",
  BOOKING_LINK_MISSING: "/mentors?link=missing",
};

export function rollUp(
  list: Status[],
  v: ViewerContext,
  opts: { threshold?: number } = {}
): Status[] {
  const threshold = opts.threshold ?? 3;
  const groups = new Map<StatusType, Status[]>();
  for (const s of list) {
    const group = groups.get(s.type);
    if (group) group.push(s);
    else groups.set(s.type, [s]);
  }

  const out: Status[] = [];
  for (const [type, group] of groups) {
        // This reader's wording first: a roll-up is still a sentence said to
    // somebody, and the shared fallback is written for staff.
    const many = META[type].voices[v.audience]?.many ?? META[type].many;
    if (group.length <= threshold || !many) {
      out.push(...group);
      continue;
    }
        // The subject is dropped because the row is about a count, not a person:
    // "8 students are overdrawn" names nobody, and captioning the row with one
    // arbitrary student of the eight was an arbitrary choice dressed up as an
    // answer. The href is not dropped any more — it is the filtered list, which
    // is the one destination that holds exactly the eight.
    const { program, at, severity, kind } = group[0];
    const list = ROLLED_UP_LIST[type];
    out.push({
      type,
      severity,
      kind,
      label: many(group.length),
      count: group.length,
      ...(list
        ? { href: program ? `${list}&program=${program.id}` : list }
        : {}),
      ...(program ? { program } : {}),
            ...(at ? { at } : {}),
    });
  }
  return sortStatuses(out);
}

/**
 * What an attention list renders: rolled up and sorted.
 *
 * Informational rows are kept and sorted below the actionable ones, because
 * §6.2 puts two of them in a mentor's list on purpose ("awaiting the student's
 * answer", "pending approval"): a mentor who cannot log a session needs the
 * reason on the same screen as the disabled control. They do not count toward
 * the section's badge — a list of three things you cannot act on is not a list
 * of three things to do.
 *
 * It returns an empty array when there is nothing, and does NOT insert an
 * `ALL_CLEAR` row. It used to, and that was a mistake: `AttentionList` already
 * renders its own `empty` text, so every page had to filter the injected row
 * back out — both pages built against it did, independently — and a page is
 * the thing that knows whether the right words are "Nothing needs you" or
 * "Nothing to do right now". `ALL_CLEAR` stays in the model for a caller that
 * genuinely wants an all-clear row in a list of rows.
 */
/**
 * A reader's dismissals, as the predicate that drops their rows.
 *
 * Keyed the way the table is — type plus the subject it is about — so that
 * dismissing "Not in any program" for one mentor says nothing about the next
 * mentor in the same state. A rolled-up row has no subject and dismisses the
 * whole roll-up, which is the only thing it could mean.
 */
export type Dismissals = ReadonlySet<string>;

export function dismissalKey(type: string, subjectId?: string | null): string {
  return `${type}:${subjectId ?? ""}`;
}

export function notDismissed(dismissed: Dismissals) {
  return (s: Status) => !dismissed.has(dismissalKey(s.type, s.subject?.id));
}

export function attentionList(
  list: Status[],
  v: ViewerContext,
  opts: { threshold?: number; limit?: number } = {}
): Status[] {
  const actionable = rollUp(
    list.filter((s) => s.kind !== "informational"),
    v,
    opts
  );
  const informational = rollUp(
    list.filter((s) => s.kind === "informational"),
    v,
    opts
  );

  const rows = [...actionable, ...informational];
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

/** How many rows in a list actually ask something of the viewer. */
export function actionableCount(list: Status[]): number {
  return list.filter((s) => s.kind === "actionable").length;
}
