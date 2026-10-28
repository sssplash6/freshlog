import {

  NOTIFICATION_TYPES,
  ROLES,
  SESSION_STATUS,
  USER_STATUS,
} from "@/lib/constants";
import { mentorReachWhere } from "@/lib/queries";
import { EXPIRY_WINDOW_DAYS, type Audience, type TimeState } from "@/lib/status";
import { programWallClock } from "@/lib/when";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The URL is the filter state, and this file is the only thing that reads it.
 *
 * Every list in the app had grown its own answer to the same three questions —
 * what does `?program=` mean, what happens to the other params when I change
 * one, and where does the page number go. `mentor-hours-filter.tsx` was the
 * extreme: 322 lines in which the URL contract, the date arithmetic and the
 * pill markup were one inseparable lump, so nothing in it could be tested and
 * nothing in it could be reused. Beside it sat three hand-rolled filter cards
 * (`admin/students`, `mentor/sessions`, and the `SearchForm` shell) that each
 * re-derived a subset of the same rules, and each got a different subset wrong:
 * one dropped the page number, one carried it, one lost the program when you
 * searched.
 *
 * So the reading of the URL lives here, as functions with no I/O, and the
 * drawing of the controls lives in `ui/filter-bar.tsx`. The whole point of the
 * split is that the rules below are provable — `filters.test.ts` is the reason
 * this file imports no `prisma`, reads no clock, and takes `now` as an
 * argument.
 *
 * FOUR RULES the rest of the layer leans on.
 *
 * 1. **Absent and empty are the same thing.** A GET form submits every field it
 *    has, empty ones included, so `?q=&program=` is what the browser produces
 *    the moment someone presses Apply with a blank box. `readParam` collapses
 *    that to "" and every link this file builds drops it again, so the URL
 *    tidies itself on the next click and no reader downstream can tell the
 *    difference.
 * 2. **Changing a filter resets the page.** Page 4 of a one-page result is a
 *    blank screen that looks like data loss, and it was reachable from three
 *    of the four filter cards.
 * 3. **A param may narrow what a viewer sees and never widen it.** Access comes
 *    from `FilterScope`, which is ANDed in unconditionally; the params only
 *    ever add further conditions. A pasted id from another program therefore
 *    returns nothing rather than someone else's rows.
 * 4. **Nothing here throws.** Every value in a URL is typed by a stranger. An
 *    unknown enum, a 40th of February, a `programId` of `constructor` all have
 *    to produce a sane filter or no filter at all.
 */

/** The shape Next hands a page from `await searchParams`. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** An option for one of the bar's selects. Structurally a `SelectOption`. */
export type FilterOption = { value: string; label: string; hint?: string };

/**
 * A one-click narrowing, as the params it sets.
 *
 * Presets are ordinary params rather than a private `?show=a,b` vocabulary, so
 * `?time=expiring` reads as what it is, the `where` builders need no second
 * parser, and two presets that write the same param ("Pending" and "Not signed
 * in" both write `status`) are mutually exclusive for free.
 */
export type FilterPreset = {
  /** Three words at most: it is a chip. */
  label: string;
  /** Set together when the chip goes on, cleared together when it goes off. */
  params: Record<string, string>;
  /** Why a reader would reach for it. Twelve words at most. */
  hint?: string;
};

/**
 * What a viewer is allowed to see, ANDed into every `where` below.
 *
 * This is deliberately not derived from the URL. A leader's program grants and
 * a mentor's lens are facts about the session, established by `lib/dal.ts`
 * before a query is built; the params can only narrow inside them.
 */
export type FilterScope = {
  /** Whose words and whose windows. Defaults to `staff`. */
  audience?: Audience;
  /** The signed-in user, which is what the literal `?mentor=me` resolves to. */
  userId?: string;
  /** Programs this viewer may see at all. `undefined` means every program. */
  programIds?: readonly string[];
  /** Mentor lens: only rows that are this mentor's. */
  mentorId?: string;
  /** One student's own pages. */
  studentId?: string;
};

/**
 * Params that mean "which page of the list". Dropped by every link this file
 * builds, per rule 2. `site` is here because `/admin/feedback` pages two lists
 * on one route and named its second one that.
 */
export const PAGE_PARAMS: readonly string[] = ["page", "site"];

/**
 * Every param this layer owns, and therefore everything Reset clears.
 *
 * A param NOT in this list belongs to the page — the `?view=` tab on
 * `/sessions`, the `?read=unread` tab on `/notifications`, an anchor, a draft
 * — and survives a Reset untouched, which is why the bar needs no "keep these"
 * prop. A tab is somewhere you went, not a narrowing you applied, and clearing
 * the filters must not also move you off it.
 *
 * A new filter goes in this list first; if it is missing, Reset will quietly
 * leave it on. The `where` builders read a param whichever control wrote it, so
 * being absent here costs a param nothing except its place in Reset.
 */
export const FILTER_PARAMS: readonly string[] = [
  "q",
  "program",
  "level",
  "cohort",
  "student",
  "mentor",
  "status",
  "time",
  "link",
  "attendance",
  "kind",
  "rating",
  "session",
  "category",
  "period",
  "from",
  "to",
];

/**
 * No legitimate filter value is longer than this — they are ids, dates and
 * single words. The cap stops a hand-built URL from posting a kilobyte into a
 * `LIKE` pattern.
 */
