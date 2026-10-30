import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_OPTIONS,
  DATE_PRESETS,
  FILTER_PARAMS,
  MENTOR_PRESETS,
  MINE_PRESET,
  SEARCH_PLACEHOLDER,
  STUDENT_PRESETS,
  activeFilterCount,
  feedbackWhere,
  filterHref,
  filterSummary,
  mentorsWhere,
  notificationsWhere,
  presetHref,
  presetIsActive,
  ratingLabel,
  readChoice,
  readDateWindow,
  readParam,
  resetHref,
  sessionsWhere,
  studentsWhere,
  type SearchParams,
} from "@/lib/filters";
import { EXPIRY_WINDOW_DAYS } from "@/lib/status";

/**
 * The URL layer, pinned.
 *
 * These are the rules that were wrong in a different way on each of the four
 * filter surfaces this replaces, which is why they are asserted rather than
 * described: a filter that loses the search, a search that loses the program, a
 * page number that survives a filter change, and a date window that is a day
 * short for five hours every night.
 *
 * `now` is always an argument here. Nothing in `filters.ts` may read the clock,
 * and a test that would pass on Tuesday and fail on Wednesday is how that rule
 * stops being true.
 */

/** 14:00 in Tashkent — an unremarkable afternoon, on both calendars. */
const NOW = new Date("2026-09-04T09:00:00Z");

/** The `where` clauses of a built filter, so a test can name one. */
function clauses<T>(where: { AND?: T | T[] }): T[] {
  const and = where.AND;
  if (Array.isArray(and)) return and;
  return and ? [and] : [];
}

/** Everything a search box looks in, flattened out of its OR. */
function searchedFields(where: { AND?: unknown }): string {
  const or = clauses<Record<string, unknown>>(where as { AND?: Record<string, unknown>[] }).find(
    (c) => "OR" in c
  );
  return JSON.stringify(or ?? null);
}

describe("empty and absent", () => {
  it("reads a missing param and an empty one as the same nothing", () => {
    // A GET form posts every field it owns, so pressing Apply with a blank box
    // produces `?q=&program=`. If that were not the same as no params at all,
    // every list would filter itself down to nothing the first time it was
    // submitted untouched.
    expect(readParam({}, "q")).toBe("");
    expect(readParam({ q: "" }, "q")).toBe("");
    expect(studentsWhere({ q: "", program: "" }, {}, NOW)).toEqual(
      studentsWhere({}, {}, NOW)
    );
  });

  it("trims what was typed, so a stray space still finds the student", () => {
    expect(readParam({ q: "  aziza " }, "q")).toBe("aziza");
    expect(searchedFields(studentsWhere({ q: "  aziza " }, {}, NOW))).toContain("aziza");
  });

  it("gives a repeated param one meaning instead of two", () => {
    // `?q=a&q=b` is not reachable through the form, but it is reachable by
    // hand, and two readers of the same URL must not disagree.
    expect(readParam({ q: ["first", "second"] }, "q")).toBe("first");
  });

  it("caps a hand-built value rather than posting a kilobyte into a LIKE", () => {
    expect(readParam({ q: "a".repeat(5000) }, "q")).toHaveLength(200);
  });
});

describe("hostile input", () => {
  it("ignores an unknown enum value instead of throwing", () => {
    const where = sessionsWhere({ attendance: "maybe", kind: "nonsense" }, {}, NOW);
    expect(clauses(where)).toEqual([]);
  });

  it("does not let a param name a property of Object.prototype", () => {
    // A plain `table[raw]` lookup answers `?status=constructor` with a
    // function, and the caller puts it in a query.
    expect(readChoice({ status: "constructor" }, "status", { active: "ACTIVE" })).toBeUndefined();
    expect(readChoice({ status: "toString" }, "status", { active: "ACTIVE" })).toBeUndefined();
  });

  it("refuses a date that does not exist rather than sliding to the next month", () => {
    // `new Date("2026-02-31")` is March 3. A regex alone would silently answer
    // a different question than the one in the URL.
    const window = readDateWindow({ from: "2026-02-31" }, NOW);
    expect(window.from).toBeUndefined();
    expect(window.fromValue).toBe("");
    expect(window.label).toBe("all time");
  });

  it("ignores a rating that is not one this product can store", () => {
    for (const rating of ["0", "6", "four", "-1", "3.5", "0-3", "2-6", "1-2-3"]) {
      expect(clauses(feedbackWhere({ rating }, {}, NOW))).toEqual([]);
    }
  });

  it("reads a bare rating as exactly that many stars", () => {
    expect(clauses(feedbackWhere({ rating: "3" }, {}, NOW))).toContainEqual({
      rating: 3,
    });
    expect(ratingLabel({ rating: "1" })).toBe("1 star");
    expect(ratingLabel({ rating: "4" })).toBe("4 stars");
  });

  it("reads a dash as a window, whichever way round it is written", () => {
    expect(clauses(feedbackWhere({ rating: "1-3" }, {}, NOW))).toContainEqual({
      rating: { gte: 1, lte: 3 },
    });
    expect(clauses(feedbackWhere({ rating: "3-1" }, {}, NOW))).toContainEqual({
      rating: { gte: 1, lte: 3 },
    });
    expect(ratingLabel({ rating: "1-3" })).toBe("3 stars or fewer");
    expect(ratingLabel({ rating: "4-5" })).toBe("4 stars or more");
    expect(ratingLabel({ rating: "2-4" })).toBe("2 to 4 stars");
    expect(ratingLabel({ rating: "2-2" })).toBe("2 stars");
    expect(ratingLabel({})).toBeUndefined();
  });
});

