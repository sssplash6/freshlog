/**
 * The contract between freshform's /api/v1 and the freshlog app: the body of
 * every request and every answer the API has, in one file.
 *
 * The app keeps a verbatim copy (its src/api/types.ts, refreshed by
 * `npm run sync-contract`), so this file imports nothing. Change a shape here
 * and the copy has to change with it: nothing fails when the two drift, a phone
 * just reads a field that is not there.
 *
 * Dates are ISO 8601 strings, which is all JSON can carry.
 */

/** A part of the app a person may use. */
export type ApiRole = "student" | "mentor" | "admin";

/**
 * What `MeResponse.roles[0]` still needs before its home works, decided the way
 * the website decides where to send someone:
 *
 * - `student-profile`: no student record yet, no name, or no Telegram username
 * - `mentor-name`: no name
 * - `pending-approval`: registered, and staff have not approved the account yet
 * - `unassigned`: a mentor no program has taken on yet
 * - `no-access`: no role at all, so there is no home to open
 *
 * `null` when it needs nothing, and always when `roles[0]` is "admin": a person
 * whose first role is admin gets `null` whatever their status or name. So
 * `null` does not mean the account is ACTIVE, and the app must read
 * `MeResponse.status` too.
 */
export type Onboarding = "student-profile" | "mentor-name" | "pending-approval" | "unassigned" | "no-access" | null;

/**
 * `GET /api/v1/me`: who is signed in, which parts of the app they may use, and
 * what they still have to set up.
 *
 * The one endpoint, besides sign-in, that answers someone who is not ACTIVE
 * yet. That is how a pending student finds out what they are waiting for.
 */
export type MeResponse = {
  /** `User.id`. */
  id: string;
  /** `StudentProfile.id`, which is how a student is addressed; null for anyone without a student record. */
  studentProfileId: string | null;
  name: string | null;
  email: string;
  /**
   * PENDING is a student nobody has approved. UNASSIGNED is a mentor no program
   * has taken on. Everything outside /me and sign-in refuses both with a 403
   * whose `code` is "inactive".
   */
  status: "ACTIVE" | "PENDING" | "UNASSIGNED";
  /** Ordered; `roles[0]` is the home. Empty when the person has no role at all. */
  roles: ApiRole[];
  platformAdmin: boolean;
  /**
   * "/api/avatar/<id>?v=<ms>"; null when there is no picture. The app cannot
   * fetch it yet: /api/avatar stays behind the website's cookie check until
   * Phase 6, so a request that carries only the bearer is sent to /login.
   */
  avatarPath: string | null;
  /** Unread notifications. */
  unread: number;
  /** What `roles[0]` still needs before its home works. */
  onboarding: Onboarding;
};

/** `POST /api/v1/auth/token`: the one-time code the sign-in redirect carried, with the proof it is ours. */
export type TokenRequest = {
  code: string;
  /** The PKCE verifier whose S256 challenge the sign-in started with. */
  code_verifier: string;
  /** The redirect the sign-in started with, unchanged. */
  redirect_uri: string;
  /** What to call this phone. */
  device_name?: string;
};

/** The bearer token, which is shown once, and the time it expires if it goes unused. */
export type TokenResponse = { token: string; expiresAt: string };

/** One row of `GET /api/v1/auth/dev`: an account a developer may sign in as on a local server. */
export type SampleAccount = { email: string; name: string | null; role: string; status: string };

/**
 * The body of every refusal. `error` is in words the app can show. `field`
 * names the input that is wrong. `code` is for an answer the app acts on rather
 * than shows: "unauthenticated" (no valid token, so sign out) and "inactive"
 * (the account is not ACTIVE yet).
 */
export type ApiRefusal = { ok: false; error: string; field?: string; code?: string };

/** A person as a row names them: `name` is their name, or their email when they have none. */
export type PersonRef = { id: string; name: string };
/** A student: `id` is the StudentProfile.id, which is how every form addresses them; `userId` is the User.id. */
export type StudentRef = { id: string; userId: string; name: string };
/** `colorIndex` is the program's dot. */
export type ProgramRef = { id: string; name: string; colorIndex: number };
export type Attendance = "ATTENDED" | "LATE" | "ABSENT" | "RESCHEDULED";
/** PLAN draws the student's hours down; EXTRA is given on top and charges nothing. */
export type TimeKind = "PLAN" | "EXTRA";
export type SessionState = "ACTIVE" | "VOIDED" | "RESCHEDULED";
export type StudentAnswer = "CONFIRMED" | "DISPUTED";

