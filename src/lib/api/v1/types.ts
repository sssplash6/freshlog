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
 * - `unassigned`: no longer sent. A mentor no program has taken on yet has
 *   the mentor home, as on the website (it says "Waiting for a program"), with
 *   `status` UNASSIGNED; a build that waits on it is told so by `status`.
 * - `no-access`: no role at all, so there is no home to open
 *
 * `null` when it needs nothing. When `roles[0]` is "admin" it is `null`
 * whatever their status, bar `mentor-name` for a mentor granted a program
 * before giving their name. So `null` does not mean the account is ACTIVE, and
 * the app must read `MeResponse.status` too: ACTIVE, or UNASSIGNED for a
 * mentor, opens a home; PENDING waits.
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
   * The widest staff grant they hold, as the website's nav reads it (a platform
   * admin is ADMIN); null for nobody's staff. The nav gives SALES Students,
   * Programs and Analytics; LEADER Feedback too; ADMIN Mentors, Sessions and
   * Interview prep as well. The pages behind them say the same.
   */
  staffLevel: "ADMIN" | "LEADER" | "SALES" | null;
  /** The website's Classes page answers them: a program they work in schedules classes (its sidebar's Classes). */
  classes: boolean;
  /**
   * "/api/v1/avatars/<id>?v=<ms>"; null when there is no picture. The API's
   * own copy of the website's /api/avatar, which stays behind the website's
   * cookie check; `?v=` changes with each new picture.
   */
  avatarPath: string | null;
  /** Unread notifications. */
  unread: number;
  /** What `roles[0]` still needs before its home works. */
  onboarding: Onboarding;
  /** When they asked for their account to be deleted (`POST account/deletion`); null when they have not. */
  deletionRequestedAt: string | null;
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
  /**
   * The student's words, as the website's row shows them: to the student and to
   * the program's staff, always; to a mentor who doesn't run the program, only
   * on a dispute, which is addressed to them.
   */
  answerNote: string | null;
  /** The student's stars, 1 to 5: to the student and to the program's staff. Never to a mentor reading their own log. */
  answerRating: number | null;
  /**
   * The website's chips for this row, in its order and in the reader's words
   * (`sessionStatuses`): "Came late", "Extra", "Confirmed", "Disputed" and the
   * rest. The student's own list leaves out "You confirmed this", as the page
   * does; nobody but the student is told it is unconfirmed.
   */
  statuses: { type: string; label: string; severity: "problem" | "attention" | "neutral" | "ok"; explanation: string | null }[];
  /** The student is being asked to confirm it: ACTIVE, in the plan, unanswered, at most 30 days old. */
  needsAnswer: boolean;
  student: StudentRef;
  mentor: PersonRef;
  program: ProgramRef;
  /** The plan item it went toward. */
  task: { id: string; purpose: string } | null;
  /** What the mentor wrote. Always null for the student. */
  note: string | null;
  /** What the reader may do with it, by the same rules the actions enforce. `delete`: DELETE /api/v1/sessions/:id. */
  can: { edit: boolean; void: boolean; restore: boolean; answer: boolean; delete: boolean };
};

