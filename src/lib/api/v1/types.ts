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
  /** A mentor's or an admin's list only: one student (StudentProfile.id). */
  student?: string;
  /** A student's own list only: the sessions with one mentor (User.id), for that mentor's page. */
  mentor?: string;
  program?: string;
  /** `week` is the Tashkent week from Monday. */
  period?: "week" | "30d" | "90d" | "year";
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
   * side asking for the ones the reader logged, whatever else they are; to
   * anyone who can't act as a mentor it is a 404, as it is to every reader with
   * no list. `admin` is the app's admin side asking for every session in the
   * programs the reader reads; to anyone who reads none it is a 404.
   */
  as?: "mentor" | "admin";
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
  /** Unread notifications, the bell's badge. Filled by Task F6. */
  unread: number;
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
  /**
   * freshform's "things to check" in its order, all of them: the whole list
   * `studentRows` makes. The website's page thins it before drawing it: it
   * leaves out an overdue task or agenda item, which it draws in a list of its
   * own, and the use-by row once the balance shows the date, and it folds every
   * mentor with no booking link into one row. A session to confirm carries its
   * id.
   */
  todo: TodoRow[];
  /** Sessions waiting for their answer. */
  toConfirm: number;
  /** The student's tasks, open by due day and then done. Filled by Task F6. */
  tasks: ApiTask[];
  /** The student's plan items, not done first. Filled by Task F6. */
  plan: ApiPlanItem[];
  /** Unread notifications, the bell's badge. Filled by Task F6. */
  unread: number;
  /** Today in the program's zone, "YYYY-MM-DD". The app never takes it from the phone. */
  today: string;
};

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
  /** `delete` is an admin's of the item's program: its own mentor can't (`deleteAssignment`). */
  can: { edit: boolean; progress: boolean; delete: boolean };
};
/** GET /api/v1/tasks/:id. `today` is the earliest due day a new value may take. */
export type TaskDetail = { task: ApiTask; today: string };
/** GET /api/v1/plan-items/:id. */
export type PlanItemDetail = { item: ApiPlanItem; today: string };

/** POST /api/v1/tasks. */
export type TaskCreate = { studentProfileId: string; programId: string; title: string; due: string; note?: string };
/** PATCH /api/v1/tasks/:id. What is left out keeps its stored value; `note: null` clears it. */
export type TaskEdit = { title?: string; due?: string; note?: string | null };
/** POST /api/v1/tasks/:id/progress: finish it, or set a percent (which reopens a finished one). */
export type TaskProgress = { done: true } | { percent: number };
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
/** GET /api/v1/inbox. `unread` counts the whole feed. */
export type InboxPage = { items: InboxItem[]; nextCursor: string | null; unread: number };
/** `limit` is 1 to 100, 25 when left out; any other value is a 400 on field `limit`, as a bad `cursor` is on `cursor`. */
export type InboxQuery = { cursor?: string; limit?: string };
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
  can: { write: boolean };
};

/** GET /api/v1/admin/home: what /admin shows. 404 to a reader with no program to read. */
export type AdminHome = {
  /**
   * Over every student in the reader's programs. `pending` counts those nobody
   * has approved; `expiring`, those with time that runs out within 14 days.
   */
  summary: { remaining: number; students: number; programs: number; pending: number; expiring: number };
  /** Active first, then archived, each by name. */
  programs: ProgramRow[];
  /** The staff's list, in its order. No row carries `log`: an admin's answer to time running out is a grant. */
  todo: TodoRow[];
  todoSpilled: number;
  unread: number;
  platformAdmin: boolean;
  today: string;
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
  /** `student` is by name; the others put the most urgent first. */
  sort?: "student" | "remaining" | "deadline" | "seen";
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
};
/** 25 rows a page. `shown` counts every row the filter matches, on every page. `programs` is the program menu. */
export type RosterPage = { rows: RosterRow[]; page: number; pages: number; shown: number; programs: ProgramRef[]; today: string };