/** One session, as the person reading it may see it. Lists and the single read answer the same shape. */
export type ApiSession = {
  id: string;
  /** "YYYY-MM-DD", the Tashkent day it was logged for. */
  day: string;
  minutes: number;
  attendance: Attendance;
  kind: TimeKind;
  state: SessionState;
  /** It draws the student's hours down: ACTIVE and in the plan (no-shows included). */
  charged: boolean;
  /** What the student said; null while they haven't answered. */
  answer: StudentAnswer | null;
  /** The student's words: to the student, always; to anyone else, only on a dispute. */
  answerNote: string | null;
  /** The student is being asked to confirm it: ACTIVE, in the plan, unanswered, at most 30 days old. */
  needsAnswer: boolean;
  student: StudentRef;
  mentor: PersonRef;
  program: ProgramRef;
  /** The plan item it went toward. */
  task: { id: string; purpose: string } | null;
  /** What the mentor wrote. Always null for the student. */
  note: string | null;
  /** What the reader may do with it, by the same rules the actions enforce. */
  can: { edit: boolean; void: boolean; restore: boolean; answer: boolean };
};

/** GET /api/v1/sessions: the query, every field optional. */
export type SessionsQuery = {
  /** `nextCursor` from the page before. */
  cursor?: string;
  /** 1 to 100; 25 when left out or out of range. */
  limit?: string;
  /** A mentor's list only: one student (StudentProfile.id). */
  student?: string;
  program?: string;
  /** `week` is the Tashkent week from Monday. */
  period?: "week" | "30d" | "90d" | "year";
  status?: "active" | "voided";
  /** `needed`: the student is being asked to confirm it. `disputed`: the student disputed it, and it isn't voided. */
  answer?: "needed" | "disputed";
  /** A mentor's list only: the note, the plan item, the student's name. */
  q?: string;
};

/** A page of the reader's sessions, newest first, with figures for the whole filter. */
export type SessionsPage = {
  items: ApiSession[];
  /** null on the last page. */
  nextCursor: string | null;
  /** Over every session the filter matches: `count` is sessions; the rest are minutes. */
  totals: { count: number; charged: number; missed: number; extra: number; voided: number };
  /** The status chips: the filter without its period, status and answer. */
  counts: { disputed: number; voided: number };
  /** The programs the reader's sessions are in, for a program filter. */
  programs: ProgramRef[];
};

/** PATCH /api/v1/sessions/:id: only what changes. Anything left out keeps its value. */
export type SessionEdit = {
  day?: string;
  minutes?: number;
  attendance?: Attendance;
  kind?: TimeKind;
  /** null or "" clears it. */
  note?: string | null;
  /** A plan item. One a session already has can't be taken off it. */
  assignmentId?: string;
};
/** POST /api/v1/sessions/:id/answer. A dispute needs a note. */
export type SessionAnswerRequest = { answer: StudentAnswer; note?: string };
/** What a write answers when it worked: the website's own sentence, and for a log, the session it made (`receipt.id`). */
export type WriteResult = { ok: true; message?: string; receipt?: { id: string; headline: string; notes: string[] } };

/** GET /api/v1/log-options: who the signed-in mentor can log a session for, and how their hours stand. */
export type LogOptions = {
  /** Today in Tashkent: the log sheet's default day, and the latest it allows. */
  today: string;
  /** In freshform's order: students with hours left first. */
  students: LogStudent[];
  /** The mentor's latest sessions, newest first, one per student and program, at most 8: the quick picks and the usual length. */
  recent: { studentProfileId: string; programId: string; minutes: number }[];
};
export type LogStudent = { id: string; name: string; programs: LogProgram[] };
export type LogProgram = {
  program: ProgramRef;
  /** ready: hours left. none: no hours with this mentor. overdrawn or expired: a log still counts, so the sheet asks first. */
  state: "ready" | "none" | "overdrawn" | "expired";
  /**
   * The figure `state` was decided from, in minutes, negative when over: what the student's unassigned pool or hour
   * bank holds when the hours are in one, otherwise what is left of this mentor's own grant. null when `state` is none.
   */
  remaining: number | null;
  /** Minutes this mentor's own grant gave them here; null when they hold none, as with a pool or an hour bank. */
  allocated: number | null;
  /** "YYYY-MM-DD", the use-by day of whatever `remaining` comes from; null when `remaining` is. */
  useBy: string | null;
  /** Plan items this session can go toward. */
  goals: { id: string; label: string }[];
};
/** POST /api/v1/sessions: a session the signed-in mentor held. */
export type LogSessionRequest = {
  studentProfileId: string;
  /** Needed when the student is in more than one of the mentor's programs. */
  programId?: string;
  /** "YYYY-MM-DD", today in Tashkent or earlier. */
  day: string;
  minutes: number;
  /** ATTENDED when left out. */
  attendance?: Attendance;
  /** PLAN when left out. */
  kind?: TimeKind;
  note?: string;
  /** A plan item from `LogProgram.goals`. */
  assignmentId?: string;
};

