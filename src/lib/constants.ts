import type { StatusType } from "@/lib/status";

// Allowed values for the string columns in the Prisma schema.
// SQLite has no native enums, so these are enforced in application code.

export const ROLES = {
  ADMIN: "ADMIN",
  DEPT_LEADER: "DEPT_LEADER",
  SALES: "SALES",
  MENTOR: "MENTOR",
  STUDENT: "STUDENT",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const USER_STATUS = {
  ACTIVE: "ACTIVE",
  UNASSIGNED: "UNASSIGNED", // freshly signed-up mentors awaiting cohort assignment
  PENDING: "PENDING", // self-signed-up students awaiting admin approval
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

/**
 * `Program.status`. Two values, and they are the whole lifecycle: a finished
 * program stops appearing in the pickers without being deleted.
 *
 * It lived in `app/programs/reads.ts`, whose own comment said it belonged here
 * — the commit that added the column put it beside its first reader. A server
 * action needs it now, and an action importing a page module to find out what
 * "ARCHIVED" is spelled like is how a third spelling gets invented.
 */
export const PROGRAM_STATUS = { ACTIVE: "ACTIVE", ARCHIVED: "ARCHIVED" } as const;

export type ProgramStatus = (typeof PROGRAM_STATUS)[keyof typeof PROGRAM_STATUS];

/**
 * The domain the sheet import gives a student whose real address the sheet
 * never had. RFC 2606 reserves `.invalid`, so mail to it can never be
 * delivered — which is the point: a placeholder must be undeliverable rather
 * than quietly landing on somebody else's server. Anything that emails or
 * counts reachable students filters on this.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "import.invalid";

export const SESSION_STATUS = {
  ACTIVE: "ACTIVE",
  VOIDED: "VOIDED",
  // The meeting moved, so nothing was delivered. Kept as a status rather than an
  // attendance state because every hours query already counts ACTIVE only —
  // which is exactly the accounting a rescheduled meeting needs.
  RESCHEDULED: "RESCHEDULED",
} as const;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

/**
 * A student lent to another program, and how that placement ended.
 *
 *   OPEN      the hours are live: the host may allocate and log against them
 *   RETURNED  the host sent them back before anything was logged
 *
 * There is no "finished" state, and deliberately: an exchange whose hours are
 * spent is not over — the sessions are still the record both programs read,
 * and the sender may send more. Whether anything is left is a sum over the
 * allocations, which is a question the rows answer rather than a word somebody
 * has to remember to write.
 */
export const EXCHANGE_STATUS = {
  OPEN: "OPEN",
  RETURNED: "RETURNED",
} as const;

export type ExchangeStatus =
  (typeof EXCHANGE_STATUS)[keyof typeof EXCHANGE_STATUS];

/**
 * What the student says about a session their mentor logged.
 *
 * Null (no row value) is "not answered yet" and is the state every session
 * starts in — including every session logged before this existed, which is why
 * nothing was backfilled.
 *
 * Neither answer moves a balance. A dispute raises a flag an admin acts on by
 * correcting or voiding the session, which is an audited write with a
 * notification; a button that reversed a charge directly would be a button that
 * reversed it by accident.
 */
export const SESSION_ANSWER = {
  CONFIRMED: "CONFIRMED",
  DISPUTED: "DISPUTED",
} as const;

export type SessionAnswer =
  (typeof SESSION_ANSWER)[keyof typeof SESSION_ANSWER];

/** How long a student has before the row stops asking. */
export const CONFIRM_WINDOW_DAYS = 30;

/**
 * What kind of meeting a mentor is logging. One question with four answers,
 * because they are mutually exclusive and each one means something different for
 * the hours:
 *
 *   ATTENDED     the meeting happened          hours charged, delivered
 *   LATE         it happened, they were late   hours charged, delivered
 *   ABSENT       they didn't come              hours charged, tallied as missed
 *   RESCHEDULED  the meeting moved             no time charged at all
 *
 * Stored across `attended`, `late` and `status` (see attendanceOf), so the hours
 * engine keeps working off ACTIVE sessions without knowing this vocabulary.
 */
export const ATTENDANCE = {
  ATTENDED: "ATTENDED",
  LATE: "LATE",
  ABSENT: "ABSENT",
  RESCHEDULED: "RESCHEDULED",
} as const;

export type Attendance = (typeof ATTENDANCE)[keyof typeof ATTENDANCE];

export const ATTENDANCE_META: Record<
  string,
  {
    /** How the option reads in the picker. */
    label: string;
    hint: string;
    /** How the state reads as a chip on a logged row. */
    chip?: string;
    /**
     * The state this attendance IS, in `lib/status.ts`, which is where its
     * severity comes from. A page may not choose a colour for it.
     */
    status?: StatusType;
  }
> = {
  ATTENDED: { label: "Attended", hint: "The meeting happened as planned." },
  LATE: {
    label: "Came late",
    hint: "It happened; log the time you actually spent.",
    chip: "Came late",
    status: "SESSION_LATE",
  },
  ABSENT: {
    label: "Absent",
    hint: "A no-show. The time is still charged, but tallied as missed.",
    chip: "No-show, time charged",
    status: "SESSION_NO_SHOW",
  },
  RESCHEDULED: {
    label: "Rescheduled",
    hint: "The meeting moved, so no time is charged.",
    chip: "Rescheduled, no time charged",
    status: "SESSION_RESCHEDULED",
  },
};

/** How a stored session reads back as one of the four states. */
export function attendanceOf(session: {
  attended: boolean;
  late: boolean;
  status: string;
}): Attendance {
  if (session.status === SESSION_STATUS.RESCHEDULED) return ATTENDANCE.RESCHEDULED;
  if (!session.attended) return ATTENDANCE.ABSENT;
  return session.late ? ATTENDANCE.LATE : ATTENDANCE.ATTENDED;
}

/** The three columns one of the four states writes. */
export function attendanceFields(state: string): {
  attended: boolean;
  late: boolean;
  status: string;
} {
  switch (state) {
    case ATTENDANCE.LATE:
      return { attended: true, late: true, status: SESSION_STATUS.ACTIVE };
    case ATTENDANCE.ABSENT:
      return { attended: false, late: false, status: SESSION_STATUS.ACTIVE };
    case ATTENDANCE.RESCHEDULED:
      // attended stays true so that, if the status is ever corrected back, the
      // hours land as delivered rather than silently as missed.
      return { attended: true, late: false, status: SESSION_STATUS.RESCHEDULED };
    default:
      return { attended: true, late: false, status: SESSION_STATUS.ACTIVE };
  }
}

/**
 * Where a logged meeting's hours come from. Asked once, next to attendance,
 * because it is a different question with different consequences:
 *
 *   PLAN   the meeting spends hours the student was allocated  (the default)
 *   EXTRA  work done on top of the allocation — it charges nothing
 *
 * Stored as `Session.withinPlan`. The rule about what EXTRA does to the ledger
 * lives in `chargesAllocation()` (lib/hours.ts), not here.
 */
export const TIME_KIND = {
  PLAN: "PLAN",
  EXTRA: "EXTRA",
} as const;

export type TimeKind = (typeof TIME_KIND)[keyof typeof TIME_KIND];

export const TIME_KIND_META: Record<
  string,
  { label: string; hint: string; chip?: string; status?: StatusType }
> = {
  PLAN: {
    label: "Counts toward their time",
    hint: "The usual case — this time comes out of what the student holds with you.",
  },
  EXTRA: {
    label: "Extra, beyond their time",
    hint: "Work on top of the plan. It shows in the log and against the task, but charges nothing to their balance.",
    chip: "Extra, no time charged",
    status: "SESSION_EXTRA",
  },
};

/** How a stored session reads back as one of the two kinds. */
export function timeKindOf(session: { withinPlan: boolean }): TimeKind {
  return session.withinPlan ? TIME_KIND.PLAN : TIME_KIND.EXTRA;
}

/** The column one of the two kinds writes. */
export function timeKindFields(kind: string): { withinPlan: boolean } {
  return { withinPlan: kind !== TIME_KIND.EXTRA };
}

/**
 * THE rule about which logged hours move a balance, in one place.
 *
 * A session spends a student's allocation only when it is ACTIVE (a voided or
 * rescheduled one delivered nothing) AND in-plan (an EXTRA one was given on top
 * of the allocation, so it charges nothing). Everything that sums hours against
 * an allocation asks this — the predicate for rows already in memory, the
 * `CHARGED_SESSION` filter for sums the database does — so the policy can be
 * changed here rather than in a dozen queries that each half-remember it.
 *
 * Note what it deliberately does NOT govern: hours logged against a TASK. Work
 * done out of plan is still work done toward the essay, so goal progress counts
 * every active session (see lib/goal-progress.ts).
 */
export function chargesAllocation(session: {
  status: string;
  withinPlan: boolean;
}): boolean {
  return session.status === SESSION_STATUS.ACTIVE && session.withinPlan;
}

/** The same rule as a Prisma `where` fragment. */
export const CHARGED_SESSION = {
  status: SESSION_STATUS.ACTIVE,
  withinPlan: true,
} as const;

/**
 * A scheduled meeting's life. It starts PROPOSED because the student has not
 * answered yet; only they move it to CONFIRMED or DECLINED, only the mentor
 * CANCELLED, and logging the hours makes it HELD.
 */
export const INTERVIEW_STATUS = {
  PROPOSED: "PROPOSED",
  CONFIRMED: "CONFIRMED",
  DECLINED: "DECLINED",
  CANCELLED: "CANCELLED",
  HELD: "HELD",
} as const;

export type InterviewStatus =
  (typeof INTERVIEW_STATUS)[keyof typeof INTERVIEW_STATUS];

/**
 * A meeting's state, as a `lib/status.ts` type.
 *
 * `label` is the STAFF wording and is on its way out: it is viewer-agnostic, so
 * a student who declined read a red chip saying "Student can't make it" about
 * herself. `ScheduledMeetings` already reads its wording from the model per
 * reader; the last consumers lose this field as their pages are reshaped.
 */
export const INTERVIEW_STATUS_META: Record<
  string,
  { label: string; status: StatusType }
> = {
  PROPOSED: { label: "Awaiting confirmation", status: "MEETING_AWAITING_ANSWER" },
  CONFIRMED: { label: "Confirmed", status: "MEETING_CONFIRMED" },
  DECLINED: { label: "Student can't make it", status: "MEETING_DECLINED" },
  CANCELLED: { label: "Cancelled", status: "MEETING_CLOSED" },
  HELD: { label: "Held", status: "MEETING_CLOSED" },
};

/** Still in the diary: on the calendar, not cancelled, not yet logged. */
export function interviewIsOpen(interview: { status: string }): boolean {
  return (
    interview.status === INTERVIEW_STATUS.PROPOSED ||
    interview.status === INTERVIEW_STATUS.CONFIRMED ||
    interview.status === INTERVIEW_STATUS.DECLINED
  );
}

/** How far along one planned piece of work is. Admin-set, never derived. */
export const ASSIGNMENT_PROGRESS = {
  NOT_STARTED: "NOT_STARTED",
  IN_PROGRESS: "IN_PROGRESS",
  DONE: "DONE",
} as const;

export type AssignmentProgress =
  (typeof ASSIGNMENT_PROGRESS)[keyof typeof ASSIGNMENT_PROGRESS];

/**
 * Value the progress control submits to mean "stop pinning this, follow the
 * logged hours again". Not a progress state — a release of the manual pin.
 */
export const ASSIGNMENT_PROGRESS_AUTO = "AUTO";

export const ASSIGNMENT_PROGRESS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

/**
 * Progress as a status type, replacing the three separate `PROGRESS_TONE` maps
 * that had drifted: the same in-progress task was violet on the ledger board,
 * violet in the assignments table and violet-on-a-heading in the student's
 * goals, while "over budget" was red in one and amber in another.
 *
 * Progress is deliberately not chromatic — it is a shape (○ ◐ ✓) on a neutral
 * chip, so the two colours that remain are never spent on ordinary progress.
 */
export const ASSIGNMENT_PROGRESS_STATUS: Record<string, StatusType> = {
  NOT_STARTED: "TASK_NOT_STARTED",
  IN_PROGRESS: "TASK_IN_PROGRESS",
  DONE: "TASK_DONE",
};

/** The shape each progress state wears, in place of a colour. */
export const ASSIGNMENT_PROGRESS_GLYPH: Record<string, string> = {
  NOT_STARTED: "○",
  IN_PROGRESS: "◐",
  DONE: "✓",
};

export const NOTIFICATION_TYPES = {
  HOURS_GRANTED: "HOURS_GRANTED",
  SESSION_LOGGED: "SESSION_LOGGED",
  SESSION_EDITED: "SESSION_EDITED",
  SESSION_VOIDED: "SESSION_VOIDED",
  SESSION_DELETED: "SESSION_DELETED", // an admin removed a logged session outright
  STUDENT_SIGNUP: "STUDENT_SIGNUP", // to admins: a student finished onboarding
  ACCOUNT_APPROVED: "ACCOUNT_APPROVED", // to the student: admin approved them
  MENTOR_ASSIGNED: "MENTOR_ASSIGNED", // to the mentor: assigned to a program, set your booking link
  HOURS_DEADLINE: "HOURS_DEADLINE", // to student + mentor: allocation deadline approaching or passed
  ENROLLMENT_MOVED: "ENROLLMENT_MOVED", // to the student: admin corrected their program/cohort
  GOAL_ASSIGNED: "GOAL_ASSIGNED", // to the mentor: an admin gave them a task (usually with the hours for it)
  GOAL_CHANGED: "GOAL_CHANGED", // to the mentor: their task was edited, re-staged or removed
  GOAL_DONE: "GOAL_DONE", // to admins: work an admin planned is finished
  INTERVIEW_SCHEDULED: "INTERVIEW_SCHEDULED", // to the student: a mentor put a meeting in the diary, please confirm
  INTERVIEW_MOVED: "INTERVIEW_MOVED", // to the student: that meeting changed time, please confirm again
  INTERVIEW_CANCELLED: "INTERVIEW_CANCELLED", // to the other side: it's off
  INTERVIEW_ANSWERED: "INTERVIEW_ANSWERED", // to the mentor: the student confirmed, or can't make it
  SESSION_ANSWERED: "SESSION_ANSWERED", // to the mentor + admins: the student confirmed or disputed a logged session
  FEEDBACK_RECEIVED: "FEEDBACK_RECEIVED", // to admins: a student rated a mentor
  EXCHANGE_SENT: "EXCHANGE_SENT", // to the host program's admins: a student was lent to you, with hours to allocate
  EXCHANGE_ALLOCATED: "EXCHANGE_ALLOCATED", // back to the sender: the host put those hours on a mentor
  EXCHANGE_RETURNED: "EXCHANGE_RETURNED", // to the other side: the placement is off
  WEEKLY_SUMMARY: "WEEKLY_SUMMARY", // to everyone who wants it: the Monday digest, in the feed too
} as const;

/**
 * The six things a notification can be about.
 *
 * Six, not seventeen: a filter with a row per type is a filter nobody uses, and
 * a person deciding which emails they want is answering "do I care about
 * meetings" rather than about INTERVIEW_MOVED specifically. Each category is
 * one subscription in the notification preferences.
 */
export const NOTIFICATION_CATEGORY = {
  HOURS: "HOURS",
  SESSIONS: "SESSIONS",
  MEETINGS: "MEETINGS",
  TASKS: "TASKS",
  DEADLINES: "DEADLINES",
  ACCOUNTS: "ACCOUNTS",
} as const;

/**
 * The weekly digest, as a preference key.
 *
 * Not a NOTIFICATION_CATEGORY: it is a subscription to one email rather than a
 * kind of notice, and it predates the categories by a year. It shares the
 * preference table because "what do you want to hear about" is one question.
 */
export const WEEKLY_SUMMARY_PREF = "WEEKLY_SUMMARY";

export type NotificationCategory =
  (typeof NOTIFICATION_CATEGORY)[keyof typeof NOTIFICATION_CATEGORY];

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  HOURS: "Time",
  SESSIONS: "Sessions",
  MEETINGS: "Meetings",
  TASKS: "Tasks",
  DEADLINES: "Deadlines",
  ACCOUNTS: "Accounts",
};

/**
 * Which category each type belongs to, stated once. The migration that added
 * the column derived exactly this in SQL; this is the same map for every row
 * written from here on, so a new type cannot land without being placed.
 */
export const CATEGORY_OF: Record<NotificationType, NotificationCategory> = {
  HOURS_GRANTED: "HOURS",
  SESSION_LOGGED: "SESSIONS",
  SESSION_EDITED: "SESSIONS",
  SESSION_VOIDED: "SESSIONS",
  SESSION_DELETED: "SESSIONS",
  SESSION_ANSWERED: "SESSIONS",
  STUDENT_SIGNUP: "ACCOUNTS",
  ACCOUNT_APPROVED: "ACCOUNTS",
  MENTOR_ASSIGNED: "ACCOUNTS",
  HOURS_DEADLINE: "DEADLINES",
  ENROLLMENT_MOVED: "ACCOUNTS",
  GOAL_ASSIGNED: "TASKS",
  GOAL_CHANGED: "TASKS",
  GOAL_DONE: "TASKS",
  INTERVIEW_SCHEDULED: "MEETINGS",
  INTERVIEW_MOVED: "MEETINGS",
  INTERVIEW_CANCELLED: "MEETINGS",
  INTERVIEW_ANSWERED: "MEETINGS",
  FEEDBACK_RECEIVED: "ACCOUNTS",
  // Time, not an account: what the host admin does about it is allocate hours,
  // and what the sender waits to hear is that somebody holds them.
  EXCHANGE_SENT: "HOURS",
  EXCHANGE_ALLOCATED: "HOURS",
  EXCHANGE_RETURNED: "HOURS",
  WEEKLY_SUMMARY: "ACCOUNTS",
};

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * How each kind of notification reads in a list: a short label and the tone it
 * carries. Grouped so the page can say what an item IS before its sentence, and
 * so the eye can sort a mixed feed without reading every line.
 */
export const NOTIFICATION_META: Record<
  string,
  { label: string; tone: "brand" | "accent" | "plan" | "success" | "warning" }
> = {
  HOURS_GRANTED: { label: "Time", tone: "accent" },
  SESSION_LOGGED: { label: "Session logged", tone: "brand" },
  SESSION_EDITED: { label: "Session corrected", tone: "warning" },
  SESSION_VOIDED: { label: "Session voided", tone: "warning" },
  SESSION_DELETED: { label: "Session removed", tone: "warning" },
  SESSION_ANSWERED: { label: "Session answer", tone: "success" },
  STUDENT_SIGNUP: { label: "New signup", tone: "brand" },
  ACCOUNT_APPROVED: { label: "Approved", tone: "success" },
  MENTOR_ASSIGNED: { label: "Assigned", tone: "brand" },
  HOURS_DEADLINE: { label: "Deadline", tone: "warning" },
  ENROLLMENT_MOVED: { label: "Enrollment", tone: "brand" },
  GOAL_ASSIGNED: { label: "New task", tone: "plan" },
  GOAL_CHANGED: { label: "Task changed", tone: "plan" },
  GOAL_DONE: { label: "Task done", tone: "success" },
  INTERVIEW_SCHEDULED: { label: "Meeting scheduled", tone: "plan" },
  INTERVIEW_MOVED: { label: "Meeting moved", tone: "plan" },
  INTERVIEW_CANCELLED: { label: "Meeting cancelled", tone: "warning" },
  INTERVIEW_ANSWERED: { label: "Meeting answer", tone: "success" },
  FEEDBACK_RECEIVED: { label: "Feedback", tone: "brand" },
  EXCHANGE_SENT: { label: "Exchange", tone: "accent" },
  EXCHANGE_ALLOCATED: { label: "Exchange", tone: "accent" },
  EXCHANGE_RETURNED: { label: "Exchange", tone: "warning" },
  WEEKLY_SUMMARY: { label: "Weekly summary", tone: "plan" },
};

/**
 * Whether a user may operate as a mentor: either a plain MENTOR, or an ADMIN
 * who was also flagged as a mentor (dual-role admins). Used by the mentor-side
 * gates and the mentor-pool queries so admin-mentors are first-class mentors.
 */
export function canActAsMentor(user: {
  role: string;
  isMentor?: boolean | null;
}): boolean {
  return user.role === ROLES.MENTOR || (user.role === ROLES.ADMIN && !!user.isMentor);
}

// Home route for each role after sign-in.
export const ROLE_HOME: Record<Role, string> = {
  ADMIN: "/admin",
  // Scoped staff land on the same inbox as an admin; what they see there is
  // decided by their grants, not by which route they were sent to.
  DEPT_LEADER: "/admin",
  SALES: "/admin",
  MENTOR: "/mentor",
  STUDENT: "/student",
};