/** GET /api/v1/students/:id/admin: one student as an admin of one of their programs reads them. */
export type AdminStudent = {
  student: StudentRef & {
    email: string;
    telegram: string | null;
    folderUrl: string | null;
    /** The day the record was made. */
    registered: string;
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
  /** The last 20 changes to their time, newest first. */
  history: GrantChange[];
  /**
   * `approve` and `reject`: they are waiting and the reader may change one of
   * their programs. `allocate`: the reader may grant them time. `reach`: the
   * reader mentors them.
   */
  can: { approve: boolean; reject: boolean; allocate: boolean; reach: boolean };
  today: string;
};
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
  | { archived: boolean };
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

/** A classmate: any other approved student, in any program. `id` is their StudentProfile.id. */
export type ClassmateRow = {
  id: string;
  person: PersonRef;
  /** Their own programs, by name: never one they are only visiting. */
  programs: string[];
  /** Their open times still to come. */
  open: number;
  next: SlotTime | null;
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
  /** Neither completed nor absent; soonest first. */
  coming: InterviewRow[];
  /** Completed or absent; newest first. */
  done: InterviewRow[];
  /** Mine, still to come; soonest first. */
  times: OfferedSlot[];
  /** Those offering a time first, then the rest; each by name. */
  classmates: ClassmateRow[];
  todo: PracticeTodo[];
  /** What a new time may be: a day from `today` to `lastDay`, `lengths` minutes long. */
  offer: { today: string; lastDay: string; lengths: number[] };
  /** "Tashkent": the clock `day` and `time` are on. */
  zone: string;
};

/** POST /api/v1/interviews/slots. `day` and `time` on the Tashkent clock. */
export type OfferSlot = { day: string; time: string; minutes: number; meetingUrl?: string };
/* DELETE /api/v1/interviews/slots/:id: a time nobody has booked. */

/** A classmate's page: GET /api/v1/classmates/:id */
export type Classmate = {
  id: string;
  person: PersonRef;
  /** Their own programs, by name. Named `shared` from when only classmates who shared a program were listed. */
  shared: string[];
  /** Open and still to come. No meeting link: that is for whoever books it. */
  slots: { id: string; when: SlotTime }[];
  templates: InterviewTemplateRef[];
};

/** POST /api/v1/interviews: book a classmate's time. */
export type BookInterview = { slot: string; template: string };
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
  can: { cancel: boolean; done: boolean; absent: boolean; guide: boolean; notes: boolean; editFeedback: boolean; feedback: boolean };
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
/** `GET /api/v1/changelog`, newest day first. `POST /api/v1/changelog/seen` marks it read (204). */
export type ApiChangelog = { days: ChangelogDay[] };

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
 * "screenshot". It answers CreatedResult, the new report's id.
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
export type RecordPeriod = "30d" | "90d" | "all";

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
 * `GET /api/v1/mentors/:id?period=`: a mentor's record, for the mentor
 * themselves and for an admin who manages them (`canManageMentor`), every
 * figure narrowed to the reader's programs as the page narrows it (a mentor
 * reading their own sees all of theirs). Anybody else is a 404.
 *
 * `time` is the period's; `students` every grant, soonest use-by first.
 * `ratings` is the average and the count, never who wrote them; the words are
 * on the Ratings page.
 */
export type ApiMentorRecord = {
  mentor: PersonRef & { email: string };
  self: boolean;
  period: RecordPeriod;
  programs: (ProgramRef & { cohort: string | null; bookingLink: boolean })[];
  time: { delivered: number; missed: number; sessions: number };
  students: RecordStudent[];
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

/** A mentor on the Ratings page: worst average first. `low` under 3.5 on average, or a 2 or less in the last 30 days. */
export type RatedMentor = { mentor: PersonRef; average: number; count: number; lastRatedOn: string | null; lowestRecent: number | null; low: boolean };

/**
 * `GET /api/v1/ratings?mentor=&program=&page=`, as /feedback reads it.
 * `staff`: every rating the reader's ADMIN and LEADER grants reach (a SALES
 * grant reads none), the mentors table and the newest ratings. `own`: a mentor
 * with no such grant, their own ratings, anonymous. Anybody else is a 404.
 */
export type ApiRatings =
  | { kind: "staff"; average: number | null; count: number; mentors: RatedMentor[]; ratings: RatingRow[]; page: number; pageSize: number }
  | { kind: "own"; average: number | null; count: number; ratings: RatingRow[]; page: number; pageSize: number };

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
 */
export type ApiPlatform = { me: string; programs: { id: string; name: string }[]; people: PlatformPerson[] };
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
 * are a 404.
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