/** GET /api/v1/sessions: the query, every field optional. */
export type SessionsQuery = {
  /** `nextCursor` from the page before. */
  cursor?: string;
  /** 1 to 100; 25 when left out or out of range. */
  limit?: string;
  /** A mentor's or an admin's list only: one student (StudentProfile.id). */
  student?: string;
  /**
   * One mentor (User.id): on a student's own list, the sessions with them, for
   * that mentor's page; on an admin's (`as=admin`), the website's `?mentor=`,
   * as the mentor page's All sessions links. `me` is the reader. A mentor's own
   * list ignores it.
   */
  mentor?: string;
  program?: string;
  /** `week` is the Tashkent week from Monday. Left out with no `from` or `to`, it is all time. */
  period?: "week" | "30d" | "90d" | "year";
  /** The website's typed range, "YYYY-MM-DD" each, either end alone; it beats `period`, and a backwards one is turned round. */
  from?: string;
  to?: string;
  /** The website's Attendance filter. */
  attendance?: "attended" | "late" | "absent" | "rescheduled";
  /** The website's Kind filter: `plan` counts toward the student's time, `extra` is beyond it. */
  kind?: "plan" | "extra";
  status?: "active" | "voided";
  /** `needed`: the student is being asked to confirm it. `disputed`: the student disputed it, and it isn't voided. */
  answer?: "needed" | "disputed";
  /** A plan item (Assignment.id): narrows to the sessions logged against it. */
  assignment?: string;
  /** A mentor's or an admin's list only: the note, the plan item, the student's name. */
  q?: string;
  /**
   * Whose list, for a reader who has two. Left out, it is a student's own
   * sessions (a student who also mentors included, as `/me` lists them a
   * student first), else the ones a mentor logged. `mentor` is the app's mentor
   * side asking for the ones the reader logged, whatever else they are, and for
   * a reader who administers programs only those in the programs they run, as
   * the website's Sessions page shows them (its Mine); to anyone who can't act
   * as a mentor it is a 404, as it is to every reader with no list. `admin` is the app's admin side asking for every session in the
   * programs the reader reads; to anyone who reads none it is a 404.
   * `record` is a student's page (`student` names them): the student's whole
   * ledger as the website's student page shows it, every mentor's sessions to a
   * mentor who reaches them, their programs' to an admin of them; a 404 to
   * anyone else.
   */
  as?: "mentor" | "admin" | "record";
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
  /**
   * The website's Program select: every program the reader administers, when
   * that is more than one; empty otherwise (a mentor who runs none is not
   * offered one). More than one also means each row names its program.
   */
  programFilter: ProgramRef[];
  /** The mentor an admin's list is narrowed to (`?mentor=`), so it can be named when nothing matches; else null. */
  mentor: PersonRef | null;
  /**
   * A student's own list: the website's footer under Past meetings, "2 voided ·
   * 1 rescheduled", over their whole log; null when it has nothing to say, or
   * when the page shows no footer (the log fits on one page of six).
   */
  notHeld: string | null;
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
/**
 * POST /api/v1/sessions/:id/answer. A dispute needs a note. A confirmation may
 * carry the website's "How did it go?" stars (`rating`, 1 to 5) and its
 * "Anything to add?" note; the stars become the meeting's rating, and a dispute
 * keeps none.
 */
export type SessionAnswerRequest = { answer: StudentAnswer; note?: string; rating?: number };
/** What a write answers when it worked: the website's own sentence, and for a log, the session it made (`receipt.id`). */
export type WriteResult = { ok: true; message?: string; receipt?: { id: string; headline: string; notes: string[] } };

/**
 * `POST /api/v1/account/deletion` (ask) and `DELETE` (take it back). A platform
 * admin deletes the account by hand; `message` says within how many days.
 */
export type DeletionResult = { ok: true; message: string; requestedAt: string | null };

/** GET /api/v1/log-options: who the signed-in mentor can log a session for, and how their hours stand. */
export type LogOptions = {
  /** Today in Tashkent: the log sheet's default day, and the latest it allows. */
  today: string;
  /** In freshform's order: students with hours left first. */
  students: LogStudent[];
  /** The mentor's latest sessions, newest first, one per student and program, at most 8: the quick picks and the usual length. */
  recent: { studentProfileId: string; programId: string; minutes: number }[];
  /**
   * The website's plan item presets, which a log may name to add one to the
   * student's agenda (`LogSessionRequest.newPlanItem`): offered where the
   * student's open items don't already hold one of that name.
   */
  planPresets: string[];
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
  /**
   * A plan item to add to the student's agenda and log this against, by name:
   * a preset (`LogOptions.planPresets`) or one the mentor typed, as the
   * website's "Something else…". An open item already called that is used
   * instead. Not with `assignmentId`.
   */
  newPlanItem?: string;
  /**
   * The mentor who held it, when an admin logs it on their behalf (a User.id
   * from `GET log-mentors`). Honoured only for a reader who may change some
   * program; anyone else has it ignored and logs as themselves.
   */
  mentor?: string;
};

/** One row of To do: one of freshform's statuses, already in the reader's words. */
export type TodoRow = {
  /**
   * Unique in one answer: the status type, its subject and its program, and for
   * a session to confirm its session as well, since one mentor may have logged
   * several, so a row keeps its key from one load to the next. Rows that share
   * all of that (a student sent to one host program from two of the mentor's
   * programs) are told apart by a tail, `#2`, `#3` and on, in the list's order:
   * unique in the answer, but which of them carries which key can change
   * between loads.
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
  /**
   * The staff's STUDENT_PENDING_APPROVAL rows only: whether the reader may
   * approve them (an ADMIN grant on one of their programs). A Leader or Sales
   * grant reads, and freshform would refuse the Approve.
   */
  approve?: boolean;
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
  /** Their level in an institute, as the page's Level column; null elsewhere. */
  level: string | null;
  /** The day of the latest session with them that counts, this mentor's; null for none. */
  lastSession: string | null;
  /** Minutes lost to the use-by, on an expired grant; 0 otherwise. */
  forfeited: number;
  /** How to reach them. */
  telegram: string | null;
  email: string;
};
/** GET /api/v1/mentor/home. */
/**
 * GET /api/v1/mentor/home?program=&level=&sort=&dir=: /mentor, read through its
 * own `mentorHomeView` with its own tabs and order.
 */
export type MentorHome = {
  /**
   * The page's figures, of the students in view, following the tabs:
   * `remaining` nets overdraws, as every freshform page sums a balance;
   * `completed` counts hour-bank meetings too; `students` is the page's Your
   * students count, one a (student, program) row, the time to claim apart.
   * `expiring` counts rows with time running out. `disputed` counts their
   * sessions a student disputed that aren't voided.
   */
  summary: { remaining: number; completed: number; students: number; expiring: number; disputed: number };
  todo: TodoRow[];
  /** The page's Your students, in its order: whoever needs the mentor first (expired or over, then soonest use-by), or the order asked. */
  students: CaseloadRow[];
  /** The page's Time to claim: students whose only time here is unassigned, which any mentor of the program may claim. */
  claim: CaseloadRow[];
  /** The page's tabs: each program the mentor is paired in, and, in an institute, its levels that someone in the caseload is in. */
  tabs: { programs: ProgramRef[]; levels: { id: string; name: string }[] };
  /** What the answer is narrowed to and ordered by, as freshform read the query. */
  view: { program: string | null; level: string | null; sort: "student" | "program" | "level" | "remaining" | "deadline" | "seen" | null; dir: "asc" | "desc" | null };
  /** Whether the page draws a Program column (rows span programs) and a Level column (rows span levels). */
  columns: { program: boolean; level: boolean };
  /** Unread notifications, the bell's badge. Filled by Task F6. */
  unread: number;
  /** Of `unread`, the deadlines, which the bell's name calls out as the website's does. */
  unreadDeadlines: number;
  /** Rows freshform's 10-row cap on the To do list left out. Filled by Task F6. */
  todoSpilled: number;
};

/**
 * One mentor's hours in one program, or time there that no mentor holds: the
 * student's hour bank, or time nobody has been chosen for yet.
 */
export type StudentGrant = {
  /**
   * null for time no mentor holds: the hour bank, which every meeting draws, and
   * time nobody has been chosen for yet. `bank` says which.
   */
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
   * page finds it. Null when they have none anywhere, and, as the website's Book
   * page offers a calendar, where the mentor has no name or this is no time to
   * book on (`canBookOn`).
   */
  bookingUrl: string | null;
  /** The mentor's email where there is no calendar to book on, as the website's Book page offers "Email Dilnoza"; null otherwise. */
  mentorEmail: string | null;
};
/** GET /api/v1/student/home. */
export type StudentHome = {
  /** Minutes over every grant: given, completed and missed (together used), left, lost to expiry, and given on top of the plan. */
  hours: { allotted: number; completed: number; missed: number; used: number; remaining: number; forfeited: number; extra: number };
  /**
   * The soonest live grant to expire, with only the minutes that expire then.
   * `soon` and `daysLeft` are the page's own use-by line (`DeadlineText` in the
   * student's window): warn-coloured, with today, tomorrow or "in N days".
   */
  expiring: { minutes: number; day: string; daysLeft: number; soon: boolean } | null;
  grants: StudentGrant[];
  /**
   * freshform's "things to check" in its order, as the page draws it
   * (`withoutRepeats`): an overdue task or agenda item is left out, being in a
   * list of its own, and so is the use-by row once the balance shows the date,
   * and every mentor with no booking link is one row. A session to confirm
   * carries its id.
   */
  todo: TodoRow[];
  /** Sessions waiting for their answer. */
  toConfirm: number;
  /** The student's tasks, open by due day and then done. Filled by Task F6. */
  tasks: ApiTask[];
  /** The student's plan items, as the page lists them: in progress, then not started, then done. */
  plan: ApiPlanItem[];
  /** Nothing has happened on the account yet: the page shows How it works in place of its empty sections. */
  firstRun: boolean;
  /** The page's task rows name the program only to a student in several, and the mentor only when several are involved. */
  columns: { program: boolean; mentor: boolean };
  /** The page's Meetings: how many were held (sessions that count, and practice interviews done), and the latest three. */
  meetings: { count: number; latest: HomeMeeting[] };
  /** Unread notifications, the bell's badge. Filled by Task F6. */
  unread: number;
  /** Of `unread`, the deadlines, which the bell's name calls out as the website's does. */
  unreadDeadlines: number;
  /** Today in the program's zone, "YYYY-MM-DD". The app never takes it from the phone. */
  today: string;
};

/** One of a student's latest meetings: a session, or a practice interview that has started. */
export type HomeMeeting =
  | { kind: "session"; session: ApiSession }
  | { kind: "interview"; id: string; template: string; when: SlotTime; partner: PersonRef; phase: InterviewPhase };

/* ------------------------------------------------------------ tasks, plan, inbox --- */

/** One of a student's tasks: work a mentor set, with a due day, moved along by the student. */
export type ApiTask = {
  id: string;
  student: StudentRef;
  program: ProgramRef;
  /** Who set it. */
  mentor: PersonRef;
  title: string;
  /** The mentor's description. The student reads it too, as on the website. */
  note: string | null;
  /** "YYYY-MM-DD", Tashkent's. */
  due: string;
  /** Tashkent days from today to the due day: 0 today, negative once past. */
  daysLeft: number;
  /** freshform's TASK_OVERDUE rule: not done, and the due day has begun. */
  overdue: boolean;
  /** 0-100. */
  percent: number;
  done: boolean;
  /** ISO instant, or null. */
  completedAt: string | null;
  /** What this reader may do to it: freshform's own task rules. */
  can: { progress: boolean; edit: boolean; delete: boolean };
};
/** One plan item (the website's "agenda item"): time budgeted for a purpose, worked off by sessions. */
export type ApiPlanItem = {
  id: string;
  student: StudentRef;
  program: ProgramRef;
  /** Who delivers it; null while nobody has been chosen. */
  mentor: PersonRef | null;
  purpose: string;
  /** Minutes planned; null when it has no budget. */
  minuteLimit: number | null;
  /** Minutes logged against it, by every mentor. */
  loggedMinutes: number;
  /** "YYYY-MM-DD", or null. */
  due: string | null;
  /** Free text such as "March-May", or null. */
  dueNote: string | null;
  /** Staff's note. Always null for a student: the website shows it to staff alone. */
  note: string | null;
  progress: "NOT_STARTED" | "IN_PROGRESS" | "DONE";
  /** Progress was set by hand, and no longer follows the hours. */
  pinned: boolean;
  overdue: boolean;
  /** Tashkent days from today to the due day: 0 today, negative once past; null with no due day. */
  daysLeft: number | null;
  /**
   * The website's flags on its agenda row, in the reader's words: "Needs a
   * mentor" ("Mentor to be confirmed" to the student) and "2h over budget"
   * (never to the student).
   */
  flags: { type: string; label: string; severity: "problem" | "attention" | "neutral" | "ok" }[];
  /** `delete` is an admin's of the item's program: its own mentor can't (`deleteAssignment`). */
  can: { edit: boolean; progress: boolean; delete: boolean };
};
/** GET /api/v1/tasks/:id. `today` is the earliest due day a new value may take. */
export type TaskDetail = { task: ApiTask; today: string };
/** GET /api/v1/plan-items/:id. */
/**
 * `mentorChoices`: whom an admin of the item's program may hand it to, the
 * student page's picker (every mentor in the programs they run); empty for
 * anyone else.
 */
export type PlanItemDetail = { item: ApiPlanItem; mentorChoices: PersonRef[]; today: string };

/** POST /api/v1/tasks. */
export type TaskCreate = { studentProfileId: string; programId: string; title: string; due: string; note?: string };
/** PATCH /api/v1/tasks/:id. What is left out keeps its stored value; `note: null` clears it. */
export type TaskEdit = { title?: string; due?: string; note?: string | null };
/** POST /api/v1/tasks/:id/progress: finish it, or set a percent (which reopens a finished one). */
/**
 * POST /api/v1/tasks/:id/progress: done, a percentage, or the website's "Not
 * finished after all" (`reopen`), which puts a finished task back at 75% and
 * tells the mentor it was reopened.
 */
export type TaskProgress = { done: true } | { percent: number } | { reopen: true };
/** PATCH /api/v1/plan-items/:id. What is left out keeps its stored value; null clears it. */
export type PlanItemEdit = {
  purpose?: string;
  minuteLimit?: number | null;
  due?: string | null;
  dueNote?: string | null;
  note?: string | null;
  /**
   * Who delivers it (a User.id), or null for nobody yet. Only a reader who may
   * change the item's program may move it, and only to a mentor paired there.
   */
  mentor?: string | null;
};
/** POST /api/v1/plan-items/:id/progress. AUTO lets it follow its hours again. */
export type PlanItemProgress = { progress: "NOT_STARTED" | "IN_PROGRESS" | "DONE" | "AUTO" };

/** The reader's own share of a task a program admin gave mentors. */
export type ApiMentorTask = {
  /** The share (MentorTaskAssignee.id): what Done addresses. */
  id: string;
  taskId: string;
  program: ProgramRef;
  /** The admin who set it. */
  from: PersonRef;
  title: string;
  note: string | null;
  due: string;
  daysLeft: number;
  /** The website's mentor-task rule: overdue from the day after the due day. */
  overdue: boolean;
  done: boolean;
  completedAt: string | null;
  /** The students it is about. */
  about: StudentRef[];
};
/** GET /api/v1/mentor-tasks: open ones by due day, then those done in the last 14 days. */
export type MentorTasks = { items: ApiMentorTask[]; today: string };
/** POST /api/v1/mentor-tasks/:id/done. */
export type MentorTaskDone = { done: boolean };

/** One notification. */
export type InboxItem = {
  id: string;
  type: string;
  /** HOURS, SESSIONS, TASKS, DEADLINES or ACCOUNTS; older rows may carry others. */
  category: string;
  /** The website's label for the type ("Session logged"), or "Update" for one it doesn't know. */
  title: string;
  /** The sentence written when it happened. */
  message: string;
  /** A website path with old shapes already rewritten (`neutralHref`), or null. The app maps it to a screen. */
  href: string | null;
  actor: PersonRef | null;
  read: boolean;
  /** ISO instant. */
  at: string;
};
/** A notification category and how many: HOURS, SESSIONS, TASKS, DEADLINES or ACCOUNTS, with the website's label. */
export type InboxCategoryCount = { category: string; label: string; count: number };
/**
 * GET /api/v1/inbox. `unread` counts the whole feed; `unreadBy` is what it is
 * made of, as the website's bell panel lists it: deadlines first, then the
 * largest. `categories` are the website's filter chips: each category the
 * reader has anything in, over the whole feed, in the website's order.
 */
export type InboxPage = {
  items: InboxItem[];
  nextCursor: string | null;
  unread: number;
  unreadBy: InboxCategoryCount[];
  categories: InboxCategoryCount[];
};
/**
 * `limit` is 1 to 100, 25 when left out; any other value is a 400 on field
 * `limit`, as a bad `cursor` is on `cursor`. `category` narrows the feed to
 * one of the five; another is a 400 on `category`.
 */
export type InboxQuery = { cursor?: string; limit?: string; category?: string };
/** POST /api/v1/statuses/dismiss and /restore: a To do row, by `TodoRow.type` and `TodoRow.subject?.id ?? ""`. */
export type StatusKey = { type: string; subjectId: string };

/** GET /api/v1/students/:id/work: one student's tasks and plan items, as the website shows them to this reader. */
export type StudentWork = {
  student: StudentRef;
  /** Open by due day, then done. */
  tasks: ApiTask[];
  /** Not done in the website's order, then done. */
  plan: ApiPlanItem[];
  /** Programs this reader may set this student a task in. Empty: no Add. */
  canSetTaskIn: ProgramRef[];
  /**
   * How many of each there are: the student page's board sends at most 60 of
   * either, as the website's does, and says how many there are in all.
   */
  taskCount: number;
  planCount: number;
  today: string;
};

/* ------------------------------------------------------------------- admin --- */

/*
 * A program admin's half of the app. Every answer carries `can` flags built
 * from the reader's write scope: `MeResponse.roles` lists "admin" for a Leader
 * or Sales grant, which reads and changes nothing, so the app shows a control
 * only where a flag says so.
 *
 * None of the writes below answers an id (`WriteResult` has none for them): the
 * app reads the list again to find what it made.
 */

/** One program as the admin's lists show it. Minutes, over that program's own figures for each student. */
export type ProgramRow = {
  program: ProgramRef;
  archived: boolean;
  students: number;
  /** Mentors paired with it, each counted once. */
  mentors: number;
  allotted: number;
  /** Charged minutes: delivered and no-shows. */
  used: number;
  /** Lost when a use-by passed. */
  forfeited: number;
  /** Negative when its students are overdrawn. */
  remaining: number;
  /** Students in it nobody has approved; and with time that runs out within the staff's window (the roster's `time=expiring`). */
  pending: number;
  expiring: number;
  /** `remaining` and `forfeited` as the Programs page says them, rounded ("130+ hours"); `forfeited` null at 0. */
  rough: { remaining: string; forfeited: string | null };
  can: { write: boolean };
};

/** GET /api/v1/mentor/programs: a mentor's programs, as the website's /programs lists them for a mentor. */
export type MentorProgramRow = {
  id: string;
  name: string;
  colorIndex: number;
  /** The cohort their first pairing there names, if any. */
  cohort: string | null;
  /** Their students there, each once. */
  students: number;
  completed: number;
  /** Negative when overdrawn; an expired grant counts only what it is over. */
  remaining: number;
};

/** GET /api/v1/admin/home: what /admin shows. 404 to a reader with no program to read. */
export type AdminHome = {
  /**
   * Over every student in the reader's programs. `pending` counts those nobody
   * has approved; `expiring`, those with time that runs out within 14 days.
   */
  summary: { remaining: number; students: number; programs: number; pending: number; expiring: number };
  /** Every program the reader reads, by name, archived ones among them, as /admin lists them. */
  programs: ProgramRow[];
  /** The staff's list, in its order. No row carries `log`: an admin's answer to time running out is a grant. */
  todo: TodoRow[];
  todoSpilled: number;
  unread: number;
  /** Of `unread`, the deadlines, which the bell's name calls out as the website's does. */
  unreadDeadlines: number;
  platformAdmin: boolean;
  today: string;
  /** The page's freshness stamp, "Oct 29, 14:05": when this answer was read, in Tashkent. */
  updated: string;
  /**
   * Staff with no program granted: /admin's STAFF_UNSCOPED, in its words, and
   * nothing else in the answer. Null for everyone else.
   */
  unscoped: { label: string; explanation: string } | null;
};

/** GET /api/v1/students: the query, every field optional. */
export type RosterQuery = {
  /** A name or an email. */
  q?: string;
  program?: string;
  /** Inside `program`. */
  level?: string;
  /** Inside `program`. */
  cohort?: string;
  /** `pending`: nobody has approved them. `not-signed-in`: approved, with no Telegram yet. */
  status?: "pending" | "not-signed-in";
  /** No time at all, time that runs out within 14 days, or time lost to a use-by. */
  time?: "none" | "expiring" | "expired";
  /** The roster's column headers, as /students sorts them. */
  sort?: "student" | "completed" | "remaining" | "deadline" | "seen";
  /** Left out, ascending. The website's first click on Completed, Remaining and Last session is descending. */
  dir?: "asc" | "desc";
  /** 1-based. */
  page?: number;
};
/** One student on the admin's roster, over the programs the reader reads. */
export type RosterRow = {
  student: StudentRef;
  approved: boolean;
  /** They have a Telegram handle: the website's "not signed in" chip is its absence. */
  signedIn: boolean;
  /** Their own programs first, then visits. */
  programs: ProgramRef[];
  completed: number;
  remaining: number;
  used: number;
  forfeited: number;
  /** The soonest time to run out, with only the minutes that run out then. */
  expiring: { minutes: number; day: string; daysLeft: number } | null;
  /** The day of the latest session, or null. */
  lastSession: string | null;
  /** False for a student in no program, whom only a platform admin is shown and nobody can open. */
  openable: boolean;
  /** Some of their programs are a visit from another program: the website's "(on exchange)". */
  onExchange: boolean;
  /** Their Telegram handle and folder link, the row's two icons on the website. */
  telegram: string | null;
  folderUrl: string | null;
};
/** 25 rows a page. `shown` counts every row the filter matches, on every page. `programs` is the program menu. */
export type RosterPage = { rows: RosterRow[]; page: number; pages: number; shown: number; programs: ProgramRef[]; today: string };

/*
 * GET /api/v1/programs/:id/students answers a RosterPage too: the program page's
 * own roster (`q`, `level`, `cohort`, `status`, `time`, `sort`, `page` of
 * RosterQuery), with each student's figures in THIS program. GET /api/v1/students
 * sums them over every program the reader reads, as /students does.
 */

/**
 * GET /api/v1/students/:id/admin: one student as an admin of one of their
 * programs reads them. GET /api/v1/students/:id/record answers the same for
 * anyone the website's student page lets in, a mentor who reaches them too
 * (`?as=mentor` reads it in the mentor's lens).
 */
export type AdminStudent = {
  student: StudentRef & {
    email: string;
    telegram: string | null;
    folderUrl: string | null;
    /** The day the record was made; null to a mentor who doesn't run one of their programs, as the page's Details are staff's. */
    registered: string | null;
  };
  approved: boolean;
  /** The reader's programs among theirs. `visit` is a placement from another program. */
  programs: (ProgramRef & { level: string | null; cohort: string | null; visit: boolean })[];
  hours: {
    allotted: number;
    completed: number;
    missed: number;
    remaining: number;
    forfeited: number;
    expiring: { minutes: number; day: string; daysLeft: number } | null;
  };
  /** The website's "Time by mentor", one row per grant. */
  grants: AdminGrant[];
  /** The last 20 changes to their time, newest first. Staff only. */
  history: GrantChange[];
  /** Whose words: an admin of one of their programs reads as staff, a mentor who reaches them as a mentor. */
  lens: "staff" | "mentor";
  /**
   * The page's first line under the name: a mentor's own time with them ("8h
   * remaining with you", "use by Oct 17"), or the student's whole balance with
   * the soonest use-by ("4h 15m to use by Nov 20"). null when there is none to say.
   */
  headline: { figure: string; rest: string | null; danger: boolean } | null;
  /**
   * Log a session: `can` is reach and approval, as the page's button; `reason`
   * the page's sentence about it (not approved yet, no time with you, expired,
   * overdrawn), a warning when `warns`.
   */
  log: { can: boolean; reason: string | null; warns: boolean };
  /** Progress per program, when the student is in more than one the reader reads. `name` says "(on exchange)" for a visit. */
  byProgram: { program: ProgramRef; name: string; allotted: number; completed: number; remaining: number }[];
  /** What was paid over every grant, where a program bills per student and the reader is staff; null elsewhere. */
  paid: number | null;
  /**
   * `approve` and `reject`: they are waiting and the reader may change one of
   * their programs. `allocate`: the reader may grant them time. `reach`: the
   * reader mentors them.
   */
  can: { approve: boolean; reject: boolean; allocate: boolean; reach: boolean; rename: boolean };
  /**
   * The page's Details changes, for a reader who may change one of their
   * programs (null otherwise): each of their enrolments the reader reads, to
   * move or take off; the programs they may be enrolled in or moved to
   * (archived ones too, so a move shows where they are); and whether any
   * session that counts stands in the way of deleting them.
   */
  manage: {
    enrollments: { id: string; program: ProgramRef; levelId: string | null; cohortId: string | null; label: string }[];
    choices: ProgramChoice[];
    hasSessions: boolean;
  } | null;
  /** The page's Exchange: the placements the reader may see (`visibleExchanges`), both directions, newest first. */
  exchanges: ApiExchange[];
  /** The Full Support application; null where the reader may not read one, or the student's programs track none. */
  application: ApiApplication | null;
  /**
   * Send on exchange, for a reader who may lend them (an admin of one of their
   * own programs, or a mentor who works in it); null otherwise. `from`: those
   * programs, never a visit; `to`: every running program they aren't in.
   */
  lend: { from: { id: string; label: string }[]; to: { id: string; name: string }[] } | null;
  today: string;
};
/**
 * PATCH /api/v1/students/:id: one of a student's details a request, each the
 * website's own action (the name `setStudentName`, which a mentor who reaches
 * them may use too; the email, Telegram handle and folder link, an admin of
 * one of their programs). An empty folder clears it. Answers WriteResult.
 * DELETE /api/v1/students/:id is `deleteStudent`, refused once a session that
 * counts was logged for them.
 */
export type StudentDetailsEdit = { name: string } | { email: string } | { telegram: string } | { folder: string };
/**
 * Where a student is enrolled: a program, and its level or cohort where it has
 * them. POST /api/v1/students/:id/enrollments adds one (`enrollStudent`);
 * PATCH /api/v1/enrollments/:id moves one (`moveStudent`); DELETE
 * /api/v1/enrollments/:id takes them off one (`unenrollStudent`).
 */
export type EnrollmentTarget = { program: string; level?: string; cohort?: string };
/** POST /api/v1/programs/:id/tasks: the same task for every student in the program (`setProgramTask`). */
export type ProgramTask = { title: string; due: string; note?: string };
/* DELETE /api/v1/sessions/:id is `deleteSession`: an admin's, which takes the hours back too. */
/**
 * One exchange, a student lent from one program to another for a capped time,
 * as the website's exchange list shows it. Minutes throughout; `useBy` a
 * Tashkent day. `completed` leaves no-shows out (`missed` says them);
 * `remaining` is allocated and not yet spent or lost. `holders` name who holds
 * the allocated minutes ("nobody yet" for none). `sessions` counts those
 * logged under it: one is enough for Call it off to be refused.
 * `canReturn`: the reader is party to it and it is open.
 *
 * POST /api/v1/students/:id/exchanges sends one (`ExchangeSend`,
 * `sendOnExchange`); POST /api/v1/exchanges/:id/return calls one off
 * (`ExchangeReturn`, `returnExchange`). Each answers WriteResult.
 */
export type ApiExchange = {
  id: string;
  /** Named on a program's list, which spans people; null on the student's own page. */
  student: StudentRef | null;
  from: ProgramRef;
  to: ProgramRef;
  open: boolean;
  cap: number;
  useBy: string;
  ranOut: boolean;
  allocated: number;
  unallocated: number;
  holders: string[];
  completed: number;
  missed: number;
  remaining: number;
  forfeited: number;
  extra: number;
  sentBy: string;
  note: string | null;
  returnedBy: string | null;
  returnNote: string | null;
  sessions: number;
  canReturn: boolean;
};
/**
 * `GET /api/v1/classes?month=YYYY-MM`: the website's Classes page, for the
 * programs that schedule classes the reader works in (anybody else a 404):
 * the month (this one when none is asked), each student's hours in it
 * (`booked` still to come, `held` delivered, `total` both, minutes), and its
 * diary, oldest first, with what the reader may do with each class. `book`:
 * the reader mentors, so books classes (`targets`: whom, each with the
 * program and the unreserved time they hold with them, as the website's
 * picker says it). Days and times are Tashkent's.
 *
 *   POST /api/v1/classes               ClassBooking (scheduleClass)
 *   POST /api/v1/classes/:id/cancel    (cancelClass): the minutes it reserved go back
 *   POST /api/v1/classes/:id/held      (markClassHeld): tied to the session logged for that student and day
 */
export type ApiClasses = {
  month: string;
  label: string;
  thisMonth: string;
  prev: { month: string; label: string };
  next: { month: string; label: string };
  /** The reader administers a program here: the page's subtitle names every class in their programs. */
  staff: boolean;
  book: boolean;
  students: { student: { id: string; name: string }; classes: number; booked: number; held: number; total: number }[];
  total: number;
  diary: {
    id: string;
    student: { id: string; name: string };
    program: { id: string; name: string };
    /** Another mentor's class; null for the reader's own. */
    mentor: PersonRef | null;
    day: string;
    time: string;
    minutes: number;
    topic: string | null;
    status: "SCHEDULED" | "HELD" | "CANCELLED";
    /** It has started (Tashkent's clock): Log session and Mark held are offered then, on the reader's own. */
    started: boolean;
    can: { cancel: boolean; held: boolean };
  }[];
  targets: { student: string; program: string; name: string; hint: string }[];
  today: string;
};
/** Book a class: a student and the program they hold time with you in, a Tashkent day and "HH:MM", 5 to 480 minutes, a topic if you like. */
export type ClassBooking = { student: string; program: string; day: string; time: string; minutes: number; topic?: string };
/** A supplemental essay's stage, or the motivational essay's: Brainstorming, Writing, Finalizing, Done; null not started. */
export type EssayStage = "BRAINSTORMING" | "WRITING" | "FINALIZING" | "DONE";
/** The round of a student's primary choice: Early Decision, Restrictive Early Action, Early Action. */
export type ApplicationRound = "ED" | "REA" | "EA";
/**
 * The Full Support application, as the student page's Application shows it,
 * for a student in a program that tracks admissions, to its admins and the
 * mentors who work with the student there (`applicationAccess`). `editable`:
 * the reader may change it; `canCorrectWords`: they administer a program that
 * tracks admissions, so may correct a university's word count for everybody;
 * `known`: the shared list of universities to pick from, for an editor.
 * Universities come primary first, then in the order they were added.
 *
 * Its writes, each the website's action, each answering WriteResult:
 *   PUT    /api/v1/students/:id/application                 ApplicationSnapshot (saveApplicationSnapshot)
 *   POST   /api/v1/students/:id/application/essays          EssayStageChange (setEssayStage)
 *   POST   /api/v1/students/:id/universities                UniversityAdd (addStudentUniversity)
 *   PATCH  /api/v1/students/:id/universities/:rowId         PrimaryChoice (setPrimaryUniversity)
 *   DELETE /api/v1/students/:id/universities/:rowId         (removeStudentUniversity)
 *   PATCH  /api/v1/universities/:id                         WordsCorrection (correctUniversityWords)
 */
export type ApiApplication = {
  sat: number | null;
  ielts: number | null;
  school: string | null;
  gpa: string | null;
  essayStage: EssayStage | null;
  universities: {
    id: string;
    university: { id: string; name: string; words: number };
    primary: boolean;
    round: ApplicationRound | null;
    stage: EssayStage | null;
  }[];
  editable: boolean;
  canCorrectWords: boolean;
  known: { id: string; name: string; words: number }[];
};
/** All four together, as the website saves them; an empty one clears it. The action reads and checks each. */
export type ApplicationSnapshot = { sat: string; ielts: string; school: string; gpa: string };
/** `target`: "essay" for the motivational essay, or a university row's id for its supplemental. */
export type EssayStageChange = { target: string; stage: EssayStage };
/** One already on the shared list (`university`), or a new one (`name` and its supplemental `words`). */
export type UniversityAdd = ({ university: string } | { name: string; words: number }) & { primary?: boolean; round?: ApplicationRound };
/** Make a row the primary choice, with its round (or none). */
export type PrimaryChoice = { round: ApplicationRound | null };
/** A university's supplemental word count, for every student who lists it. */
export type WordsCorrection = { words: number };
/** Send a student on exchange: from one of their own programs, to one they aren't in, for `minutes` until `useBy`. */
export type ExchangeSend = { from: string; to: string; minutes: number; useBy: string; note?: string };
/** Call an exchange off, with a word to both programs if you like. */
export type ExchangeReturn = { note?: string };
/** One row of "Time by mentor": a mentor's grant, the hour bank, or time nobody has been chosen for yet. */
export type AdminGrant = {
  program: ProgramRef;
  /** null with `bank` false is the unassigned pool; with `bank` true it is the hour bank. */
  mentor: PersonRef | null;
  bank: boolean;
  allocated: number;
  /** The website's Assigned: the grant, or the open plan items' budgets for it when they come to more. */
  assigned: number;
  completed: number;
  missed: number;
  remaining: number;
  /** Lost when its use-by passed. */
  forfeited: number;
  /** null on a row with planned work and no grant. */
  deadline: string | null;
  daysLeft: number | null;
  expired: boolean;
  /** What was paid, in the program's currency, where the program tracks payment; null elsewhere. */
  amountPaid: number | null;
  can: { edit: boolean; transfer: boolean; remove: boolean };
};
/** One change to a student's time: who set which grant from what to what. */
export type GrantChange = {
  /** ISO instant. */
  at: string;
  program: ProgramRef;
  mentor: PersonRef | null;
  bank: boolean;
  from: number;
  to: number;
  by: PersonRef | null;
};

/**
 * GET /api/v1/programs/:id/allocate: the website's program Allocate time, its
 * roster picker. Students in its order and groups (Has time, All time used,
 * Overdrawn or expired), each with what they hold in this program; `warning`
 * is what the page says under the picker of one overdrawn or with time that
 * expired (`lead` bold). Picking one opens their grant sheet in this program.
 */
export type AllocatePicker = {
  program: ProgramRef;
  rows: {
    student: StudentRef;
    hint: string;
    group: "Has time" | "All time used" | "Overdrawn or expired";
    tone: "danger" | "warn" | null;
    warning: { lead: string; rest: string } | null;
  }[];
};

/** GET /api/v1/students/:id/grant-options: what the grant sheet offers. */
export type GrantOptions = {
  /** The student's programs the reader may change. */
  programs: (ProgramRef & {
    /** A grant here must say what was paid. */
    tracksPayment: boolean;
    /** The program has an hour bank and the reader may grant into it. */
    bankAllowed: boolean;
    /** The student's bank here, if they hold one: a grant to a mentor is a share of it. */
    bank: { left: number; deadline: string } | null;
    /** A first bank here takes in hours given before it: the sheet asks whether. */
    askPast: boolean;
    /** What the program gives on joining. */
    standard: { minutes: number; days: number } | null;
  })[];
  /** Mentors of those programs, with the programs each works in. */
  mentors: { mentor: PersonRef; programIds: string[] }[];
  /** Open plan items, which a grant's hours may be for. `mentorId` null is nobody's yet. */
  openPlan: { id: string; programId: string; mentorId: string | null; purpose: string; logged: number; limit: number | null }[];
  today: string;
};
/** POST /api/v1/students/:id/grants: give time, or set a grant to a total. */
export type GrantRequest = {
  program: string;
  /** null is the unassigned pool, or the hour bank with `bank`. */
  mentor: string | null;
  bank?: boolean;
  /** `add` adds to what they hold; `set` replaces it. */
  mode: "add" | "set";
  minutes: number;
  /** "YYYY-MM-DD". */
  deadline: string;
  /** Required where the program tracks payment. */
  amountPaid?: number;
  /** What the hours are for: a new plan item, or an open one. */
  task?: { purpose: string; note?: string } | { planItem: string };
  /** Required when `GrantOptions` says `askPast`. */
  includePrevious?: boolean;
};
/** POST /api/v1/students/:id/grants/transfer: unused minutes from one mentor (null: the pool) to another. */
export type GrantTransfer = { program: string; from: string | null; to: string; minutes: number; moveTasks: boolean };
/** POST /api/v1/students/:id/grants/remove. */
export type GrantRemove = { program: string; mentor: string | null; bank?: boolean };
/* POST /api/v1/students/:id/approve and /reject take no body and answer a WriteResult. */

/* GET /api/v1/programs answers ProgramRow[], in the home's order. */
/** GET /api/v1/programs/:id: one program, its settings and who works in it. */
export type ProgramDetail = {
  program: ProgramRef & {
    archived: boolean;
    tracksPayment: boolean;
    hourBank: boolean;
    classHours: boolean;
    tracksAdmissions: boolean;
    schedulesClasses: boolean;
    /** What a student gets on joining; null for nothing. */
    standard: { minutes: number; days: number } | null;
    /**
     * Shown as its own institute to the people who work only in it, with the
     * name it goes by there (null: the program's own); null when it is shown
     * as a program. Only a platform admin changes it.
     */
    institute: { name: string | null } | null;
  };
  totals: { students: number; allotted: number; completed: number; missed: number; remaining: number; forfeited: number };
  levels: {
    id: string;
    name: string;
    /** null takes the program's. */
    standard: { minutes: number; days: number } | null;
    students: number;
    mentors: number;
    cohorts: Cohort[];
    /** Nobody is in it and nothing is under it. */
    canDelete: boolean;
  }[];
  /** A program with no levels keeps its cohorts here. */
  cohorts: Cohort[];
  /** Each pairing, which is what Remove addresses. `scope` is the program, a level or a cohort, in words. */
  mentors: { pairingId: string; mentor: PersonRef; scope: string; students: number }[];
  admins: { person: PersonRef; level: "admin" | "leader" | "sales" }[];
  /**
   * Everyone who works here, as the page's Mentors rail lists them: one row a
   * person, the pairings first in the order they were made, then the admins who
   * teach nothing (`teaches` false). `admin`: they hold an ADMIN grant here.
   * Its length is the page's Mentors count.
   */
  people: { person: PersonRef; teaches: boolean; admin: boolean }[];
  /** The page's Recent sessions: the latest six that count, newest first. */
  recent: ApiSession[];
  /** The page's Exchange: the open placements it took in or lent out, each naming the student. */
  exchanges: ApiExchange[];
  /** Mentors who may be assigned here: the website's list, without those paired here already. */
  eligibleMentors: (PersonRef & { email: string })[];
  /**
   * `platform`: the reader runs the platform, which turning admissions or
   * scheduled classes on asks for. `delete`: a platform admin, and nothing
   * stands in the way; otherwise `deleteBlocked` says what does, or is null.
   */
  can: { write: boolean; platform: boolean; delete: boolean; deleteBlocked: string | null };
  today: string;
};
export type Cohort = { id: string; name: string; inUse: boolean };
/** PATCH /api/v1/programs/:id: exactly one field per request. */
export type ProgramEdit =
  | { name: string }
  | { tracksPayment: boolean }
  | { hourBank: boolean }
  | { classHours: boolean }
  | { tracksAdmissions: boolean }
  | { schedulesClasses: boolean }
  | { standard: { minutes: number; days: number } | null }
  | { archived: boolean }
  /**
   * `setProgramSpace`, a platform admin's: shown as an institute, or null, as
   * a program. A blank name is the program's own; no name keeps the one it
   * had, which turning it into a program kept for next time.
   */
  | { institute: { name?: string } | null };
/*
 * POST /api/v1/programs {name}: a platform admin's. DELETE /api/v1/programs/:id.
 * POST /api/v1/programs/:id/levels {name}; PATCH /api/v1/levels/:id {standard}; DELETE /api/v1/levels/:id.
 * POST /api/v1/programs/:id/cohorts {name, level?}; DELETE /api/v1/cohorts/:id.
 */
/** GET /api/v1/programs/options answers these: the running programs the reader may change, for Add students and Register a mentor. */
export type ProgramOption = ProgramRef & {
  /** Its students are class groups, added on the website. */
  classHours: boolean;
  levels: { id: string; name: string; cohorts: { id: string; name: string }[] }[];
  /** A program with no levels keeps its cohorts here. */
  cohorts: { id: string; name: string }[];
};

/** POST /api/v1/mentors: a new mentor, and where they work. */
export type MentorRegistration = {
  firstName: string;
  lastName: string;
  email: string;
  /** At least one. */
  targets: ({ program: string } | { level: string } | { cohort: string })[];
};
/**
 * POST /api/v1/mentors with `mentors`: the website's "several at once", each
 * row an email and a name, all into the same programs. A row it can't take (a
 * bad address, one name, somebody already here) is skipped and named in the
 * message; when every row is skipped it is a refusal. At most 200.
 */
export type MentorBatchRegistration = {
  mentors: { firstName: string; lastName: string; email: string }[];
  targets: MentorRegistration["targets"];
};
/**
 * GET /api/v1/mentors/:id/edit: the website's Edit fold on a mentor's page, for
 * an admin who may change them. Their name and email (`canEditDetails`: only a
 * platform admin may change either), where they work in the reader's programs,
 * and those programs to pick from. Anybody else is a 404.
 */
export type MentorEdit = {
  name: string;
  email: string;
  canEditDetails: boolean;
  targets: MentorRegistration["targets"];
  programs: ProgramOption[];
};
/**
 * PATCH /api/v1/mentors/:id, through the website's `updateMentor`: what is left
 * out stays as it is. `targets` is their whole set in the reader's programs
 * (none parks them unassigned there); a pairing elsewhere is kept.
 */
export type MentorEditRequest = { name?: string; email?: string; targets?: MentorRegistration["targets"] };
/**
 * GET /api/v1/mentors/:id/card: a mentor, as the website's mentor page shows
 * them to somebody who doesn't manage them. To a student: the pairings that
 * reach them, with Book (`bookingUrl`) only where they still hold time to book
 * on there, else the email. To another mentor: the pairings in the programs
 * they share, with Book or the email. A 404 when none reaches the reader.
 */
export type MentorCard = {
  mentor: PersonRef & { email: string };
  pairings: { id: string; program: ProgramRef; label: string; bookingUrl: string | null }[];
};
/* POST /api/v1/programs/:id/mentors {mentor, level?, cohort?}; DELETE /api/v1/programs/:id/mentors/:pairingId. */

/** GET /api/v1/programs/:id/mentor-tasks: open first by due day, then done. */
export type ProgramMentorTasks = {
  items: ProgramMentorTask[];
  /** Who a task may be given to: the program's mentors. */
  team: PersonRef[];
  /** Who a task may be about: the program's students. */
  students: StudentRef[];
  can: { write: boolean };
  today: string;
};
/** A task an admin gave the program's mentors. */
export type ProgramMentorTask = {
  id: string;
  title: string;
  note: string | null;
  due: string;
  daysLeft: number;
  /** The website's mentor-task rule: from the day after the due day, while not everyone is done. */
  overdue: boolean;
  createdBy: PersonRef;
  assignees: { shareId: string; mentor: PersonRef; done: boolean }[];
  about: StudentRef[];
  /** Every assignee is done. */
  done: boolean;
};
/** POST /api/v1/programs/:id/mentor-tasks. `mentors` and `about` are ids from `team` and `students`. */
export type MentorTaskCreate = { title: string; due: string; note?: string; mentors: string[]; about?: string[] };
/* DELETE /api/v1/programs/:id/mentor-tasks/:taskId. */

/** POST /api/v1/programs/:id/students: one request for every row. */
export type AddStudents = {
  /** Required where the program has levels. */
  level?: string;
  /** Required where the level, or a program with no levels, has cohorts. */
  cohort?: string;
  /**
   * 1 to 1,000. As the website's form: a row with an empty name or an address
   * that isn't one is skipped and named in the answer's message, and the rest
   * are added.
   */
  rows: { email: string; firstName: string; lastName: string; folderUrl?: string }[];
};

/*
 * Logging on someone's behalf:
 *   GET /api/v1/log-mentors?program= answers PersonRef[]: the mentors of the programs the reader may change.
 *   GET /api/v1/log-options?mentor=<id> answers that mentor's LogOptions, narrowed to those programs.
 *   LogSessionRequest.mentor names them.
 */

/*
 * Practice interviews: students interviewing each other (Phase 5).
 *
 * Every route but `students/:id/interviews` is an approved student's own. An
 * interview they are not in, a time that is not theirs, a classmate who is not
 * one and a row that does not exist all answer the same 404.
 */

/**
 * A practice time on freshform's clock. Show `day` and `time`, which are
 * Tashkent's; compare `startsAt` and `endsAt`, which are real instants, with
 * the clock.
 */
export type SlotTime = { day: string; time: string; minutes: number; startsAt: string; endsAt: string };

/** One of the kinds of interview to practise, which freshform fixes. */
export type InterviewTemplateRef = { id: string; name: string; summary: string };

/** "booked" until it starts, "to-mark" once it has, then one of the two outcomes. */
export type InterviewPhase = "booked" | "to-mark" | "completed" | "absent";

/** One of my practice interviews, in a list. `partner` is a User. */
export type InterviewRow = {
  id: string;
  template: { id: string; name: string };
  when: SlotTime;
  partner: PersonRef;
  /** They booked my time. */
  hosting: boolean;
  phase: InterviewPhase;
  /** I have sent my feedback. */
  sent: boolean;
};

/** A time I offer. `interview` once a classmate has booked it. */
export type OfferedSlot = {
  id: string;
  when: SlotTime;
  meetingUrl: string | null;
  interview: { id: string; guest: PersonRef } | null;
};

/**
 * Somebody to practise with, as the Interviews home lists them: to a student,
 * another approved student (any program) or one of their mentors offering a
 * time; to a mentor, a student they have worked with. `id` is their user id,
 * the id of their people page. `open`: their open times the reader may book.
 */
export type ClassmateRow = {
  id: string;
  person: PersonRef;
  /** Their own programs, by name: never one they are only visiting. Empty for a mentor. */
  programs: string[];
  open: number;
};

/** A To do row for practice, decided on freshform's clock. */
export type PracticeTodo = {
  interview: string;
  /** "University admissions · Aziz" */
  title: string;
  when: SlotTime;
  /** join: starts within a day, until it ends. mark: it has started. feedback: done, and mine is not sent. */
  need: "join" | "mark" | "feedback";
  /** Only for "join". */
  meetingUrl: string | null;
};

/** The Practice tab: GET /api/v1/interviews */
export type PracticeHome = {
  /** The capacity this is read in (`?as=`): a student's Practice, or a mentor's Interviews. */
  as: "student" | "mentor";
  /** Neither completed nor absent; soonest first. */
  coming: InterviewRow[];
  /** Completed or absent; newest first. */
  done: InterviewRow[];
  /** Mine, still to come; soonest first. */
  times: OfferedSlot[];
  /** Classmates (to a student) or Your students (to a mentor): those offering a time first, then the rest; each by name. */
  classmates: ClassmateRow[];
  /** To a student: Your mentors, the mentors who have worked with them offering a time. Empty to a mentor. */
  mentors: ClassmateRow[];
  /** A student's To do rows for practice; none for a mentor. */
  todo: PracticeTodo[];
  /**
   * What a new time may be: a day from `today` to `lastDay`, `lengths` minutes
   * long. The website's form opens on `day` (tomorrow) at `time` ("15:00").
   */
  offer: { today: string; day: string; time: string; lastDay: string; lengths: number[] };
  /** "Tashkent": the clock `day` and `time` are on. */
  zone: string;
};

/** POST /api/v1/interviews/slots. `day` and `time` on the Tashkent clock. */
/** A time to offer, in the capacity it is offered in: a mentor's are for their students. */
export type OfferSlot = { day: string; time: string; minutes: number; meetingUrl?: string; as?: "student" | "mentor" };
/* DELETE /api/v1/interviews/slots/:id: a time nobody has booked. */

/** A classmate's page: GET /api/v1/classmates/:id */
/**
 * GET /api/v1/classmates/:id?as=: somebody to practise with, as their people
 * page shows them (`id` their user id): a classmate's student times, a
 * mentor's times for their students (`mentor`: "Your mentor"), or, to a
 * mentor, a student's times for the mentors who work with them.
 */
export type Classmate = {
  id: string;
  person: PersonRef;
  /** One of the reader's mentors, offering times as one. */
  mentor: boolean;
  /** Their own programs, by name (none for a mentor). Named `shared` from when only classmates who shared a program were listed. */
  shared: string[];
  /** Open and still to come. No meeting link: that is for whoever books it. */
  slots: { id: string; when: SlotTime }[];
  templates: InterviewTemplateRef[];
};

/** POST /api/v1/interviews: book a time, in the capacity the reader books in (a mentor books a student's time as one). */
export type BookInterview = { slot: string; template: string; as?: "student" | "mentor" };
/** The interview the booking made. */
export type BookResult = WriteResult & { id: string };

/** Feedback's three boxes. */
export type FeedbackText = { summary: string; wentWell: string; toImprove: string };

/** One answer of mine. `question` is its wording when I answered. */
export type InterviewAnswerRow = { index: number; question: string; text: string };

/** One of my interviews: GET /api/v1/interviews/:id */
export type ApiInterview = Omit<InterviewRow, "template"> & {
  /** Only to the two students in it. */
  meetingUrl: string | null;
  template: InterviewTemplateRef & { questions: string[] };
  /** Only mine. */
  answers: InterviewAnswerRow[];
  /** Mine; the partner never reads them. */
  notes: string;
  mine: (FeedbackText & { sent: boolean }) | null;
  /** The partner's, once sent. */
  theirs: FeedbackText | null;
  /** Who was marked absent, when `phase` is "absent". */
  absent: "me" | "partner" | null;
  /** The day it was marked done. */
  completedOn: string | null;
  /** "15:45" Tashkent: while sent feedback can still be changed, until when. */
  editableUntil: string | null;
  /**
   * `feedback`: whether the reader writes feedback at all. Between two students
   * both do; with a mentor, the mentor does and the student they interview
   * doesn't (`givesFeedback`), so the guide has no feedback step for them.
   */
  can: { cancel: boolean; done: boolean; absent: boolean; guide: boolean; notes: boolean; editFeedback: boolean; feedback: boolean; answer: boolean };
  /**
   * The reader's part: a "peer" between two students, the mentor's
   * "interviewer", or the "interviewee" a mentor interviews.
   */
  part: "peer" | "interviewer" | "interviewee";
  /**
   * What the website's interview page shows: the questions until there are
   * answers or the reader's feedback is sent; the reader's own sent feedback
   * only while it may still be corrected; the partner's once the interview is
   * done or the reader's own is sent, where the partner gives feedback.
   */
  show: { questions: boolean; mine: boolean; theirs: boolean };
  /** The guide's fixed words, the school's own. */
  guide: {
    intro: string;
    rubric: { name: string; questions: string[] }[];
    turns: string;
    prompts: FeedbackText;
    discuss: string;
  };
};

/*
 * One interview's writes, each answering WriteResult:
 *   POST /api/v1/interviews/:id/cancel, /done, /absent
 *   PUT  /api/v1/interviews/:id/notes            InterviewNotes
 *   PUT  /api/v1/interviews/:id/answers/:index   InterviewAnswerText
 *   PUT  /api/v1/interviews/:id/feedback         FeedbackText, a draft
 *   POST /api/v1/interviews/:id/feedback/submit  FeedbackText, sent
 *   PATCH /api/v1/interviews/:id/feedback        FeedbackText, a correction while `can.editFeedback`
 */
export type InterviewNotes = { notes: string };
export type InterviewAnswerText = { text: string };

/** One of a student's practice interviews, for a mentor who has worked with them. */
export type StudentInterviewRow = {
  id: string;
  template: { id: string; name: string };
  when: SlotTime;
  partner: PersonRef;
  phase: InterviewPhase;
  completedOn: string | null;
  /** The student's own. */
  notes: string;
  answers: InterviewAnswerRow[];
  /** Sent by the student. */
  given: FeedbackText | null;
  /** Sent to the student. */
  received: FeedbackText | null;
};
/** GET /api/v1/students/:id/interviews */
export type StudentInterviews = { student: StudentRef; interviews: StudentInterviewRow[] };

/*
 * Phase 6: Account and sign-up.
 */

/** A kind of notice, as Settings names them (NOTIFICATION_CATEGORY). */
export type NoticeCategory = "HOURS" | "SESSIONS" | "TASKS" | "DEADLINES" | "ACCOUNTS";

/**
 * One category's two switches, with the label and hint Settings shows. No row
 * stored is the default: in the app always, by email where EMAIL_BY_DEFAULT
 * says so, so `email` can be on for a person who never touched it.
 */
export type NoticePref = {
  category: NoticeCategory;
  label: string;
  hint: string;
  inApp: boolean;
  email: boolean;
  /** Pushed to the person's phones (Phase 7). No row is the default: on. */
  push: boolean;
};

/** A mentor's booking link on one pairing (a MentorAssignment). `label` is "Program · Cohort", as Settings writes it. */
export type BookingLink = { assignment: string; label: string; url: string | null };

/** `GET /api/v1/account`: what Account and its pages show that /me doesn't. */
export type ApiAccount = {
  name: string | null;
  email: string;
  /** "/api/v1/avatars/<User.id>?v=<ms>", or null for none. */
  avatarPath: string | null;
  /**
   * A student's handle, without "@" (`handle` null when they have none yet);
   * null altogether for anyone without a student record, who has no handle here.
   */
  telegram: { handle: string | null } | null;
  /** A mentor's pairings, in the order Settings lists them; null for anyone who doesn't mentor. */
  bookingLinks: BookingLink[] | null;
  weeklyDigest: boolean;
  notices: NoticePref[];
  /** Something in the changelog this person hasn't seen (`hasUnseenChangelog`). */
  whatsNew: boolean;
  /** Their own reports still open (OPEN_BUG_STATUSES). */
  openBugs: number;
};

/*
 * Account's writes, each answering WriteResult. None takes anybody's id: the
 * reader is the subject, bar a booking link's pairing, which must be theirs.
 *   PUT    /api/v1/account/name                  NameText
 *   PUT    /api/v1/account/telegram              TelegramText (students)
 *   PUT    /api/v1/account/avatar                multipart, one file "avatar"
 *   DELETE /api/v1/account/avatar
 *   PUT    /api/v1/account/notices/:category     NoticeSwitches
 *   PUT    /api/v1/account/weekly-digest         DigestSwitch
 *   PUT    /api/v1/account/booking-links/:id     BookingLinkText (mentors, their own pairing)
 */
export type NameText = { name: string };
export type TelegramText = { telegram: string };
export type NoticeSwitches = { inApp: boolean; email: boolean };
export type DigestSwitch = { on: boolean };
export type BookingLinkText = { url: string };

/** One changelog item: written `**Headline.** detail`, or plain text with no headline. */
export type ChangelogItem = { headline: string | null; detail: string };
/** One day of the changelog. `unseen` when it holds something this person hasn't read (`isUnseen`). */
export type ChangelogDay = { day: string; unseen: boolean; new: ChangelogItem[]; fixed: ChangelogItem[] };
/**
 * `GET /api/v1/changelog`, newest day first. `POST /api/v1/changelog/seen` marks it read (204).
 * `week` is the page's "Past seven days": items added and fixed. The page leaves the fixed figure out for a
 * student, as a staff matter; the app does the same in the student's role.
 */
export type ApiChangelog = { week: { added: number; fixed: number }; days: ChangelogDay[] };

export type BugStatus = "PENDING" | "IN_PROGRESS" | "IN_REVIEW" | "FIXED" | "CLOSED";
/**
 * One of my reports. `statusLabel` is freshform's ("New", "In progress", "In
 * review", "Done", "Won't do"); `open` is whether the team is still on it;
 * `sentOn` the Tashkent day it was sent.
 */
export type BugRow = { id: string; title: string; status: BugStatus; statusLabel: string; open: boolean; sentOn: string };
/** A fixed report, as everybody may read it: the fix line and its day, nothing the reporter wrote. */
export type FixedBug = { fix: string; fixedOn: string | null };
/** `GET /api/v1/bugs` */
export type ApiBugs = { mine: BugRow[]; fixed: FixedBug[] };
/**
 * `GET /api/v1/bugs/:id`: one report, for its reporter or a platform admin.
 * `resolution` is the fix line or the team's note, only once Done or Won't do.
 * `imagePath` is the screenshot, "/api/v1/bugs/<id>/image".
 */
export type ApiBug = BugRow & {
  description: string;
  resolution: string | null;
  imagePath: string | null;
  /** For a platform admin only, triaging it (Phase 8); null for its reporter. */
  triage: BugTriage | null;
};
/*
 * POST /api/v1/bugs is multipart: "title", "description" and an optional file,
 * "screenshot". The app says what it is, as the website's on-screen report
 * says the browser: "userAgent" ("freshlog/1.4.0 (45; iOS 26.1; iPhone 16)"),
 * "width" and "height" (the screen in points), "ratio" (pixels to a point) and
 * "theme" ("light" or "dark"). It answers CreatedResult, the new report's id.
 */

/** A write that made something, and its id: a bug report (a booking answers BookResult, the same shape). */
export type CreatedResult = WriteResult & { id: string };

/** A program a new student can pick, as the registration form lists them (`toProgramOptions`). */
export type ProgramChoice = {
  id: string;
  name: string;
  /** A program has levels (with their cohorts) or flat cohorts, never both. */
  levels: { id: string; name: string; cohorts: { id: string; name: string }[] }[];
  cohorts: { id: string; name: string }[];
};

/**
 * `GET /api/v1/onboarding`: the one form this person has left, as /onboarding
 * decides it. `step` null when there is none to fill in: a wait, or nothing.
 * Answers accounts that aren't active yet: that is who it is for.
 *
 * - `register`: a student nobody registered, who picks their program.
 * - `details`: a student staff registered, who confirms their name and adds a
 *   Telegram handle. `welcome` is "the Global Admissions Program", or
 *   "Freshman Academy"; `eyebrow` the page's ("Step 1 of 2 · Cohort A").
 * - `mentor-name`: a mentor with no name yet.
 */
export type OnboardingStep =
  | { step: "register"; name: string; programs: ProgramChoice[] }
  | { step: "details"; name: string; welcome: string; eyebrow: string | null; pending: boolean }
  | { step: "mentor-name"; name: string }
  | { step: null };

/**
 * `POST /api/v1/onboarding`: the answer to that form, answering WriteResult.
 * `telegram` for both student steps; `program`, `level` and `cohort` for
 * `register`. Which form it answers is freshform's to know, not the body's.
 */
export type OnboardingAnswer = { name: string; telegram?: string; program?: string; level?: string; cohort?: string };

/*
 * Phase 7: push.
 */

/**
 * `POST /api/v1/devices`: this phone's Expo push token ("ExponentPushToken[…]"),
 * tied to the sign-in the request carries, so signing out of that phone stops
 * its pushes. A token another person registered moves to this one. 204.
 */
export type DeviceRegistration = { token: string; platform: "ios" | "android" };

/** `DELETE /api/v1/devices`: stop pushing to this phone. 204, whether or not it was the reader's or registered at all. */
export type DeviceRemoval = { token: string };

/** `PUT /api/v1/account/push/:category`: one category's Push switch, answering WriteResult. */
export type PushSwitch = { on: boolean };

/**
 * A push's `data`. `notification` is the Notification it is (for marking it
 * read); `href` where it is about, a web path as the inbox gives it, or null.
 * Title "freshlog", body the notice's message, badge the unread count.
 */
export type PushData = { notification: string; href: string | null };

/*
 * Phase 8: the remaining screens.
 */

/** A rating a student sent: a report freshform keeps, one per send. `sentOn` is the Tashkent day. */
export type GivenRating = { id: string; mentor: PersonRef; rating: number; comment: string | null; sentOn: string };

/**
 * `GET /api/v1/feedback`: who the student may rate (every mentor they hold or
 * held time with, and every one met through an hour bank, as /student/feedback
 * lists them) and what they have sent, newest first.
 */
export type StudentRatings = { mentors: PersonRef[]; given: GivenRating[] };

/**
 * `POST /api/v1/feedback`: a rating of one of the student's mentors, 1 to 5,
 * and words if they like. Answers WriteResult. The mentor never learns who
 * wrote it; the student's program admins hear the score.
 */
export type RateMentor = { mentor: string; rating: number; comment?: string };

/** The period a mentor's record is read over, as /mentors/:id's tabs: 30 days, 90 days (the default) or all. */
export type RecordPeriod = "30d" | "90d" | "all" | "custom";

/** One student's time with a mentor in one program, as /mentors/:id's Students table. Minutes; `useBy` a Tashkent day. */
export type RecordStudent = {
  student: StudentRef;
  program: ProgramRef;
  completed: number;
  missed: number;
  remaining: number;
  forfeited: number;
  allocated: number;
  useBy: string | null;
  /** Not approved yet. */
  pending: boolean;
};

/**
 * `GET /api/v1/mentors/:id?period=&from=&to=`: a mentor's record, for the
 * mentor themselves and for an admin who manages them (`canManageMentor`), every
 * figure narrowed to the reader's programs as the page narrows it (a mentor
 * reading their own sees all of theirs). Anybody else is a 404. It opens on
 * ninety days, as the page does; `from`–`to` is the Custom tab.
 *
 * `time` is the period's; `programTable` the page's table, the ledger summed by
 * program whatever the window (Completed counts the hour bank's meetings), with
 * an `idle` row for a program the header names and nothing has happened in;
 * `students` every grant, soonest use-by first; `recent` the period's ten newest
 * sessions, and `sessionCount` how many it holds. `ratings` is the average and
 * the count, never who wrote them; the words are on the Feedback page.
 */
export type ApiMentorRecord = {
  mentor: PersonRef & { email: string };
  self: boolean;
  period: RecordPeriod;
  /** The window as the page says it ("the last 90 days", "Sep 1 – Oct 15", "all time"), and its days. */
  window: { label: string; from: string | null; to: string | null };
  programs: (ProgramRef & { cohort: string | null; bookingLink: boolean })[];
  time: { delivered: number; missed: number; sessions: number };
  programTable: {
    program: ProgramRef;
    /** One a student holding this mentor's time in this program: a student in two programs is two. */
    students: number;
    completed: number;
    missed: number;
    expired: number;
    extra: number;
    remaining: number;
    total: number;
    idle?: true;
  }[];
  students: RecordStudent[];
  recent: ApiSession[];
  sessionCount: number;
  ratings: { count: number; average: number } | null;
};

/** One mentor on the admin's Mentors list, as /mentors draws them: their pairings and figures in the reader's programs only. */
export type MentorListRow = {
  mentor: PersonRef & { email: string };
  /** In no program, or an account not placed yet. */
  unassigned: boolean;
  admin: boolean;
  programs: { program: ProgramRef; label: string }[];
  pairings: number;
  pairingsWithLink: number;
  /** Students holding their time. */
  students: number;
  rating: { average: number; count: number } | null;
};

/**
 * `GET /api/v1/mentors?page=&program=&status=unassigned&link=missing&q=`: the
 * admin's Mentors list, `mentorsWhere` in the reader's programs, twenty-five a
 * page, unplaced mentors first. `roster` is everybody in reach, unfiltered.
 */
export type MentorList = { rows: MentorListRow[]; total: number; roster: number; page: number; pageSize: number };

/** One rating as a reader of it sees it. `student` only where the reader administers one of the writer's programs; never for a mentor's own. */
export type RatingRow = { id: string; rating: number; comment: string | null; sentOn: string; mentor: PersonRef | null; student: PersonRef | null };

/** One kind of rating's figures: how many, and their average (null with none). */
export type RatingFigures = { count: number; average: number | null };

/**
 * A mentor on the Feedback page: the combined score of written and meeting
 * ratings, and each kind's figures. `low` is the page's rule (combined average
 * under 3.5, or a 2 or less of either kind in the last 30 days), and `reasons`
 * says which, in the page's words.
 */
export type RatedMentor = {
  mentor: PersonRef;
  average: number;
  count: number;
  written: RatingFigures;
  meetings: RatingFigures;
  lastRatedOn: string | null;
  lowestRecent: number | null;
  low: boolean;
  reasons: string[];
};

/** A meeting a student rated, as the page's feed says it: who rated it, of whom, in which program. Never the reader's own. */
export type MeetingRatingRow = { id: string; day: string; rating: number; note: string | null; mentor: PersonRef; student: PersonRef; program: string };

/**
 * `GET /api/v1/ratings`, as /feedback reads it, with the page's own params:
 * `kind` (written, meetings), `rating` (1 to 5, or 1-3, 1-2), `mentor` (an id,
 * or `me`), `program`, `period`/`from`/`to`, `q`, `sort`/`dir` (mentor, score,
 * ratings, recent, last), `page` and `meetings` (the meeting feed's page).
 *
 * `staff`: every rating the reader's ADMIN and LEADER grants reach (a SALES
 * grant reads none). The combined score and its spread over 1 to 5 (`stars`,
 * one count per star, 1 first), the two kinds' counts, the mentors who need a
 * look (`attention`) and everyone else (`mentors`, worst first or as `sort`
 * says), the score per program when there is more than one, the filters'
 * choices, then the written ratings and the meeting ratings, a page each.
 * `own`: a mentor with no such grant, their combined score and their own
 * written ratings, anonymous; `star` narrows the list only. Anybody else is a
 * 404.
 */
export type ApiRatings =
  | {
      kind: "staff";
      average: number | null;
      count: number;
      /** What the score pools: "both kinds pooled", "written ratings" or "meeting ratings". */
      basis: string;
      ratingKind: "written" | "meetings" | null;
      written: number;
      meetings: number;
      stars: number[];
      /** The one star the page is narrowed to, when it is. */
      star: number | null;
      attention: RatedMentor[];
      mentors: RatedMentor[];
      programScores: { program: { id: string; name: string }; average: number; count: number; written: RatingFigures; meetings: RatingFigures }[];
      filters: {
        /** Every mentor somebody in reach has rated, by name. */
        mentors: PersonRef[];
        programs: { id: string; name: string }[];
        /** The page's sentence for a filtered page ("3 ratings of 2 stars or fewer"); null unfiltered. */
        summary: string | null;
      };
      ratings: RatingRow[];
      total: number;
      meetingRatings: MeetingRatingRow[];
      meetingAverage: number | null;
      meetingTotal: number;
      meetingPage: number;
      page: number;
      pageSize: number;
    }
  | {
      kind: "own";
      average: number | null;
      count: number;
      written: RatingFigures;
      meetings: RatingFigures;
      /** The written ratings' spread: each is on the page with its score. */
      stars: number[];
      star: number | null;
      ratings: RatingRow[];
      total: number;
      page: number;
      pageSize: number;
    };

/**
 * One person Search finds, as the website's command palette lists them. For a
 * student `id` is the StudentProfile.id and `userId` the User.id; for a mentor
 * both are the User.id. `programs` are only the reader's own programs of theirs.
 */
export type SearchHit = { id: string; userId: string; name: string; email: string; programs: string[] };

/**
 * `GET /api/v1/search?q=`: up to eight students and eight mentors, the best
 * match first, through the same questions /students and /mentors ask (an admin
 * their programs, a mentor the students they may log for). A student, and
 * anybody with no roster, is a 404. An empty `q` answers empty lists.
 */
export type ApiSearch = { students: SearchHit[]; mentors: SearchHit[] };

export type BugKind = "BUG" | "FEATURE";

/** One report on the triage board. `reporter` is the reporter's name, the Telegram author's, or "Former user". */
export type TriageCard = {
  id: string;
  title: string;
  status: BugStatus;
  statusLabel: string;
  kind: BugKind;
  kindLabel: string;
  fromTelegram: boolean;
  reporter: string;
  sentOn: string;
  resolvedOn: string | null;
};

/** `GET /api/v1/bugs/triage?kind=BUG|FEATURE`: everything open, newest first, and the last thirty finished. Platform admins only; anybody else a 404. */
export type ApiTriage = { open: TriageCard[]; finished: TriageCard[] };

/**
 * `POST /api/v1/bugs/:id/status`: `setBugStatus`. Done (FIXED) needs the fix
 * line everyone reads, Won't do (CLOSED) a note to the reporter; `changelogDate`
 * ("YYYY-MM-DD") is the fix's changelog day, today when left out. `kind`
 * corrects a report filed as the wrong one. Answers WriteResult.
 */
export type BugStatusChange = { status: BugStatus; resolution?: string; kind?: BugKind; changelogDate?: string };

/** What a platform admin reads on a report besides what its reporter does (`ApiBug.triage`). */
export type BugTriage = {
  reporter: string;
  kind: BugKind;
  fromTelegram: boolean;
  /** The sender's own words from the Telegram group, voice notes transcribed. */
  originalText: string | null;
  pagePath: string | null;
  /** Where it was drawn, as one line. */
  diagnostics: string | null;
  changelogDate: string | null;
};

/** A program access level: ADMIN changes the program, LEADER reads it, SALES has its students. */
export type GrantLevel = "ADMIN" | "LEADER" | "SALES";

/** One person on Platform admins: staff, mentors, and anybody already holding a grant. */
export type PlatformPerson = {
  person: PersonRef & { email: string };
  platformAdmin: boolean;
  grants: { program: string; level: GrantLevel }[];
};

/**
 * `GET /api/v1/platform`: who administers what, as /settings/platform reads it.
 * Platform admins only; anybody else is a 404. `me` is the reader's own id.
 *
 * Its writes, each answering WriteResult and each the website's action:
 *   PUT    /api/v1/platform/people/:userId/programs/:programId   AccessChange (setProgramGrant)
 *   DELETE /api/v1/platform/people/:userId/programs/:programId   (removeProgramGrant)
 *   PUT    /api/v1/platform/people/:userId/admin                 PlatformAdminChange (setPlatformAdmin)
 *   PUT    /api/v1/platform/people/:userId/access                AccessSet (setProgramAccess): their whole set at once
 *
 * `organisation` is the page's read-only facts: the mentor sign-up domain
 * (without the @), whether email is live (else a dry run), and the day the
 * last weekly summary went out (a Tashkent day), null for never.
 */
export type ApiPlatform = {
  me: string;
  programs: { id: string; name: string }[];
  people: PlatformPerson[];
  organisation: { mentorDomain: string; emailLive: boolean; lastWeeklySummary: string | null };
};
/** A person's whole access set: every program they administer, at its level; one left out is taken away. */
export type AccessSet = { programs: { program: string; level: GrantLevel }[] };
export type AccessChange = { level: GrantLevel };
export type PlatformAdminChange = { on: boolean };

/**
 * One session on Analytics: [program, mentor, student, day, minutes, kind].
 * `program` and `mentor` index `programs` and `mentors`; `student` is an opaque
 * index (no student is ever named here); `day` is the Tashkent day as yyyymmdd;
 * `kind` is 0 completed, 1 extra (out of plan), 2 no-show.
 */
export type AnalyticsSession = [program: number, mentor: number, student: number, day: number, minutes: number, kind: 0 | 1 | 2];

/**
 * `GET /api/v1/analytics?frame=school`: the website's Analytics read, the
 * same rows for every mentor and member of staff (it names mentors and hours,
 * never a student). `frame` is where the reader starts: one institute's levels
 * when that is their whole work, else the school; `other` is the one link to
 * the other frame. `audience` "mentor" lands on `self`'s own year. Students
 * are a 404. `?as=mentor` or `?as=admin` names the side the app is on, for a
 * person who has both (the website's cookie); anyone else's side is their own.
 */
export type ApiAnalytics = {
  audience: "staff" | "mentor";
  self: string | null;
  frame: { kind: "school" } | { kind: "institute"; name: string };
  other: { label: string; school: boolean } | null;
  today: string;
  programs: { id: string; name: string; colorIndex: number | null; archived: boolean; granted: number }[];
  mentors: PersonRef[];
  sessions: AnalyticsSession[];
};