describe("the rest of the URL", () => {
  const params: SearchParams = { view: "logged", q: "essay", program: "p1", page: "4" };

  it("keeps every other filter when one of them changes", () => {
    // The three cards this replaces each dropped a different one of these.
    expect(filterHref("/sessions", params, { program: "p2" })).toBe(
      "/sessions?view=logged&q=essay&program=p2"
    );
  });

  it("drops the page number, because a new filter starts at its own first page", () => {
    // Page 4 of a one-page result is a blank screen that reads as data loss.
    expect(filterHref("/sessions", params, { q: "interview" })).not.toContain("page");
    expect(filterHref("/admin/feedback", { site: "3", page: "2" }, { q: "late" })).toBe(
      "/admin/feedback?q=late"
    );
  });

  it("removes a filter from the URL rather than leaving it behind empty", () => {
    expect(filterHref("/sessions", params, { q: undefined })).toBe(
      "/sessions?view=logged&program=p1"
    );
    expect(filterHref("/sessions", params, { q: "   " })).toBe(
      "/sessions?view=logged&program=p1"
    );
  });

  it("leaves a param the filter layer does not own alone, including on Reset", () => {
    // `view` is the Logged / Scheduled tab. Resetting the filters must not
    // throw the reader onto the other tab, which is why the bar needs no
    // "keep these" prop: it clears what it owns and nothing else.
    expect(resetHref("/sessions", params)).toBe("/sessions?view=logged");
    expect(resetHref("/students", { q: "aziza", time: "expiring" })).toBe("/students");
  });

  it("leaves a tab alone: Reset clears filters, it does not move you", () => {
    // `?read=unread` on `/notifications` is a TabLinks destination, and the
    // where builder still honours it — a param is read by whichever control
    // wrote it. Clearing the filters from the Unread tab must not silently
    // hand back the whole history.
    expect(resetHref("/notifications", { read: "unread", category: "tasks", q: "essay" })).toBe(
      "/notifications?read=unread"
    );
    expect(activeFilterCount({ read: "unread" })).toBe(0);
    expect(clauses(notificationsWhere({ read: "unread" }, { userId: "u1" }))).toContainEqual({
      read: false,
    });
  });

  it("keeps a key in the position it had, so a shared link stays stable", () => {
    expect(filterHref("/students", { program: "p1", q: "aziza" }, { q: "malika" })).toBe(
      "/students?program=p1&q=malika"
    );
  });
});