const MAX_VALUE = 200;

function firstValue(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : "";
}

/**
 * One param, trimmed, with absent and empty flattened into "".
 *
 * Takes the first value when a param is repeated, matching
 * `URLSearchParams.get`, so `?q=a&q=b` has one defined meaning rather than
 * depending on which reader looks at it.
 */
export function readParam(params: SearchParams, key: string): string {
  return firstValue(params[key]).trim().slice(0, MAX_VALUE);
}

/**
 * A param looked up in a table of the values it is allowed to take, mapping the
 * lowercase word in the URL to whatever the column actually stores.
 *
 * `hasOwnProperty` rather than `table[raw]`, because `?status=constructor` on a
 * plain object lookup hands back a function and the caller puts it in a query.
 */
export function readChoice<T>(
  params: SearchParams,
  key: string,
  table: Record<string, T>
): T | undefined {
  const raw = readParam(params, key);
  if (!raw || !Object.prototype.hasOwnProperty.call(table, raw)) return undefined;
  return table[raw];
}

/**
 * A link to the same list with some params changed, everything else kept and
 * the page number dropped.
 *
 * Keys keep the position they had in the incoming URL, so a shared link does
 * not shuffle its own query string every time a filter is touched.
 */
export function filterHref(
  basePath: string,
  params: SearchParams,
  changes: Record<string, string | undefined> = {}
): string {
  const search = new URLSearchParams();
  const written = new Set<string>();

  const write = (key: string, value: string | undefined) => {
    written.add(key);
    const trimmed = (value ?? "").trim();
    if (trimmed) search.set(key, trimmed);
  };

  for (const key of Object.keys(params)) {
    if (PAGE_PARAMS.includes(key)) continue;
    write(key, key in changes ? changes[key] : readParam(params, key));
  }
  for (const [key, value] of Object.entries(changes)) {
    if (!written.has(key)) write(key, value);
  }

  const qs = search.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Whether every param a preset sets is currently set to that value. */
export function presetIsActive(params: SearchParams, preset: FilterPreset): boolean {
  return Object.entries(preset.params).every(
    ([key, value]) => readParam(params, key) === value
  );
}

/** The chip's link: on turns its params on, off clears every one of them. */
export function presetHref(
  basePath: string,
  params: SearchParams,
  preset: FilterPreset
): string {
  const active = presetIsActive(params, preset);
  const changes: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(preset.params)) {
    changes[key] = active ? undefined : value;
  }
  return filterHref(basePath, params, changes);
}

/** The bare list again: every filter cleared, the page's own params kept. */
export function resetHref(basePath: string, params: SearchParams): string {
  const changes: Record<string, string | undefined> = {};
  for (const key of FILTER_PARAMS) changes[key] = undefined;
  return filterHref(basePath, params, changes);
}

/**
 * How many filters are on. `from` and `to` count as one narrowing, since they
 * are two halves of one control and "2 filters" for one date range reads as a
 * miscount.
 */
export function activeFilterCount(params: SearchParams): number {
  let count = 0;
  for (const key of FILTER_PARAMS) {
    if (key === "to") continue;
    if (readParam(params, key)) count++;
  }
  if (!readParam(params, "from") && readParam(params, "to")) count++;
  return count;
}

/* ---------------------------------------------------------------- search --- */

export type SearchSurface =
  | "students"
  | "mentors"
  | "sessions"
  | "feedback"
  | "partnerFeedback"
  | "notifications";

/**
 * One searchable field: the noun a person would use for it, and the `where`
 * fragment that looks in it.
 *
 * The pair is the whole point. A box that says "Name or email" and searches
 * only names is the defect this replaces, and it was invisible because the
 * placeholder and the query lived in different files. Here the placeholder is
 * GENERATED from the same list the query is built from, so the box cannot lie.
 *
 * `contains` with no `mode`: SQLite's `LIKE` is already case-insensitive for
 * ASCII, so "aziza" finds "Aziza" unaided — and Prisma's
 * `mode: "insensitive"` is unsupported on SQLite and throws if you ask for it.
 * Do not "fix" this by adding it. The known limit is non-ASCII: a Cyrillic name
 * would match case-sensitively, which is acceptable while every name in the
 * data is Latin script.
 */
type SearchField<W> = { label: string; where: (q: string) => W };

const STUDENT_SEARCH: SearchField<Prisma.StudentProfileWhereInput>[] = [
  { label: "name", where: (q) => ({ user: { name: { contains: q } } }) },
  { label: "email", where: (q) => ({ user: { email: { contains: q } } }) },
];

const MENTOR_SEARCH: SearchField<Prisma.UserWhereInput>[] = [
  { label: "name", where: (q) => ({ name: { contains: q } }) },
  { label: "email", where: (q) => ({ email: { contains: q } }) },
];

/**
 * Session notes are the richest free text in the product, and until now nothing
 * could search them: "when did we cover the Common App?" was an unanswerable
 * question about data the app already had.
 */
const SESSION_SEARCH: SearchField<Prisma.SessionWhereInput>[] = [
  { label: "note", where: (q) => ({ note: { contains: q } }) },
  { label: "agenda", where: (q) => ({ assignment: { purpose: { contains: q } } }) },
  { label: "student", where: (q) => ({ student: { user: { name: { contains: q } } } }) },
  { label: "mentor", where: (q) => ({ mentor: { name: { contains: q } } }) },
];