/** One row of To do: one of freshform's statuses, already in the reader's words. */
export type TodoRow = {
  /**
   * Stable across loads and unique in one answer: the status type, its subject
   * and its program, and for a session to confirm its session as well, since
   * one mentor may have logged several.
   */
  key: string;
  /** freshform's StatusType. */
  type: string;
  severity: "neutral" | "ok" | "attention" | "problem";
  /** At most four words. */
  label: string;
  /** At most twelve words: what to do about it. */
  explanation: string | null;
  subject: { kind: "student" | "mentor" | "program" | "task"; id: string; name: string } | null;
  program: ProgramRef | null;
  /** How many rows were rolled into this one; null for a single row. */
  count: number | null;
  /** The website's page for it. The app opens only its own screens. */
  href: string | null;
  /** A session to confirm (SESSION_UNCONFIRMED). */
  sessionId: string | null;
  /** A session to log, prefilled (ALLOCATION_EXPIRING, MEETING_TO_LOG). */
  log: { studentProfileId: string; programId: string | null; minutes: number | null; day: string | null; attendance: Attendance | null } | null;
};
/** One student, in one program, that the mentor holds time with, has met, or plans with. freshform's order. */
export type CaseloadRow = {
  student: StudentRef;
  program: ProgramRef;
  /** Minutes this mentor was given; 0 when none. */
  allocated: number;
  /** Minutes left with this mentor, negative when over. */
  remaining: number;
  useBy: string | null;
  /** Days until `useBy`, from today in Tashkent; null without one. */
  daysLeft: number | null;
  expired: boolean;
  /** Unassigned minutes they hold, when this mentor has no grant of their own. */
  pool: number | null;
  /**
   * The minutes left in the student's hour bank, negative when overdrawn, when
   * this row is the bank; null on any other row. Every meeting draws a bank,
   * whoever holds it, so a bank row's `allocated` and `remaining` are 0 and its
   * `pool` is null: none of it is this mentor's grant, and none is unassigned.
   */
  bankLeft: number | null;
  approved: boolean;
  /** The most serious of freshform's statuses for this row; null when there is none. */
  status: { type: string; severity: TodoRow["severity"] } | null;
  /** How to reach them. */
  telegram: string | null;
  email: string;
};
/** GET /api/v1/mentor/home. */
export type MentorHome = {
  /** `remaining` nets overdraws, as every freshform page sums a balance. `expiring` counts rows whose status is ALLOCATION_EXPIRING. `disputed` counts their sessions a student disputed that aren't voided. */
  summary: { remaining: number; students: number; expiring: number; disputed: number };
  todo: TodoRow[];
  students: CaseloadRow[];
};

/** One mentor's hours in one program, or the student's hour bank there. */
export type StudentGrant = {
  /** null for the hour bank, which every meeting draws. */
  mentor: PersonRef | null;
  /** The student's hour bank. With no `mentor`, false is time nobody has been chosen for yet. */
  bank: boolean;
  program: ProgramRef;
  allocated: number;
  /** Minutes left, negative when over. */
  remaining: number;
  /** Minutes lost when the use-by passed. */
  forfeited: number;
  expired: boolean;
  useBy: string | null;
  daysLeft: number | null;
  /**
   * The mentor's booking page for this program or, when they have none here, the
   * one from another of the student's pairings with them, as the website's Book
   * page finds it. Null when they have none anywhere.
   */
  bookingUrl: string | null;
};
/** GET /api/v1/student/home. */
export type StudentHome = {
  /** Minutes over every grant: given, used, left, lost to expiry, and given on top of the plan. */
  hours: { allotted: number; used: number; remaining: number; forfeited: number; extra: number };
  /** The soonest live grant to expire, with only the minutes that expire then. */
  expiring: { minutes: number; day: string } | null;
  grants: StudentGrant[];
  /** freshform's "things to check", in its order. A session to confirm carries its id. */
  todo: TodoRow[];
  /** Sessions waiting for their answer. */
  toConfirm: number;
};