describe("preset chips", () => {
  const pending = STUDENT_PRESETS[0];
  const notSignedIn = STUDENT_PRESETS[1];

  it("turns on by setting its params and off by clearing them", () => {
    expect(presetIsActive({}, pending)).toBe(false);
    const on = presetHref("/students", { q: "a" }, pending);
    expect(on).toBe("/students?q=a&status=pending");

    const params = { q: "a", status: "pending" };
    expect(presetIsActive(params, pending)).toBe(true);
    expect(presetHref("/students", params, pending)).toBe("/students?q=a");
  });

  it("replaces a chip that writes the same param instead of stacking two", () => {
    // Pending and Not signed in are mutually exclusive states of one account
    // (`status.ts` reports the second only when the first is false), and they
    // share the `status` param so that fact needs no extra code.
    const href = presetHref("/students", { status: "pending" }, notSignedIn);
    expect(href).toBe("/students?status=not-signed-in");
    expect(presetIsActive({ status: "not-signed-in" }, pending)).toBe(false);
  });

  it("gives every preset a param this layer owns, or Reset would not clear it", () => {
    for (const preset of [...STUDENT_PRESETS, ...MENTOR_PRESETS, MINE_PRESET]) {
      for (const key of Object.keys(preset.params)) {
        expect(FILTER_PARAMS).toContain(key);
      }
    }
  });

  it("counts a date range as one narrowing, not two", () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ q: "aziza", program: "p1" })).toBe(2);
    expect(activeFilterCount({ from: "2026-08-01", to: "2026-08-31" })).toBe(1);
    expect(activeFilterCount({ to: "2026-08-31" })).toBe(1);
    // The page number is the page, not a filter — otherwise every paged list
    // would offer a Reset that only takes you back to page one.
    expect(activeFilterCount({ page: "3", view: "logged" })).toBe(0);
  });
});

describe("what the search box looks in", () => {
  it("searches a student by name and by sign-in email", () => {
    const where = searchedFields(studentsWhere({ q: "aziza" }, {}, NOW));
    expect(where).toContain('"name"');
    expect(where).toContain('"email"');
  });

  it("searches a session's note and its task, not only the two names", () => {
    // "When did we cover the Common App?" was unanswerable about data the app
    // already had: notes are the richest free text in the product and no box
    // reached them.
    const where = searchedFields(sessionsWhere({ q: "Common App" }, {}, NOW));
    expect(where).toContain('"note"');
    expect(where).toContain('"purpose"');
    expect(where).toContain('"student"');
    expect(where).toContain('"mentor"');
  });

  it("searches feedback by comment text, which is how a theme is found", () => {
    const where = searchedFields(feedbackWhere({ q: "scheduling" }, {}, NOW));
    expect(where).toContain('"comment"');
    expect(where).toContain('"mentor"');
  });

  it("searches a notification's message", () => {
    const where = searchedFields(notificationsWhere({ q: "deadline" }, { userId: "u1" }));
    expect(where).toContain('"message"');
  });

  it("names on the box exactly the fields it searches", () => {
    // The placeholder is generated from the same list the query is built from.
    // A box that says "Name or email" and searches only names is the defect
    // being removed, and it was invisible because the two lived apart.
    expect(SEARCH_PLACEHOLDER.students).toBe("Name or email");
    expect(SEARCH_PLACEHOLDER.sessions).toBe("Note, agenda, student or mentor");
    expect(SEARCH_PLACEHOLDER.feedback).toBe("Comment or mentor");
    expect(SEARCH_PLACEHOLDER.notifications).toBe("Message");
  });

  it("never asks SQLite for case-insensitive mode, which throws", () => {
    // SQLite's LIKE is already case-insensitive for ASCII, so `contains` alone
    // matches "aziza" to "Aziza". Prisma's `mode: "insensitive"` is not
    // supported on this provider and is a runtime error, not a no-op.
    const built = [
      studentsWhere({ q: "aziza" }, {}, NOW),
      mentorsWhere({ q: "malika" }, {}),
      sessionsWhere({ q: "essay" }, {}, NOW),
      feedbackWhere({ q: "late" }, {}, NOW),
      notificationsWhere({ q: "time" }, { userId: "u1" }),
    ];
    for (const where of built) {
      expect(JSON.stringify(where)).not.toContain("mode");
    }
  });

  it("adds no clause at all for a blank search", () => {
    // `{ OR: [] }` matches no rows in Prisma, so an empty box must produce no
    // OR rather than an empty one.
    expect(JSON.stringify(studentsWhere({ q: "" }, {}, NOW))).not.toContain("OR");
  });
});