const FEEDBACK_SEARCH: SearchField<Prisma.MentorFeedbackWhereInput>[] = [
  { label: "comment", where: (q) => ({ comment: { contains: q } }) },
  { label: "mentor", where: (q) => ({ mentor: { name: { contains: q } } }) },
];

/**
 * A partner school's feedback names no account, only the address the student
 * checked in with and, on a session rating, the name they typed. The email is
 * stored lowercased, so the box's text is lowered to meet it.
 */
const PARTNER_FEEDBACK_SEARCH: SearchField<Prisma.PartnerFeedbackWhereInput>[] = [
  { label: "email", where: (q) => ({ studentEmail: { contains: q.toLowerCase() } }) },
  { label: "name", where: (q) => ({ name: { contains: q } }) },
];

/** The same box as `FEEDBACK_SEARCH`, asked of a meeting's rating. */
const MEETING_RATING_SEARCH: SearchField<Prisma.SessionWhereInput>[] = [
  { label: "comment", where: (q) => ({ studentNote: { contains: q } }) },
  { label: "mentor", where: (q) => ({ mentor: { name: { contains: q } } }) },
];

const NOTIFICATION_SEARCH: SearchField<Prisma.NotificationWhereInput>[] = [
  { label: "message", where: (q) => ({ message: { contains: q } }) },
];

