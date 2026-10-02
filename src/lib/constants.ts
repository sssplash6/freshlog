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
    /**
     * How the option reads in the picker, and the whole of what the picker
     * says. Each of the four carried a sentence underneath explaining what it
     * cost — "A no-show. The time is still charged, but tallied as missed." —
     * and the owner cut all four: a mentor logs sessions every week and does
     * not read the same four explanations every week. What the state means
     * for the hours is said where it is read back, by `chip`.
     */
    label: string;
    /** How the state reads as a chip on a logged row. */
    chip?: string;
    /**
     * The state this attendance IS, in `lib/status.ts`, which is where its
     * severity comes from. A page may not choose a colour for it.
     */
    status?: StatusType;
  }
> = {
  ATTENDED: { label: "Attended" },
  LATE: { label: "Came late", chip: "Came late", status: "SESSION_LATE" },
  ABSENT: {
    label: "Absent",
    chip: "No-show, time charged",
    status: "SESSION_NO_SHOW",
  },
  RESCHEDULED: {
    label: "Rescheduled",
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
  { label: string; chip?: string; status?: StatusType }
> = {
  PLAN: { label: "Counts toward their time" },
  EXTRA: {
    label: "Extra, beyond their time",
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
 * The sessions that make a grant, a membership or an exchange history rather
 * than a mistake — every one but the voided. Each guard that refuses an
 * erasure because time was logged tells the admin to void those sessions
 * first, so a voided row must not count, or the advice is a dead end.
 * Rescheduled and extra-hours meetings still count: they are records of a
 * meeting, not retractions of one.
 */
export const STANDING_SESSION = {
  status: { not: SESSION_STATUS.VOIDED },
} as const;

/**
 * What stands in for the mentor in the key `(student, program, mentor)` when
 * the draw is the HOUR BANK's. Every total keyed on that triple takes the
 * mentor from `drawKey`, so a bank meeting never lands on whichever mentor
 * happened to deliver it, and a mentor's own grant is never drawn by it.
 */
const BANK_DRAW = "bank";

/** The mentor slot of an allocation-shaped key, for a session or an allocation. */
export function drawKey(row: {
  mentorId: string | null;
  fromBank?: boolean;
  isBank?: boolean;
}): string | null {
  return row.fromBank || row.isBank ? BANK_DRAW : row.mentorId;
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
  GOAL_ASSIGNED: "GOAL_ASSIGNED", // to the mentor: an admin gave them an agenda item (usually with the hours for it)
  GOAL_CHANGED: "GOAL_CHANGED", // to the mentor: their agenda item was edited, re-staged or removed
  GOAL_DONE: "GOAL_DONE", // to admins: work an admin planned is finished
  TASK_SET: "TASK_SET", // to the student: a mentor gave them something to go away and do
  TASK_CHANGED: "TASK_CHANGED", // to the student: that task was reworded, re-dated or withdrawn
  TASK_MOVED: "TASK_MOVED", // to the mentor: the student moved their task along, or finished it
  SESSION_ANSWERED: "SESSION_ANSWERED", // to the mentor + admins: the student confirmed or disputed a logged session
  FEEDBACK_RECEIVED: "FEEDBACK_RECEIVED", // to admins: a student rated a mentor
  EXCHANGE_SENT: "EXCHANGE_SENT", // to the host program's admins: a student was lent to you, with hours to allocate
  EXCHANGE_ALLOCATED: "EXCHANGE_ALLOCATED", // back to the sender: the host put those hours on a mentor
  EXCHANGE_RETURNED: "EXCHANGE_RETURNED", // to the other side: the placement is off
  PEER_INTERVIEW_BOOKED: "PEER_INTERVIEW_BOOKED", // to a student: a classmate booked one of their interview times
  BUG_REPORTED: "BUG_REPORTED", // to platform admins: somebody reported a bug
  BUG_FIXED: "BUG_FIXED", // to the reporter: their report was fixed
  BUG_CLOSED: "BUG_CLOSED", // to the reporter: their report was closed, with a note
  PEER_INTERVIEW_CANCELLED: "PEER_INTERVIEW_CANCELLED", // to the other student: a practice interview is off
  PEER_INTERVIEW_FEEDBACK: "PEER_INTERVIEW_FEEDBACK", // to the other student: their partner sent feedback on a practice interview
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
  TASKS: "Tasks and agenda",
  DEADLINES: "Deadlines",
  ACCOUNTS: "Accounts",
};

/**
 * Which categories reach somebody by EMAIL when they have said nothing.
 *
 * In-app is the default for everything and email is the default for almost
 * nothing: a feed is somewhere you look, and an inbox is somewhere you are
 * interrupted. Tasks are the exception, because a task is the one notice with
 * a deadline on it and the one thing a student is expected to go away and act
 * on — a student who does not open the app for a week is exactly the student
 * it was set for.
 *
 * Read by the sender, by the matrix on /settings that draws these switches,
 * and by the action that stores them — so the screen cannot promise one thing
 * while the mail does another. Turning it off in Settings is a stored row.
 */
export const EMAIL_BY_DEFAULT: Record<NotificationCategory, boolean> = {
  HOURS: false,
  SESSIONS: false,
  TASKS: true,
  DEADLINES: false,
  ACCOUNTS: false,
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
  TASK_SET: "TASKS",
  TASK_CHANGED: "TASKS",
  TASK_MOVED: "TASKS",
  FEEDBACK_RECEIVED: "ACCOUNTS",
  // Time, not an account: what the host admin does about it is allocate hours,
  // and what the sender waits to hear is that somebody holds them.
  EXCHANGE_SENT: "HOURS",
  EXCHANGE_ALLOCATED: "HOURS",
  EXCHANGE_RETURNED: "HOURS",
  // A practice interview is a meeting the student will turn up to, which is
  // what the rest of this category is about — not a category of its own for
  // two notices.
  PEER_INTERVIEW_BOOKED: "SESSIONS",
  BUG_REPORTED: "ACCOUNTS",
  BUG_FIXED: "ACCOUNTS",
  BUG_CLOSED: "ACCOUNTS",
  PEER_INTERVIEW_CANCELLED: "SESSIONS",
  PEER_INTERVIEW_FEEDBACK: "SESSIONS",
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
  // The plan's own vocabulary, which is "agenda" everywhere a reader can see
  // both halves at once. A mentor's feed carries these beside the TASK_* rows
  // below, and two things called "task" in one list is the confusion the
  // rename exists to remove — see `lib/tasks.ts` for which is which.
  GOAL_ASSIGNED: { label: "New agenda item", tone: "plan" },
  GOAL_CHANGED: { label: "Agenda changed", tone: "plan" },
  GOAL_DONE: { label: "Agenda item done", tone: "success" },
  TASK_SET: { label: "New task", tone: "plan" },
  TASK_CHANGED: { label: "Task changed", tone: "plan" },
  TASK_MOVED: { label: "Task progress", tone: "success" },
  FEEDBACK_RECEIVED: { label: "Feedback", tone: "brand" },
  EXCHANGE_SENT: { label: "Exchange", tone: "accent" },
  EXCHANGE_ALLOCATED: { label: "Exchange", tone: "accent" },
  EXCHANGE_RETURNED: { label: "Exchange", tone: "warning" },
  PEER_INTERVIEW_BOOKED: { label: "Practice interview", tone: "brand" },
  BUG_REPORTED: { label: "Bug report", tone: "brand" },
  BUG_FIXED: { label: "Bug fixed", tone: "success" },
  BUG_CLOSED: { label: "Bug closed", tone: "warning" },
  PEER_INTERVIEW_CANCELLED: { label: "Interview cancelled", tone: "warning" },
  PEER_INTERVIEW_FEEDBACK: { label: "Interview feedback", tone: "brand" },
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