describe("the date window", () => {
  it("bounds a preset at both ends, since a window that says 'last' cannot reach into tomorrow", () => {
    const window = readDateWindow({ period: "30d" }, NOW);
    expect(window.from).toEqual(new Date("2026-08-06T00:00:00.000Z"));
    expect(window.to).toEqual(new Date("2026-09-04T23:59:59.999Z"));
    expect(window.label).toBe("the last 30 days");
    expect(window.custom).toBe(false);
  });

  it("counts 30 days as 30 days, today included", () => {
    // The window this replaces subtracted 30 from today and so spanned 31
    // calendar days under a label that said 30.
    const { from, to } = readDateWindow({ period: "30d" }, NOW);
    const days = Math.round((to!.getTime() + 1 - from!.getTime()) / 86_400_000);
    expect(days).toBe(30);
  });

  it("ends the window on the program's today, not on UTC's", () => {
    // 02:00 in Tashkent on Sep 4 is 21:00 UTC on Sep 3 — a different calendar
    // day, and the five hours when a mentor is most likely to be catching up.
    // Read in UTC, every window here would be a day short.
    const earlyHours = new Date("2026-09-03T21:00:00Z");
    const window = readDateWindow({ period: "30d" }, earlyHours);
    expect(window.to).toEqual(new Date("2026-09-04T23:59:59.999Z"));
    expect(window.from).toEqual(new Date("2026-08-06T00:00:00.000Z"));
  });

  it("starts 'this year' at January 1 and names the year", () => {
    const window = readDateWindow({ period: "year" }, NOW);
    expect(window.from).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(window.label).toBe("2026");
  });

  it("lets a typed range beat a preset, because typing one is deliberate", () => {
    const window = readDateWindow({ period: "30d", from: "2026-08-03" }, NOW);
    expect(window.from).toEqual(new Date("2026-08-03T00:00:00.000Z"));
    expect(window.custom).toBe(true);
    expect(window.preset).toBeUndefined();
    // The two date fields show only what was typed, so a preset never puts
    // dates in them for the reader to accidentally submit.
    expect(window.fromValue).toBe("2026-08-03");
    expect(window.toValue).toBe("");
  });

  it("includes the whole of the closing day", () => {
    // Sessions are dated at UTC midnight and ratings carry a real timestamp;
    // an upper bound of midnight would silently drop an afternoon's rows.
    const window = readDateWindow({ from: "2026-08-03", to: "2026-08-03" }, NOW);
    expect(window.to).toEqual(new Date("2026-08-03T23:59:59.999Z"));
  });

  it("reads a backwards range the way it was plainly meant", () => {
    const window = readDateWindow({ from: "2026-08-20", to: "2026-08-03" }, NOW);
    expect(window.from).toEqual(new Date("2026-08-03T00:00:00.000Z"));
    expect(window.to).toEqual(new Date("2026-08-20T23:59:59.999Z"));
    expect(window.fromValue).toBe("2026-08-03");
  });

  it("reads This week as Monday to the end of today, on the program's clock", () => {
    // NOW is Friday 4 September 2026, 09:00 UTC — which is already the
    // afternoon in Tashkent, and the same calendar day either way.
    const window = readDateWindow({ period: "week" }, NOW);
    expect(window.from).toEqual(new Date("2026-08-31T00:00:00.000Z"));
    expect(window.to).toEqual(new Date("2026-09-04T23:59:59.999Z"));
    expect(window.label).toBe("this week");
  });

  it("puts Sunday in the week that started six days earlier, not its own", () => {
    // The one day an ISO week and a naive `day - 1` disagree about: getUTCDay
    // is 0 on Sunday, so subtracting it would leave Sunday as its own Monday.
    const sunday = new Date("2026-09-06T09:00:00Z");
    expect(readDateWindow({ period: "week" }, sunday).from).toEqual(
      new Date("2026-08-31T00:00:00.000Z")
    );
  });

  it("lets a date chip replace a typed range rather than losing to it", () => {
    // A typed range beats a preset, so a chip that only set `period` would
    // light up while the typed range went on deciding the answer.
    const thirty = DATE_PRESETS.find((p) => p.value === "30d")!;
    expect(presetIsActive({ period: "30d" }, thirty)).toBe(true);
    expect(presetIsActive({ period: "30d", from: "2026-08-01" }, thirty)).toBe(false);
    expect(presetHref("/sessions", { from: "2026-08-01", to: "2026-08-31" }, thirty)).toBe(
      "/sessions?period=30d"
    );
  });

  it("treats an unknown period as all time and adds no date clause", () => {
    expect(readDateWindow({ period: "forever" }, NOW).label).toBe("all time");
    expect(JSON.stringify(sessionsWhere({ period: "forever" }, {}, NOW))).not.toContain("date");
  });
});