/** "note, agenda, student or mentor" — the fields, in the order they are tried. */
function fieldList<W>(fields: SearchField<W>[]): string {
  const labels = fields.map((f) => f.label);
  const joined =
    labels.length < 2
      ? labels.join("")
      : `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/**
 * An OR across every searchable field, or nothing at all when the box is empty.
 *
 * Undefined rather than `{}` so a caller can spread it: an empty `{ OR: [] }`
 * matches no rows in Prisma, which would make a blank search return an empty
 * list.
 */
function searchWhere<W>(fields: SearchField<W>[], q: string): { OR: W[] } | undefined {
  return q ? { OR: fields.map((f) => f.where(q)) } : undefined;
}

/**
 * The partner feedback search, for `partnerFeedbackWhere`. Exported because
 * that builder lives with the partner queries, and the box's placeholder has
 * to be generated from the fields it actually looks in.
 */
export function partnerFeedbackSearch(
  q: string
): { OR: Prisma.PartnerFeedbackWhereInput[] } | undefined {
  return searchWhere(PARTNER_FEEDBACK_SEARCH, q);
}

/** What the box searches, in the reader's words, on the box itself. */
export const SEARCH_PLACEHOLDER: Record<SearchSurface, string> = {
  students: fieldList(STUDENT_SEARCH),
  mentors: fieldList(MENTOR_SEARCH),
  sessions: fieldList(SESSION_SEARCH),
  feedback: fieldList(FEEDBACK_SEARCH),
  partnerFeedback: fieldList(PARTNER_FEEDBACK_SEARCH),
  notifications: fieldList(NOTIFICATION_SEARCH),
};

/** The label above the box. */
export const SEARCH_LABEL: Record<SearchSurface, string> = {
  students: "Find a student",
  mentors: "Find a mentor",
  sessions: "Find a session",
  feedback: "Find a comment",
  partnerFeedback: "Find a student",
  notifications: "Find a notification",
};

/* ------------------------------------------------------------ date range --- */

export type DatePreset = "week" | "30d" | "90d" | "year";

/**
 * The four windows worth one click. Written as `FilterPreset`s so a date chip
 * and a filter chip are the same mechanism and the same markup, and so a list
 * that filters the FUTURE (the scheduled meetings tab) simply does not pass
 * them rather than needing a flag to hide them.
 *
 * Each one clears `from` and `to` as well as setting `period`, because a typed
 * range beats a preset: without that, clicking "Last 30 days" over a typed
 * range would light the chip while the typed range went on deciding the answer.
 * It is the same rule read the other way that keeps the chip dark while a
 * range is typed.
 *
 * "This week" leads because it is the question people actually ask of a ledger
 * — "how much did we deliver this week?" — and answering it used to mean
 * typing two dates. It is the CALENDAR week, Monday to today, not a rolling
 * seven days: somebody asking on Tuesday means since Monday, and a rolling
 * window would quietly include half of last week.
 */
export const DATE_PRESETS: readonly (FilterPreset & { value: DatePreset })[] = [
  { value: "week", label: "This week", params: { period: "week", from: "", to: "" } },
  { value: "30d", label: "Last 30 days", params: { period: "30d", from: "", to: "" } },
  { value: "90d", label: "Last 90 days", params: { period: "90d", from: "", to: "" } },
  { value: "year", label: "This year", params: { period: "year", from: "", to: "" } },
];

export type DateWindow = {
  /** Inclusive bounds for the query; undefined means unbounded that side. */
  from?: Date;
  to?: Date;
  /** Which preset is lit, if any. */
  preset?: DatePreset;
  /** Whether the bounds came from the two date fields rather than a preset. */
  custom: boolean;
  /**
   * How the window reads inside a sentence: "the last 30 days", "all time".
   * Empty for a typed range — the two date inputs are already showing it, and
   * formatting it here would mean reading the clock to decide about the year.
   */
  label: string;
  /** What the two `<input type="date">` fields show. Only ever what was typed. */
  fromValue: string;
  toValue: string;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A YYYY-MM-DD param as a real calendar day, or null.
 *
 * The component check is not paranoia: `new Date("2026-02-31")` is March 3, so
 * a regex alone would silently answer a different question than the one asked.
 */
function parseDay(raw: string): Date | null {
  if (!DATE_ONLY.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  if (
    at.getUTCFullYear() !== y ||
    at.getUTCMonth() !== m - 1 ||
    at.getUTCDate() !== d
  ) {
    return null;
  }
  return at;
}

/**
 * Midnight UTC starting the program-local day that `now` falls in.
 *
 * Calendar dates in this schema are stored at UTC midnight, and the day they
 * mean is the program's day (`lib/when.ts`). Between 00:00 and 05:00 in
 * Tashkent the UTC calendar is still on yesterday, so a window computed from
 * UTC's today was a day short for the five hours a mentor is most likely to be
 * catching up — the same bug `when.ts` was written to close, in another place.
 */
function startOfProgramDay(now: Date): Date {
  const wall = programWallClock(now);
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()));
}

/** The last instant of the day `day` starts, for an inclusive upper bound. */
function endOfDay(day: Date): Date {
  return new Date(day.getTime() + DAY_MS - 1);
}

/**
 * `?period=` / `?from=` / `?to=` as real dates.
 *
 * A typed range beats a preset, because typing one is the more deliberate act,
 * and a backwards range is read the way it was plainly meant rather than
 * matching nothing. Both rules are inherited from the file this replaces; they
 * were right, they were just untestable in there.
 *
 * The upper bound is the END of its day, so `to=2026-08-03` includes both a
 * session dated at UTC midnight and a rating left that afternoon.
 */
export function readDateWindow(params: SearchParams, now: Date): DateWindow {
  let fromValue = readParam(params, "from");
  let toValue = readParam(params, "to");
  if (!parseDay(fromValue)) fromValue = "";
  if (!parseDay(toValue)) toValue = "";
  // Both are YYYY-MM-DD, so string order is date order.
  if (fromValue && toValue && fromValue > toValue) {
    [fromValue, toValue] = [toValue, fromValue];
  }

  const start = fromValue ? parseDay(fromValue) : null;
  const end = toValue ? parseDay(toValue) : null;
  if (start || end) {
    return {
      from: start ?? undefined,
      to: end ? endOfDay(end) : undefined,
      custom: true,
      label: "",
      fromValue,
      toValue,
    };
  }

  const today = startOfProgramDay(now);
  const preset = readChoice(params, "period", {
    week: "week",
    "30d": "30d",
    "90d": "90d",
    year: "year",
  } as const);
  if (!preset) {
    return { custom: false, label: "all time", fromValue: "", toValue: "" };
  }

  // A window that says "last" cannot reach into tomorrow, so both ends are
  // bound. Counting is inclusive of today: "the last 30 days" that spans 31
  // calendar days is simply a wrong label, and the old one did.
  const daysBack = (days: number) => new Date(today.getTime() - (days - 1) * DAY_MS);
  // Monday of the program-local week `today` falls in. getUTCDay() is 0 on
  // Sunday, which belongs to the week that started six days earlier — the one
  // case an ISO week and a naive `day - 1` disagree about.
  const monday = () => {
    const weekday = today.getUTCDay();
    return new Date(today.getTime() - ((weekday + 6) % 7) * DAY_MS);
  };
  const window =
    preset === "week"
      ? { from: monday(), label: "this week" }
      : preset === "30d"
        ? { from: daysBack(30), label: "the last 30 days" }
        : preset === "90d"
          ? { from: daysBack(90), label: "the last 90 days" }
          : {
              from: new Date(Date.UTC(today.getUTCFullYear(), 0, 1)),
              label: `${today.getUTCFullYear()}`,
            };

  return {
    ...window,
    to: endOfDay(today),
    preset,
    custom: false,
    fromValue: "",
    toValue: "",
  };
}

/** The window as a filter on one date column, or nothing when unbounded. */
function dateWhere(window: DateWindow): { gte?: Date; lte?: Date } | undefined {
  if (!window.from && !window.to) return undefined;
  return {
    ...(window.from ? { gte: window.from } : {}),
    ...(window.to ? { lte: window.to } : {}),
  };
}

/* --------------------------------------------------------------- presets --- */

/**
 * The student list's chips.
 *
 * "Pending" and "Not signed in" share the `status` param because they are
 * mutually exclusive states of the same account (`status.ts:727-731` reports
 * the second only when the first is false), and the three `time` chips share
 * theirs for the same reason.
 */
export const STUDENT_PRESETS: readonly FilterPreset[] = [
  {
    label: "Pending",
    params: { status: "pending" },
    hint: "Signed themselves up and are waiting for approval.",
  },
  {
    label: "Not signed in",
    params: { status: "not-signed-in" },
    hint: "Registered, but has never completed a first sign-in.",
  },
  { label: "No time", params: { time: "none" }, hint: "Holds no allocation at all." },
  {
    label: "Expiring",
    params: { time: "expiring" },
    hint: "Has time with a use-by date coming up.",
  },
  {
    label: "Expired",
    params: { time: "expired" },
    hint: "Has time whose use-by date has passed.",
  },
];

/** The mentor list's chips. */
export const MENTOR_PRESETS: readonly FilterPreset[] = [
  {
    label: "Unassigned",
    params: { status: "unassigned" },
    hint: "Signed in, but not yet in any program.",
  },
  {
    label: "No booking link",
    params: { link: "missing" },
    hint: "A pairing with no way for a student to book.",
  },
];

/** What a mentor viewing their own list means by "mine". */
export const MINE_PRESET: FilterPreset = {
  label: "Mine",
  params: { mentor: "me" },
  hint: "Only the people you hold time with.",
};

/** `?time=`, read as the state it names, or nothing. */
export function readTimeState(params: SearchParams): TimeState | undefined {
  return readChoice(params, "time", {
    none: "none",
    expiring: "expiring",
    expired: "expired",
  } as const);
}

/* -------------------------------------------------------- value spellings --- */

/**
 * URL word to stored value, once per column.
 *
 * The URL says `?status=voided` and the column says `VOIDED`: a filter that is
 * read and typed by people gets lowercase words, and this is the only place the
 * two spellings meet.
 */
const SESSION_STATUS_VALUES = {
  active: SESSION_STATUS.ACTIVE,
  voided: SESSION_STATUS.VOIDED,
  rescheduled: SESSION_STATUS.RESCHEDULED,
} as const;

export const SESSION_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: "active", label: "Active" },
  { value: "voided", label: "Voided" },
];

/**
 * Attendance as a filter is `attendanceOf()` read backwards.
 *
 * It deliberately does NOT go through `attendanceFields()`, which writes
 * `status` as well: pinning `status: ACTIVE` in here would make "no-shows" and
 * "voided" contradict each other and return nothing, when a voided no-show is
 * an ordinary row. Only the columns that are genuinely about attendance appear,
 * and RESCHEDULED is excluded from the two "they turned up" states because a
 * rescheduled row keeps `attended: true` on purpose.
 */
const ATTENDANCE_VALUES: Record<string, Prisma.SessionWhereInput> = {
  attended: { attended: true, late: false, status: { not: SESSION_STATUS.RESCHEDULED } },
  late: { attended: true, late: true, status: { not: SESSION_STATUS.RESCHEDULED } },
  absent: { attended: false },
  rescheduled: { status: SESSION_STATUS.RESCHEDULED },
};

export const ATTENDANCE_OPTIONS: readonly FilterOption[] = [
  { value: "attended", label: "Attended" },
  { value: "late", label: "Came late" },
  { value: "absent", label: "No-show" },
  { value: "rescheduled", label: "Rescheduled" },
];

const KIND_VALUES = { plan: true, extra: false } as const;

export const KIND_OPTIONS: readonly FilterOption[] = [
  { value: "plan", label: "Counts toward their time" },
  { value: "extra", label: "Extra, beyond their time" },
];

/**
 * The notification categories, each as the types it covers.
 *
 * `Notification.category` does not exist yet — REDESIGN.md 5.1 adds it, mapped
 * from these same 17 types inside `notify()`. Until it lands the filter groups
 * by `type in (...)`, which is the same question asked of the columns that are
 * actually there; when the column arrives this table becomes a one-line
 * equality and the grouping moves to the writer.
 *
 * FEEDBACK and WEEKLY have no producers yet (5.1 adds `FEEDBACK_RECEIVED` and
 * `WEEKLY_SUMMARY`), so they are absent rather than offered as a control that
 * can only ever return nothing.
 */
export const NOTIFICATION_CATEGORIES: readonly {
  value: string;
  label: string;
  types: readonly string[];
}[] = [
  { value: "hours", label: "Time", types: [NOTIFICATION_TYPES.HOURS_GRANTED] },
  {
    value: "sessions",
    label: "Sessions",
    types: [
      NOTIFICATION_TYPES.SESSION_LOGGED,
      NOTIFICATION_TYPES.SESSION_EDITED,
      NOTIFICATION_TYPES.SESSION_VOIDED,
      NOTIFICATION_TYPES.SESSION_DELETED,
    ],
  },
  {
    value: "tasks",
    label: "Tasks and agenda",
    // Both halves of the plan, because both are one category in the database
    // (`CATEGORY_OF`) and one subscription in the email preferences. A filter
    // that named the category and then matched half of it would hide a
    // student's own tasks behind a chip that says it shows them.
    types: [
      NOTIFICATION_TYPES.GOAL_ASSIGNED,
      NOTIFICATION_TYPES.GOAL_CHANGED,
      NOTIFICATION_TYPES.GOAL_DONE,
      NOTIFICATION_TYPES.TASK_SET,
      NOTIFICATION_TYPES.TASK_CHANGED,
      NOTIFICATION_TYPES.TASK_MOVED,
      NOTIFICATION_TYPES.MENTOR_TASK_SET,
      NOTIFICATION_TYPES.MENTOR_TASK_DONE,
    ],
  },
  {
    value: "accounts",
    label: "Accounts",
    types: [
      NOTIFICATION_TYPES.STUDENT_SIGNUP,
      NOTIFICATION_TYPES.ACCOUNT_APPROVED,
      NOTIFICATION_TYPES.MENTOR_ASSIGNED,
      NOTIFICATION_TYPES.ENROLLMENT_MOVED,
    ],
  },
  { value: "deadlines", label: "Deadlines", types: [NOTIFICATION_TYPES.HOURS_DEADLINE] },
];

const CATEGORY_TYPES: Record<string, readonly string[]> = Object.fromEntries(
  NOTIFICATION_CATEGORIES.map((c) => [c.value, c.types])
);

/* ------------------------------------------------------------ the where's --- */

/** `?mentor=me` is whoever is reading, so a lens URL survives being shared. */
function readPerson(params: SearchParams, key: string, scope: FilterScope): string {
  const raw = readParam(params, key);
  return raw === "me" ? (scope.userId ?? "") : raw;
}

/**
 * "Whose students are these?" as a `where`, from the one definition of reach
 * (`mentorReachWhere`, `queries.ts`) — so a filtered list holds exactly the
 * people the mentor's own caseload holds. It stops at the caseload: the fifth
 * leg, everyone else in their programs, is who they may LOG against, which is
 * not what the `?mentor=` lens is asking.
 *
 * Programs arrive as ids without cohorts, which is what the lens offers, so a
 * pairing here is program-wide. A cohort-scoped pairing therefore reads one
 * program wide in this one place — the same answer the page gave before, and
 * narrower than it looks, since the pool leg is the only one it widens.
 */
function reachOf(
  mentorId: string,
  programIds?: readonly string[]
): Prisma.StudentProfileWhereInput {
  return mentorReachWhere(mentorId, {
    pairings: programIds?.map((programId) => ({
      programId,
      cohortId: null,
      levelId: null,
    })),
  });
}

/**
 * Everyone a mentor may work with — their caseload PLUS everyone else
 * enrolled in a program they are assigned to.
 *
 * This is the gate, not a lens: it is what a mentor reading the roster may
 * see at all, and it has to be the same answer `mentorReaches` gives, or the
 * roster hides a student whose page opens and whose session logs. A mentor
 * covering for a colleague clears the "Mine" chip and finds them here.
 */
function loggableBy(mentorId: string): Prisma.StudentProfileWhereInput {
  return mentorReachWhere(mentorId, { includeProgram: true });
}

/**
 * Students, filtered.
 *
 * Note what the `time` chips can and cannot do. "No time" and the two use-by
 * chips are questions about `HourAllocation` rows and so are real `where`
 * clauses; "overdrawn" is not, because it compares two sums across two
 * relations and neither Prisma nor SQLite will do that in a filter. That chip
 * is therefore absent rather than faked with a pass over every student in the
 * school, which is the mistake this whole layer exists to stop.
 *
 * "Expiring" is also narrower than the status of the same name: the status
 * requires unused minutes to remain, which is derived. The chip finds every
 * student with a use-by date inside the window, and the row's own chip then
 * says which of them still has something to lose.
 */
export function studentsWhere(
  params: SearchParams,
  scope: FilterScope,
  now: Date
): Prisma.StudentProfileWhereInput {
  const and: Prisma.StudentProfileWhereInput[] = [];

  // A student's program is an enrollment row, and they may hold several — so
  // "in my programs" is `some`, and a student in one program of mine and two of
  // yours appears once, here, without their other programs coming with them.
  if (scope.programIds) {
    and.push({ enrollments: { some: { programId: { in: [...scope.programIds] } } } });
  }
  if (scope.studentId) and.push({ id: scope.studentId });
  // The reader's own gate: everyone they may work with, which for a mentor is
  // their whole programs and not only their caseload. The `?mentor=` lens
  // below is the narrower question, and it is a filter the reader chose.
  if (scope.mentorId) and.push(loggableBy(scope.mentorId));

  const program = readParam(params, "program");
  // ANDed alongside the scope rather than checked against it: a program id from
  // outside the grant then matches nothing, which is the honest answer, and
  // there is no branch in which it could widen the query.
  if (program) and.push({ enrollments: { some: { programId: program } } });
  // Level and cohort narrow the same way — and land on the SAME enrollment as
  // each other and as the program: a student in Research / Advanced and in
  // Global Admissions / Spring 25 must not match "?level=advanced&cohort=s25"
  // by satisfying each half in a different program.
  const level = readParam(params, "level");
  const cohort = readParam(params, "cohort");
  if (level || cohort) {
    and.push({
      enrollments: {
        some: {
          ...(level ? { levelId: level } : {}),
          ...(cohort ? { cohortId: cohort } : {}),
          ...(program ? { programId: program } : {}),
        },
      },
    });
  }

  const mentor = readPerson(params, "mentor", scope);
  if (mentor) and.push(reachOf(mentor, scope.programIds));

  const status = readParam(params, "status");
  if (status === "pending") {
    and.push({ user: { status: USER_STATUS.PENDING } });
  } else if (status === "not-signed-in") {
    // Never having set a Telegram handle is the only signal a registered
    // student has not signed in yet, and a pending one has not been let in.
    and.push({
      telegramUsername: null,
      user: { status: { not: USER_STATUS.PENDING } },
    });
  }

  // Asked of the grants in the programs being read, not of every grant the
  // student holds: an admin of one program reading a two-program student was
  // told "no time" was false because of hours in a program they cannot see.
  // This is the coarse half — the page then asks `timeStateHolds` of the
  // figures it shows (`readTimeState`), which is the rule the bell counts by.
  const time = readTimeState(params);
  const today = startOfProgramDay(now);
  const grantScope = program
    ? { programId: program }
    : scope.programIds
      ? { programId: { in: [...scope.programIds] } }
      : {};
  if (time === "none") {
    and.push({ hourAllocations: { none: grantScope } });
  } else if (time === "expiring") {
    const days = EXPIRY_WINDOW_DAYS[scope.audience ?? "staff"];
    and.push({
      hourAllocations: {
        some: {
          ...grantScope,
          deadline: { gte: today, lte: endOfDay(new Date(today.getTime() + days * DAY_MS)) },
        },
      },
    });
  } else if (time === "expired") {
    and.push({ hourAllocations: { some: { ...grantScope, deadline: { lt: today } } } });
  }

  const search = searchWhere(STUDENT_SEARCH, readParam(params, "q"));
  if (search) and.push(search);

  return and.length > 0 ? { AND: and } : {};
}

/**
 * Mentors, filtered. The base condition is "is a mentor at all" — a plain
 * MENTOR or a dual-role admin — which is a fact about the list and not a
 * filter, so it is always present.
 */
export function mentorsWhere(
  params: SearchParams,
  scope: FilterScope
): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [
    { OR: [{ role: ROLES.MENTOR }, { isMentor: true }] },
  ];

  if (scope.programIds) {
    and.push({
      mentorAssignments: { some: { programId: { in: [...scope.programIds] } } },
    });
  }
  if (scope.mentorId) and.push({ id: scope.mentorId });

  const program = readParam(params, "program");
  if (program) and.push({ mentorAssignments: { some: { programId: program } } });

  if (readParam(params, "status") === "unassigned") {
    // The same test the bell's "not in any program" row makes
    // (`mentorStatuses`): never placed, OR placed nowhere. The account status
    // alone missed a mentor whose last pairing was removed, so the bell
    // counted three and this chip found one.
    and.push({
      OR: [{ status: USER_STATUS.UNASSIGNED }, { mentorAssignments: { none: {} } }],
    });
  }
  if (readParam(params, "link") === "missing") {
    // Scoped like everything else: a bare `calendlyUrl: null` would count a
    // missing link on a pairing in a program the reader doesn't administer —
    // the row came here through a grant, and so does the absence it reports.
    and.push({
      mentorAssignments: {
        some: {
          calendlyUrl: null,
          ...(scope.programIds
            ? { programId: { in: [...scope.programIds] } }
            : {}),
        },
      },
    });
  }

  const search = searchWhere(MENTOR_SEARCH, readParam(params, "q"));
  if (search) and.push(search);

  return { AND: and };
}

/** Logged sessions, filtered. */
export function sessionsWhere(
  params: SearchParams,
  scope: FilterScope,
  now: Date
): Prisma.SessionWhereInput {
  const and: Prisma.SessionWhereInput[] = [];

  // The session's own program, not its student's: a meeting drew ONE program's
  // hours down, and reaching it through a student who may be in two would put
  // the Master's Program's sessions on Global Admissions' list.
  if (scope.programIds) {
    and.push({ programId: { in: [...scope.programIds] } });
  }
  if (scope.mentorId) and.push({ mentorId: scope.mentorId });
  if (scope.studentId) and.push({ studentId: scope.studentId });

  const student = readParam(params, "student");
  if (student) and.push({ studentId: student });
  const mentor = readPerson(params, "mentor", scope);
  if (mentor) and.push({ mentorId: mentor });
  const program = readParam(params, "program");
  if (program) and.push({ programId: program });

  const date = dateWhere(readDateWindow(params, now));
  if (date) and.push({ date });

  const attendance = readChoice(params, "attendance", ATTENDANCE_VALUES);
  if (attendance) and.push(attendance);
  const kind = readChoice(params, "kind", KIND_VALUES);
  if (kind !== undefined) and.push({ withinPlan: kind });
  const status = readChoice(params, "status", SESSION_STATUS_VALUES);
  if (status) and.push({ status });

  const search = searchWhere(SESSION_SEARCH, readParam(params, "q"));
  if (search) and.push(search);

  return and.length > 0 ? { AND: and } : {};
}

/**
 * `?rating=`, read as the one-to-five window it names.
 *
 * `rating=1` is exactly one star — what clicking the 1-star bar on the
 * overview means, and what the page's 1-star count was promising. `rating=1-3`
 * is a window: "3 stars or fewer", which is how a low-scoring mentor is found
 * and the only shape this param used to have. Either end outside 1 to 5 is not
 * a rating this product can store, so it is not a filter; a window written
 * backwards is read the right way round.
 */
export function readRatingRange(
  params: SearchParams
): number | { gte: number; lte: number } | undefined {
  const match = /^([1-5])(?:-([1-5]))?$/.exec(readParam(params, "rating"));
  if (!match) return undefined;
  const a = Number(match[1]);
  if (match[2] === undefined) return a;
  const b = Number(match[2]);
  return { gte: Math.min(a, b), lte: Math.max(a, b) };
}

/** The rating `?rating=` names, in words: "1 star", "3 stars or fewer". */
export function ratingLabel(params: SearchParams): string | undefined {
  const range = readRatingRange(params);
  if (range === undefined) return undefined;
  if (typeof range === "number") return range === 1 ? "1 star" : `${range} stars`;
  if (range.gte === range.lte) return ratingLabel({ rating: String(range.gte) });
  if (range.gte === 1) return `${range.lte} stars or fewer`;
  if (range.lte === 5) return `${range.gte} stars or more`;
  return `${range.gte} to ${range.lte} stars`;
}

/** Which kind of rating `/feedback` is showing: one of the two, or both. */
export type RatingKind = "written" | "meetings";

/** `?kind=`, read as a rating kind, or nothing for both kinds pooled. */
export function readRatingKind(params: SearchParams): RatingKind | undefined {
  return readChoice<RatingKind>(params, "kind", {
    written: "written",
    meetings: "meetings",
  });
}

/**
 * Mentor feedback, filtered.
 *
 * The scope clause is on the STUDENT's enrollments, which is what closes the
 * cross-program leak at `leader/feedback/page.tsx:18-27`: a leader was scoped
 * by the MENTOR's program, so a comment written by a shared mentor about
 * another program's student was readable.
 *
 * A rating names no program of its own — it is an opinion about a mentor, not
 * about a course — so a student enrolled in two programs has their rating
 * readable by the admins of both. That is the same reach those admins already
 * have over the student, so it leaks nothing new.
 */
export function feedbackWhere(
  params: SearchParams,
  scope: FilterScope,
  now: Date
): Prisma.MentorFeedbackWhereInput {
  const and: Prisma.MentorFeedbackWhereInput[] = [];

  if (scope.programIds) {
    and.push({
      student: {
        enrollments: { some: { programId: { in: [...scope.programIds] } } },
      },
    });
  }
  if (scope.mentorId) and.push({ mentorId: scope.mentorId });
  if (scope.studentId) and.push({ studentId: scope.studentId });

  const mentor = readPerson(params, "mentor", scope);
  if (mentor) and.push({ mentorId: mentor });
  const program = readParam(params, "program");
  if (program) {
    and.push({ student: { enrollments: { some: { programId: program } } } });
  }

  const rating = readRatingRange(params);
  if (rating) and.push({ rating });

  const date = dateWhere(readDateWindow(params, now));
  if (date) and.push({ createdAt: date });

  const search = searchWhere(FEEDBACK_SEARCH, readParam(params, "q"));
  if (search) and.push(search);

  return and.length > 0 ? { AND: and } : {};
}

/**
 * The meetings a student has rated, through the same filter bar as
 * `feedbackWhere`, so one set of controls answers both lists on `/feedback`.
 *
 * Unlike a `MentorFeedback` row, a session names its program, so the scope
 * and the program filter ask the ROW (`programId`) rather than the student's
 * enrollments — a student in two programs rates each program's meetings, and
 * an admin of one reads only that one's. Only ACTIVE meetings: a voided or
 * rescheduled row is not a meeting that happened. The date window is when the
 * student answered, which is when the rating was given.
 */
export function meetingRatingsWhere(
  params: SearchParams,
  scope: FilterScope,
  now: Date
): Prisma.SessionWhereInput {
  const and: Prisma.SessionWhereInput[] = [
    { studentRating: { not: null } },
    { status: SESSION_STATUS.ACTIVE },
  ];

  if (scope.programIds) and.push({ programId: { in: [...scope.programIds] } });
  if (scope.mentorId) and.push({ mentorId: scope.mentorId });
  if (scope.studentId) and.push({ studentId: scope.studentId });

  const mentor = readPerson(params, "mentor", scope);
  if (mentor) and.push({ mentorId: mentor });
  const program = readParam(params, "program");
  if (program) and.push({ programId: program });

  const rating = readRatingRange(params);
  if (rating) and.push({ studentRating: rating });

  const date = dateWhere(readDateWindow(params, now));
  if (date) and.push({ studentAnsweredAt: date });

  const search = searchWhere(MEETING_RATING_SEARCH, readParam(params, "q"));
  if (search) and.push(search);

  return { AND: and };
}

/**
 * One person's notifications, filtered. `userId` is required rather than
 * optional: a feed with no owner is every user's private history in one list,
 * and that must not be expressible by forgetting an argument.
 */
export function notificationsWhere(
  params: SearchParams,
  scope: FilterScope & { userId: string }
): Prisma.NotificationWhereInput {
  const and: Prisma.NotificationWhereInput[] = [{ userId: scope.userId }];

  if (readParam(params, "read") === "unread") and.push({ read: false });

  const types = readChoice(params, "category", CATEGORY_TYPES);
  if (types) and.push({ type: { in: [...types] } });

  const search = searchWhere(NOTIFICATION_SEARCH, readParam(params, "q"));
  if (search) and.push(search);

  return { AND: and };
}

/* ----------------------------------------------------------------- words --- */

/** Singular and plural of what is being counted. */
export type Unit = { one: string; many: string };

/**
 * The count, in words, beside the Reset.
 *
 * A filtered list that does not say it is filtered is how someone concludes a
 * student was deleted, so the sentence always names the search or the fact that
 * filters are on. Returns "" for an unfiltered empty list, where the page's own
 * empty state has something truer to say than a zero.
 */
export function filterSummary(
  total: number,
  unit: Unit,
  params: SearchParams
): string {
  const q = readParam(params, "q");
  const filtered = activeFilterCount(params) > 0;
  const noun = total === 1 ? unit.one : unit.many;

  if (total === 0) {
    if (q) return `No ${unit.many} match “${q}”`;
    return filtered ? `No ${unit.many} match these filters` : "";
  }
  if (q) return `${total} ${noun} for “${q}”`;
  return filtered
    ? `${total} ${noun} ${total === 1 ? "matches" : "match"} these filters`
    : `${total} ${noun}`;
}