describe("scope, which a param may narrow and never widen", () => {
  it("applies a leader's program grant with no params at all", () => {
    const where = studentsWhere({}, { programIds: ["p1", "p2"] }, NOW);
    expect(clauses(where)).toContainEqual({
      enrollments: { some: { programId: { in: ["p1", "p2"] } } },
    });
  });

  it("returns nothing for a program outside the grant, never the whole school", () => {
    const where = studentsWhere({ program: "p9" }, { programIds: ["p1"] }, NOW);
    // Both clauses stand, so the AND is unsatisfiable — there is no branch in
    // which a pasted id could replace the grant.
    expect(clauses(where)).toContainEqual({
      enrollments: { some: { programId: { in: ["p1"] } } },
    });
    expect(clauses(where)).toContainEqual({
      enrollments: { some: { programId: "p9" } },
    });
  });

  it("lets a mentor's roster reach their whole programs, not only their caseload", () => {
    // The gate and `mentorReaches` have to give the same answer: a student the
    // roster hid was still openable by URL and still loggable, which is how a
    // mentor covering for a colleague ended up asking an admin for a grant.
    const where = studentsWhere({}, { mentorId: "m1" }, NOW);
    const reach = clauses<{ OR?: unknown[] }>(where).find((c) => "OR" in c);

    expect(reach?.OR).toContainEqual({
      enrollments: {
        some: { program: { mentorAssignments: { some: { mentorId: "m1" } } } },
      },
    });
  });

  it("keeps the Mine chip narrower than the gate it sits inside", () => {
    // `?mentor=` is a lens the reader chose, and it means the caseload — the
    // people they hold time with — so it must NOT pick up the program leg.
    const where = studentsWhere({ mentor: "me" }, { mentorId: "m1", userId: "m1" }, NOW);
    const lenses = clauses<{ OR?: unknown[] }>(where).filter((c) => "OR" in c);
    const programLeg = {
      enrollments: {
        some: { program: { mentorAssignments: { some: { mentorId: "m1" } } } },
      },
    };

    expect(lenses).toHaveLength(2);
    expect(lenses.filter((l) => l.OR?.some((leg) => JSON.stringify(leg) === JSON.stringify(programLeg)))).toHaveLength(1);
  });

  it("keeps a mentor's lens on top of whatever they filter by", () => {
    const where = sessionsWhere({ mentor: "someone-else" }, { mentorId: "m1" }, NOW);
    expect(clauses(where)).toContainEqual({ mentorId: "m1" });
    expect(clauses(where)).toContainEqual({ mentorId: "someone-else" });
  });

  it("resolves the Mine chip to whoever is reading", () => {
    const where = sessionsWhere({ mentor: "me" }, { userId: "u7" }, NOW);
    expect(clauses(where)).toContainEqual({ mentorId: "u7" });
  });

  it("adds no filter for a Mine it cannot fill in", () => {
    // A signed-out or partly-built scope must not produce `mentorId: ""`,
    // which is a filter for a mentor who does not exist.
    expect(clauses(sessionsWhere({ mentor: "me" }, {}, NOW))).toEqual([]);
  });

  it("filters sessions by the program the SESSION was in", () => {
    // Not by the student's program: a student may be in two, and "this
    // program's sessions" has to mean the meetings that drew this program's
    // hours down rather than every meeting that person ever had.
    const where = sessionsWhere({ program: "p1" }, {}, NOW);
    expect(clauses(where)).toContainEqual({ programId: "p1" });
  });

  it("scopes feedback by the student's program, not the mentor's", () => {
    // The leak at `leader/feedback/page.tsx:18-27`: a leader was scoped by the
    // MENTOR's program, so a comment a shared mentor received about another
    // program's student was readable.
    const where = feedbackWhere({}, { programIds: ["p1"] }, NOW);
    expect(clauses(where)).toContainEqual({
      student: { enrollments: { some: { programId: { in: ["p1"] } } } },
    });
  });

  it("always pins a notification feed to its owner", () => {
    const where = notificationsWhere({ q: "" }, { userId: "u1" });
    expect(clauses(where)).toContainEqual({ userId: "u1" });
    expect(clauses(notificationsWhere({ read: "unread" }, { userId: "u1" }))).toContainEqual({
      read: false,
    });
  });
});

describe("presets as queries", () => {
  it("asks the two account questions apart", () => {
    expect(clauses(studentsWhere({ status: "pending" }, {}, NOW))).toContainEqual({
      user: { status: "PENDING" },
    });
    // Never having set a Telegram handle is the only signal a registered
    // student has not signed in; a pending one has not been let in yet, so the
    // two states cannot both be true of one row.
    expect(clauses(studentsWhere({ status: "not-signed-in" }, {}, NOW))).toContainEqual({
      telegramUsername: null,
      user: { status: { not: "PENDING" } },
    });
  });

  it("finds a student with no time granted, a grant set to 0 included", () => {
    expect(clauses(studentsWhere({ time: "none" }, {}, NOW))).toContainEqual({
      hourAllocations: { none: { minutes: { gt: 0 } } },
    });
  });

  it("uses the reader's own expiry window", () => {
    // Staff look 14 days ahead and a mentor 7 (`status.ts:147`). The chip and
    // the row's status chip have to agree about what "expiring" means, so both
    // read the one table.
    const staff = clauses(studentsWhere({ time: "expiring" }, { audience: "staff" }, NOW));
    const mentor = clauses(studentsWhere({ time: "expiring" }, { audience: "mentor" }, NOW));
    const upperBound = (list: object[]) =>
      JSON.parse(JSON.stringify(list))[0].hourAllocations.some.deadline.lte as string;
    expect(EXPIRY_WINDOW_DAYS.staff).toBeGreaterThan(EXPIRY_WINDOW_DAYS.mentor);
    expect(upperBound(staff)).toBe("2026-09-18T23:59:59.999Z");
    expect(upperBound(mentor)).toBe("2026-09-11T23:59:59.999Z");
  });

  it("finds time whose use-by date has already passed", () => {
    expect(clauses(studentsWhere({ time: "expired" }, {}, NOW))).toContainEqual({
      hourAllocations: { some: { deadline: { lt: new Date("2026-09-04T00:00:00.000Z") } } },
    });
  });

  it("filters attendance without pinning the session's status", () => {
    // Attendance here is `attendanceOf()` read backwards, not
    // `attendanceFields()` written out: those fields carry `status: ACTIVE`,
    // which would make "no-shows" and "voided" contradict each other and
    // return nothing, when a voided no-show is an ordinary row.
    const absent = clauses(sessionsWhere({ attendance: "absent", status: "voided" }, {}, NOW));
    expect(absent).toContainEqual({ attended: false });
    expect(absent).toContainEqual({ status: "VOIDED" });
  });

  it("keeps a rescheduled row out of the two 'they turned up' states", () => {
    // A rescheduled session keeps `attended: true` on purpose, so that a
    // corrected status lands its hours as delivered rather than as missed.
    expect(clauses(sessionsWhere({ attendance: "attended" }, {}, NOW))).toContainEqual({
      attended: true,
      late: false,
      status: { not: "RESCHEDULED" },
    });
    expect(ATTENDANCE_OPTIONS.map((o) => o.value)).toEqual([
      "attended",
      "late",
      "absent",
      "rescheduled",
    ]);
  });

  it("separates the two kinds of time without confusing them with a status", () => {
    expect(clauses(sessionsWhere({ kind: "extra" }, {}, NOW))).toContainEqual({
      withinPlan: false,
    });
    expect(clauses(sessionsWhere({ kind: "plan" }, {}, NOW))).toContainEqual({
      withinPlan: true,
    });
  });

  it("asks whether someone is a mentor before it asks anything else", () => {
    const where = mentorsWhere({ link: "missing" }, {});
    expect(clauses(where)[0]).toEqual({ OR: [{ role: "MENTOR" }, { isMentor: true }] });
    expect(clauses(where)).toContainEqual({
      mentorAssignments: { some: { calendlyUrl: null } },
    });
  });
});

describe("what the bar says about the list", () => {
  const students = { one: "student", many: "students" };

  it("says a filtered list is filtered", () => {
    // A list that has been narrowed and does not say so is how someone
    // concludes a student was deleted.
    expect(filterSummary(41, students, {})).toBe("41 students");
    expect(filterSummary(12, students, { program: "p1" })).toBe(
      "12 students match these filters"
    );
    expect(filterSummary(12, students, { q: "aziza" })).toBe("12 students for “aziza”");
  });

  it("names the search when nothing matched", () => {
    expect(filterSummary(0, students, { q: "aziza" })).toBe("No students match “aziza”");
    expect(filterSummary(0, students, { time: "expiring" })).toBe(
      "No students match these filters"
    );
  });

  it("stays quiet about an unfiltered empty list, which has its own empty state", () => {
    expect(filterSummary(0, students, {})).toBe("");
  });

  it("counts one of something in the singular", () => {
    expect(filterSummary(1, students, { q: "aziza" })).toBe("1 student for “aziza”");
  });
});
