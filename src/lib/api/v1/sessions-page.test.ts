import { describe, expect, it } from "vitest";

import type { Prisma, User } from "@/generated/prisma/client";
import {
  ledgerScope,
  readerFor,
  sessionFor,
  sessionsPage,
  sessionsQueryFrom,
  type Reader,
} from "@/lib/api/v1/sessions";
import type { SessionsPage, SessionsQuery } from "@/lib/api/v1/types";
import { SEARCH_PLACEHOLDER } from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import { admin, assignment, enroll, grant, mentor, program, student } from "@/test/db";

/**
 * The reader's ledger: which sessions a list holds, what it tells the reader
 * about each, and how it pages.
 *
 * Nothing here runs a session action, so unlike `sessions.test.ts` there is no
 * signed-in person to stand in for: a reader is built from a user row, and a
 * session is written straight to the table, dated and answered as the test
 * needs. The factory in `@/test/db` stores an instant (yesterday, at the
 * current time), which is no use for days or ties.
 */

/** A calendar day as the ledger stores it: UTC midnight. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** What a test says about a session it writes: its people, and whatever else it is about. */
type SessionData = Omit<Prisma.SessionUncheckedCreateInput, "minutes" | "date"> & { minutes?: number; date?: Date };

/** A session on October 20, for 60 minutes, unless the test says otherwise. */
const held = (data: SessionData) =>
  prisma.session.create({ data: { minutes: 60, date: day("2026-10-20"), ...data } });

/** A student, with the user row they sign in as. */
async function pupil(programId: string, name: string) {
  const profile = await student({ programId, name });
  return { profile, user: await prisma.user.findUniqueOrThrow({ where: { id: profile.userId } }) };
}

/** A page. Only the cursor tests expect a refusal, so anywhere else one fails the test. */
async function pageOf(reader: Reader, query: SessionsQuery = {}, now?: Date): Promise<SessionsPage> {
  const page = await sessionsPage(reader, query, now);
  if ("refused" in page) throw new Error(`refused on ${page.field}: ${page.refused}`);
  return page;
}

const idsOf = (page: SessionsPage) => page.items.map((item) => item.id);

/**
 * Every page of a list, by following its cursors to the end.
 *
 * A cursor that came back to the same place would loop here for good: the
 * database answers without waiting, so nothing ever lets the test's timeout run.
 * No list in this file has more than a few pages, so more than that is the failure.
 */
async function walk(reader: Reader, query: SessionsQuery): Promise<SessionsPage[]> {
  const pages: SessionsPage[] = [];
  let cursor: string | undefined;
  do {
    if (pages.length === 50) throw new Error("fifty pages and still a next one: the cursors go round in a circle");
    const page = await pageOf(reader, { ...query, cursor });
    pages.push(page);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return pages;
}

/** Each page of a list, by following its cursors to the end, as that page's ids. */
const pagesOf = async (reader: Reader, query: SessionsQuery) => (await walk(reader, query)).map(idsOf);

/** The order of the list: date, then when it was logged, then id, each the latest first. */
const inLedgerOrder = (rows: { id: string; date: Date; createdAt: Date }[]) =>
  [...rows]
    .sort(
      (a, b) =>
        b.date.getTime() - a.date.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        (a.id < b.id ? 1 : -1)
    )
    .map((row) => row.id);

/** A program with a student in it, and a mentor. */
async function cast() {
  const p = await program("Global Admissions");
  const aziz = await pupil(p.id, "Aziz Tursunov");
  const akmal = await mentor("Akmal Karimov");
  return { p, aziz, akmal };
}

/** The cast, and `count` sessions of the mentor's on one day, logged in threes at the same instant. */
async function crowded(count: number) {
  const { p, aziz, akmal } = await cast();
  const logged = new Date("2026-10-20T08:00:00.000Z").getTime();
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(
      await held({
        studentId: aziz.profile.id,
        mentorId: akmal.id,
        programId: p.id,
        date: day("2026-10-20"),
        createdAt: new Date(logged + Math.floor(i / 3)),
      })
    );
  }
  return { p, aziz, akmal, rows, reader: await readerFor(akmal) };
}

const NONE = { count: 0, charged: 0, missed: 0, extra: 0, voided: 0 };

describe("ledgerScope: whose sessions a list holds", () => {
  it("is a student's own, else the ones a mentor logged, else nothing", async () => {
    const { aziz, akmal } = await cast();
    expect(ledgerScope(await readerFor(aziz.user))).toEqual({ studentId: aziz.profile.id });
    expect(ledgerScope(await readerFor(akmal))).toEqual({ mentorId: akmal.id });
    expect(ledgerScope(await readerFor(await admin("Nodira Aliyeva")))).toBeNull();
  });

  it("gives an admin who also mentors the ones they logged", async () => {
    const both = await prisma.user.update({
      where: { id: (await admin("Nodira Aliyeva")).id },
      data: { isMentor: true },
    });
    expect(ledgerScope(await readerFor(both))).toEqual({ mentorId: both.id });
  });

  it("gives a student who also mentors their own, the student first as /me has it", async () => {
    const aziz = await pupil((await program()).id, "Aziz Tursunov");
    const both = await prisma.user.update({ where: { id: aziz.user.id }, data: { isMentor: true } });
    expect(ledgerScope(await readerFor(both))).toEqual({ studentId: aziz.profile.id });
  });

  it("as mentor, gives whoever can act as a mentor the ones they logged, and nobody else anything", async () => {
    const { p, aziz, akmal } = await cast();
    const both = await prisma.user.update({ where: { id: aziz.user.id }, data: { isMentor: true } });
    const nodira = await prisma.user.update({
      where: { id: (await admin("Nodira Aliyeva")).id },
      data: { isMentor: true },
    });
    expect(ledgerScope(await readerFor(both), "mentor")).toEqual({ mentorId: both.id });
    expect(ledgerScope(await readerFor(akmal), "mentor")).toEqual({ mentorId: akmal.id });
    expect(ledgerScope(await readerFor(nodira), "mentor")).toEqual({ mentorId: nodira.id });
    // A student who doesn't mentor, and an admin who doesn't: no list of the sessions they logged.
    expect(ledgerScope(await readerFor((await pupil(p.id, "Malika Rahimova")).user), "mentor")).toBeNull();
    expect(ledgerScope(await readerFor(await admin("Dilnoza Yusupova")), "mentor")).toBeNull();
  });

  it("gives a mentor who was once a student the ones they logged, and not their old record", async () => {
    const aziz = await pupil((await program()).id, "Aziz Tursunov");
    const grown = await prisma.user.update({ where: { id: aziz.user.id }, data: { role: "MENTOR" } });
    expect(ledgerScope(await readerFor(grown))).toEqual({ mentorId: grown.id });
  });

  it("gives an admin of a program nothing, because a program's sessions wait for Phase 4", async () => {
    const p = await program();
    const boss = await admin("Nodira Aliyeva");
    await grant({ userId: boss.id, programId: p.id });
    expect(ledgerScope(await readerFor(boss))).toBeNull();
  });
});

describe("sessionsPage: whose sessions", () => {
  it("a mentor gets only the sessions they logged, and a student only their own", async () => {
    const { p, aziz, akmal } = await cast();
    const malika = await pupil(p.id, "Malika Rahimova");
    const umid = await mentor("Umid Rashidov");
    const log = (student: typeof aziz, by: User, date: string) =>
      held({ studentId: student.profile.id, mentorId: by.id, programId: p.id, date: day(date) });
    const a1 = await log(aziz, akmal, "2026-10-20");
    const a2 = await log(malika, akmal, "2026-10-19");
    const u1 = await log(aziz, umid, "2026-10-18");
    const u2 = await log(malika, umid, "2026-10-17");

    const idsFor = async (user: User) => idsOf(await pageOf(await readerFor(user)));
    expect(await idsFor(akmal)).toEqual([a1.id, a2.id]);
    expect(await idsFor(umid)).toEqual([u1.id, u2.id]);
    expect(await idsFor(aziz.user)).toEqual([a1.id, u1.id]);
    expect(await idsFor(malika.user)).toEqual([a2.id, u2.id]);
  });

  it("gives a reader with no ledger an empty page, however many sessions there are", async () => {
    const { p, akmal } = await crowded(3);
    const boss = await admin("Nodira Aliyeva");
    await grant({ userId: boss.id, programId: p.id });
    expect(await pageOf(await readerFor(boss))).toEqual({
      items: [],
      nextCursor: null,
      totals: NONE,
      counts: { disputed: 0, voided: 0 },
      programs: [],
    });
    // The same three sessions are there for the mentor who logged them.
    expect((await pageOf(await readerFor(akmal))).items).toHaveLength(3);
  });

  it("answers each session in the shape the single read gives, mentor's note and all", async () => {
    const { p, aziz, akmal } = await cast();
    const task = await assignment({ studentId: aziz.profile.id, mentorId: akmal.id, purpose: "Main essay" });
    await held({
      studentId: aziz.profile.id,
      mentorId: akmal.id,
      programId: p.id,
      note: "Went through the essay.",
      assignmentId: task.id,
      studentAnswer: "DISPUTED",
      studentNote: "It was 30 minutes.",
    });
    const now = day("2026-10-22");

    for (const [user, note] of [
      [akmal, "Went through the essay."],
      [aziz.user, null],
    ] as const) {
      const reader = await readerFor(user);
      const page = await pageOf(reader, {}, now);
      expect(page.items).toHaveLength(1);
      expect(page.items[0].note).toBe(note);
      expect(page.items[0]).toEqual(await sessionFor(reader, page.items[0].id, now));
    }
  });
});

describe("sessionsPage: the filters", () => {
  it("a student's list carries no mentor note, and their q is ignored", async () => {
    const { p, aziz, akmal } = await cast();
    const base = { studentId: aziz.profile.id, mentorId: akmal.id, programId: p.id };
    await held({ ...base, note: "A secret worry about the visa." });
    await held({ ...base, note: "Went through the budget." });

    const page = await pageOf(await readerFor(aziz.user), { q: "secret" });
    expect(page.items.map((x) => x.note)).toEqual([null, null]);
    // q did not narrow, so the note was never searched: the one that doesn't say "secret" is here too.
    expect(page.items).toHaveLength(2);
    expect(page.totals.count).toBe(2);
    // The mentor's q does look in the notes.
    expect(await pageOf(await readerFor(akmal), { q: "secret" })).toMatchObject({ items: [{ note: expect.any(String) }] });
  });

  it("a student's student filter is ignored too, while a mentor's narrows to that student", async () => {
    const { p, aziz, akmal } = await cast();
    const malika = await pupil(p.id, "Malika Rahimova");
    const forAziz = await held({ studentId: aziz.profile.id, mentorId: akmal.id, programId: p.id });
    const forMalika = await held({ studentId: malika.profile.id, mentorId: akmal.id, programId: p.id });

    // Asking for somebody else's student id must not turn a student's own list into an empty one, or into a probe.
    expect(idsOf(await pageOf(await readerFor(aziz.user), { student: malika.profile.id }))).toEqual([forAziz.id]);
    expect(idsOf(await pageOf(await readerFor(akmal), { student: malika.profile.id }))).toEqual([forMalika.id]);
  });

  it("a mentor's q searches the note, the plan item and the student's name", async () => {
    const { p, aziz, akmal } = await cast();
    const malika = await pupil(p.id, "Malika Rahimova");
    const task = await assignment({ studentId: aziz.profile.id, mentorId: akmal.id, purpose: "Scholarship essay" });
    const base = { mentorId: akmal.id, programId: p.id };
    const noted = await held({ ...base, studentId: aziz.profile.id, note: "Common App activities list" });
    const planned = await held({ ...base, studentId: aziz.profile.id, assignmentId: task.id });
    const named = await held({ ...base, studentId: malika.profile.id, note: "Budget." });

    const reader = await readerFor(akmal);
    expect(idsOf(await pageOf(reader, { q: "Common App" }))).toEqual([noted.id]);
    expect(idsOf(await pageOf(reader, { q: "Scholarship" }))).toEqual([planned.id]);
    expect(idsOf(await pageOf(reader, { q: "Malika" }))).toEqual([named.id]);
    expect(idsOf(await pageOf(reader, { q: "nothing like this" }))).toEqual([]);
  });

  // `mentorSearch` (sessions.ts) is the website's `SESSION_SEARCH` (filters.ts)
  // without its mentor field, copied by hand, and nothing else fails when the
  // website's search changes. Its box's placeholder is made from its fields'
  // labels, so a field added there, or taken away, fails here first: then
  // `mentorSearch` must follow it, and this line with it.
  it("searches the fields of the website's own search, all but the mentor", () =>
    expect(SEARCH_PLACEHOLDER.sessions).toBe("Note, agenda, student or mentor"));

  it("a mentor's search never matches their own name", async () => {
    const { p, aziz, akmal } = await cast();
    const malika = await pupil(p.id, "Malika Rahimova");
    const base = { mentorId: akmal.id, programId: p.id };
    const forAziz = await held({ ...base, studentId: aziz.profile.id, note: "Budget.", date: day("2026-10-20") });
    const forMalika = await held({ ...base, studentId: malika.profile.id, note: "Visa.", date: day("2026-10-19") });

    const reader = await readerFor(akmal);
    // Every session on this list has this mentor, so a search that looked at their name would match all of them.
    for (const q of ["akm", "Akmal", "karimov"]) {
      const page = await pageOf(reader, { q });
      expect(idsOf(page), q).toEqual([]);
      // The figures are for the same search, not for the whole list.
      expect(page.totals.count, q).toBe(0);
    }
    // The student's name is still a way in.
    expect(idsOf(await pageOf(reader, { q: "aziz" }))).toEqual([forAziz.id]);
    // And a box with nothing but spaces in it is no search at all.
    expect(idsOf(await pageOf(reader, { q: "   " }))).toEqual([forAziz.id, forMalika.id]);
  });

  it("a mentor's search finds a student whose name starts like the mentor's, and only that student", async () => {
    const { p, aziz, akmal } = await cast();
    const akmaljon = await pupil(p.id, "Akmaljon Usmonov");
    const base = { mentorId: akmal.id, programId: p.id };
    await held({ ...base, studentId: aziz.profile.id, date: day("2026-10-20") });
    const first = await held({ ...base, studentId: akmaljon.profile.id, date: day("2026-10-19") });
    const second = await held({ ...base, studentId: akmaljon.profile.id, date: day("2026-10-18") });

    // "akm" starts Akmal Karimov too, who logged all three: a search that looked at his name would list them all.
    const page = await pageOf(await readerFor(akmal), { q: "akm" });
    expect(idsOf(page)).toEqual([first.id, second.id]);
    expect(page.totals.count).toBe(2);
  });

  it("narrows by program, in the reader's own sessions only", async () => {
    const ga = await program("Global Admissions");
    const ms = await program("Master's");
    const aziz = await pupil(ga.id, "Aziz Tursunov");
    await enroll({ studentId: aziz.profile.id, programId: ms.id });
    const akmal = await mentor("Akmal Karimov");
    const umid = await mentor("Umid Rashidov");
    const inGa = await held({ studentId: aziz.profile.id, mentorId: akmal.id, programId: ga.id });
    const inMs = await held({ studentId: aziz.profile.id, mentorId: akmal.id, programId: ms.id });
    const theirs = await held({ studentId: aziz.profile.id, mentorId: umid.id, programId: ms.id });

    const reader = await readerFor(akmal);
    expect(idsOf(await pageOf(reader, { program: ms.id }))).toEqual([inMs.id]);
    expect(idsOf(await pageOf(reader, { program: ga.id }))).toEqual([inGa.id]);
    // The student's own list reads the same program, and the other mentor's session is in it.
    expect(idsOf(await pageOf(await readerFor(aziz.user), { program: ms.id })).sort()).toEqual([inMs.id, theirs.id].sort());
  });

  it("narrows by the Tashkent week and by thirty days, counted from the day it is", async () => {
    const { p, aziz, akmal } = await cast();
    const on = (date: string) => held({ studentId: aziz.profile.id, mentorId: akmal.id, programId: p.id, date: day(date) });
    const [today, monday, sunday, edge, past] = [
      await on("2026-10-22"),
      await on("2026-10-19"),
      await on("2026-10-18"),
      await on("2026-09-23"),
      await on("2026-09-22"),
    ];
    // A Thursday afternoon in Tashkent.
    const now = new Date("2026-10-22T10:00:00.000Z");
    const reader = await readerFor(akmal);
    expect(idsOf(await pageOf(reader, { period: "week" }, now))).toEqual([today.id, monday.id]);
    expect(idsOf(await pageOf(reader, { period: "30d" }, now))).toEqual([today.id, monday.id, sunday.id, edge.id]);
    expect(idsOf(await pageOf(reader, {}, now))).toEqual([today, monday, sunday, edge, past].map((x) => x.id));
  });

  it("narrows by status, and a rescheduled session is in neither", async () => {
    const { p, aziz, akmal } = await cast();
    const base = { studentId: aziz.profile.id, mentorId: akmal.id, programId: p.id };
    const active = await held({ ...base, date: day("2026-10-20") });
    const voided = await held({ ...base, date: day("2026-10-19"), status: "VOIDED" });
    const moved = await held({ ...base, date: day("2026-10-18"), status: "RESCHEDULED" });

    const reader = await readerFor(akmal);
    expect(idsOf(await pageOf(reader, { status: "active" }))).toEqual([active.id]);
    expect(idsOf(await pageOf(reader, { status: "voided" }))).toEqual([voided.id]);
    expect(idsOf(await pageOf(reader))).toEqual([active.id, voided.id, moved.id]);
  });
});

describe("sessionsPage: answers", () => {
  /**
   * One kind of session each, dated against a `now` at midnight so that "30 days
   * old" is exactly that. The first four are the ones the website still asks
   * the student about, and `other` is another student's.
   */
  async function asked() {
    const { p, aziz, akmal } = await cast();
    const malika = await pupil(p.id, "Malika Rahimova");
    const base = { studentId: aziz.profile.id, mentorId: akmal.id, programId: p.id };
    const make = (days: number, rest: Partial<SessionData> = {}) =>
      held({ ...base, date: new Date(day("2026-10-22").getTime() - days * 86_400_000), ...rest });
    const rows = {
      twentyNine: await make(29),
      thirty: await make(30),
      thirtyOne: await make(31),
      today: await make(0),
      noShow: await make(0, { attended: false }),
      confirmed: await make(0, { studentAnswer: "CONFIRMED" }),
      disputed: await make(0, { studentAnswer: "DISPUTED" }),
      extra: await make(0, { withinPlan: false }),
      voided: await make(0, { status: "VOIDED" }),
      rescheduled: await make(0, { status: "RESCHEDULED" }),
      // Somebody else's student: only the mentor's list holds it.
      other: await held({ ...base, studentId: malika.profile.id, date: day("2026-10-22") }),
    };
    return { akmal, aziz, malika, rows, now: day("2026-10-22") };
  }

  it("answer=needed lists exactly the sessions needsAnswer marks", async () => {
    const { akmal, rows, now } = await asked();
    const reader = await readerFor(akmal);
    const needed = await pageOf(reader, { answer: "needed", limit: "100" }, now);

    // 29, 30 and 31 days old; confirmed, disputed; extra, voided, rescheduled → only the plain, recent, unanswered.
    expect(idsOf(needed).sort()).toEqual(
      [rows.twentyNine, rows.thirty, rows.today, rows.noShow, rows.other].map((x) => x.id).sort()
    );

    // And that is whatever needsAnswer says: at midnight, in the middle of the day, and either side of the
    // instant the last 30-day-old session stops being asked about.
    const HOUR = 3_600_000;
    const THIRTY_DAYS = 30 * 86_400_000;
    const instants = [now, new Date(now.getTime() + 10 * HOUR), ...[-1, 0, 1].map((ms) => new Date(now.getTime() + THIRTY_DAYS + ms))];
    for (const at of instants) {
      const everything = await pageOf(reader, { limit: "100" }, at);
      const marked = everything.items.filter((item) => item.needsAnswer).map((item) => item.id);
      const listed = idsOf(await pageOf(reader, { answer: "needed", limit: "100" }, at));
      expect(listed.sort(), at.toISOString()).toEqual(marked.sort());
    }
  });

  it("answer=needed in a student's list is theirs alone", async () => {
    const { aziz, rows, now } = await asked();
    const needed = await pageOf(await readerFor(aziz.user), { answer: "needed" }, now);
    expect(idsOf(needed).sort()).toEqual(
      [rows.twentyNine, rows.thirty, rows.today, rows.noShow].map((x) => x.id).sort()
    );
    expect(needed.items.every((item) => item.needsAnswer)).toBe(true);
  });

  it("answer=disputed lists what a student disputed, unless it was voided", async () => {
    const { akmal, aziz, rows, now } = await asked();
    const dispute = (extra: Partial<SessionData>) =>
      held({ studentId: aziz.profile.id, mentorId: akmal.id, programId: rows.today.programId, studentAnswer: "DISPUTED", ...extra });
    const disputedExtra = await dispute({ withinPlan: false });
    const disputedVoided = await dispute({ status: "VOIDED" });
    const disputedMoved = await dispute({ status: "RESCHEDULED" });

    const listed = idsOf(await pageOf(await readerFor(akmal), { answer: "disputed" }, now));
    expect(listed.sort()).toEqual([rows.disputed, disputedExtra, disputedMoved].map((x) => x.id).sort());
    expect(listed).not.toContain(disputedVoided.id);
  });
});

describe("sessionsPage: pages", () => {
  it("pages never repeat or skip a session, even thirty on one day", async () => {
    const { rows, reader } = await crowded(30);

    const pages = await pagesOf(reader, { limit: "7" });
    const ids = pages.flat();
    expect(pages.map((page) => page.length)).toEqual([7, 7, 7, 7, 2]);
    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30);
    // The same order one page of thirty gives, and the order the ledger promises.
    expect(ids).toEqual(idsOf(await pageOf(reader, { limit: "100" })));
    expect(ids).toEqual(inLedgerOrder(await prisma.session.findMany({ where: { id: { in: rows.map((r) => r.id) } } })));
  });

  it("breaks a tie on day and time by id, so a page can end in the middle of one", async () => {
    const { p, aziz, akmal } = await cast();
    const same = new Date("2026-10-20T08:00:00.000Z");
    for (let i = 0; i < 12; i++) {
      await held({ studentId: aziz.profile.id, mentorId: akmal.id, programId: p.id, createdAt: same });
    }
    const pages = await pagesOf(await readerFor(akmal), { limit: "5" });
    expect(pages.map((page) => page.length)).toEqual([5, 5, 2]);
    expect(new Set(pages.flat()).size).toBe(12);
  });

  /** Eight sessions, one a day from October 1, and page one of three. */
  async function eight() {
    const { p, aziz, akmal } = await cast();
    const base = { studentId: aziz.profile.id, mentorId: akmal.id, programId: p.id };
    const days = [];
    for (let d = 1; d <= 8; d++) days.push(await held({ ...base, date: day(`2026-10-0${d}`) }));
    const reader = await readerFor(akmal);
    const first = await pageOf(reader, { limit: "3" });
    // October 8, 7 and 6 are page one, and 5, 4 and 3 are what comes after.
    expect(idsOf(first)).toEqual([days[7].id, days[6].id, days[5].id]);
    return { base, days, reader, first };
  }

  it("a session logged between two pages doesn't move the next one", async () => {
    const { base, days, reader, first } = await eight();
    const newer = await held({ ...base, date: day("2026-10-09") });

    const second = await pageOf(reader, { limit: "3", cursor: first.nextCursor! });
    expect(idsOf(second)).toEqual([days[4].id, days[3].id, days[2].id]);
    const third = await pageOf(reader, { limit: "3", cursor: second.nextCursor! });
    expect(idsOf(third)).toEqual([days[1].id, days[0].id]);
    expect(third.nextCursor).toBeNull();
    // It is at the top of the list, where the first page starts.
    expect(idsOf(await pageOf(reader, { limit: "1" }))).toEqual([newer.id]);
  });

  it("needs no row to still exist, so the session the cursor came from may be deleted", async () => {
    const { days, reader, first } = await eight();
    await prisma.session.delete({ where: { id: days[5].id } });

    expect(idsOf(await pageOf(reader, { limit: "3", cursor: first.nextCursor! }))).toEqual([
      days[4].id,
      days[3].id,
      days[2].id,
    ]);
  });

  it("makes the cursor the base64url of the last item's day, logged-at instant and id", async () => {
    const { reader, rows } = await crowded(5);
    const page = await pageOf(reader, { limit: "2" });
    const last = rows.find((row) => row.id === page.items[1].id)!;

    expect(page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(page.nextCursor!, "base64url").toString("utf8"))).toEqual([
      last.date.toISOString(),
      last.createdAt.toISOString(),
      last.id,
    ]);
  });

  it("has no next cursor on the last page, even when it is exactly full", async () => {
    const { reader } = await crowded(7);
    expect((await pageOf(reader, { limit: "7" })).nextCursor).toBeNull();
    expect((await pageOf(reader, { limit: "6" })).nextCursor).not.toBeNull();
    expect(await pageOf(await readerFor(await mentor("Umid Rashidov")))).toMatchObject({ items: [], nextCursor: null });
  });

  it("takes a limit of 1 to 100, and 25 when it is left out or out of range", async () => {
    const { reader } = await crowded(30);
    const sizes: [string | undefined, number][] = [
      [undefined, 25],
      ["", 25],
      ["1", 1],
      ["7", 7],
      ["100", 30],
      ["101", 25],
      ["0", 25],
      ["-5", 25],
      ["abc", 25],
      ["7.5", 25],
      ["1e1", 25],
    ];
    for (const [limit, size] of sizes) {
      expect((await pageOf(reader, { limit })).items, `limit ${limit}`).toHaveLength(size);
    }
  });

  it("treats an empty cursor as the first page", async () => {
    const { reader } = await crowded(3);
    expect(await pageOf(reader, { cursor: "" })).toEqual(await pageOf(reader));
  });

  it("an unreadable cursor is refused on cursor", async () => {
    const { reader } = await crowded(2);
    const when = "2026-10-20T00:00:00.000Z";
    const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const refused = { refused: "Load the list again.", field: "cursor" };

    expect(await sessionsPage(reader, { cursor: "%%%" })).toEqual(refused);
    for (const cursor of [
      Buffer.from("not json at all").toString("base64url"),
      encoded({ date: when, createdAt: when, id: "x" }),
      encoded([when, when]),
      encoded([when, when, "x", "y"]),
      // Not a list, whatever it says about its length: it must not get as far as being taken apart.
      encoded({ length: 3 }),
      encoded(["yesterday", when, "x"]),
      encoded([when, "never", "x"]),
      // Only an instant the list itself wrote is one it reads back.
      encoded(["2026-10-20", when, "x"]),
      encoded([when, when, 7]),
      encoded([when, when, ""]),
    ]) {
      expect(await sessionsPage(reader, { cursor }), cursor).toEqual(refused);
    }
  });
});

describe("sessionsPage: totals", () => {
  it("totals cover the whole filter, not the page", async () => {
    const { reader } = await crowded(30);
    const page = await pageOf(reader, { limit: "7" });
    expect(page.items).toHaveLength(7);
    expect(page.totals).toEqual({ count: 30, charged: 1800, missed: 0, extra: 0, voided: 0 });
    // And not what is left after the cursor: the last page of all, with two sessions on it, says the same.
    const pages = await walk(reader, { limit: "7" });
    const end = pages[pages.length - 1];
    expect(end.items).toHaveLength(2);
    expect(end.totals).toEqual(page.totals);
  });

  /** One of each kind of session a mentor can have, 60 minutes or less. */
  async function mixed() {
    const { p, aziz, akmal } = await cast();
    const base = { studentId: aziz.profile.id, mentorId: akmal.id, programId: p.id };
    await held({ ...base, minutes: 60 });
    await held({ ...base, minutes: 30, late: true });
    await held({ ...base, minutes: 45, attended: false });
    await held({ ...base, minutes: 20, withinPlan: false });
    await held({ ...base, minutes: 10, withinPlan: false, attended: false });
    await held({ ...base, minutes: 50, status: "VOIDED" });
    await held({ ...base, minutes: 25, status: "VOIDED", withinPlan: false, attended: false });
    await held({ ...base, minutes: 15, status: "RESCHEDULED" });
    return { reader: await readerFor(akmal), now: day("2026-10-22") };
  }

  it("adds up what is charged, missed, extra and voided as the website's sessions page does", async () => {
    const { reader, now } = await mixed();
    expect((await pageOf(reader, {}, now)).totals).toEqual({
      // Every session the filter matches, a rescheduled one too.
      count: 8,
      // In the plan and active: 60 + 30 + 45.
      charged: 135,
      // Charged, and nobody came.
      missed: 45,
      // Active and out of the plan, whether or not they came.
      extra: 30,
      // Voided, whatever else they were.
      voided: 75,
    });
  });

  it("follows the filter: status and answer narrow the totals as they narrow the list", async () => {
    const { reader, now } = await mixed();
    const totals = async (query: SessionsQuery) => (await pageOf(reader, query, now)).totals;
    expect(await totals({ status: "active" })).toEqual({ count: 5, charged: 135, missed: 45, extra: 30, voided: 0 });
    expect(await totals({ status: "voided" })).toEqual({ count: 2, charged: 0, missed: 0, extra: 0, voided: 75 });
    expect(await totals({ answer: "needed" })).toEqual({ count: 3, charged: 135, missed: 45, extra: 0, voided: 0 });
    expect(await totals({ answer: "disputed" })).toEqual(NONE);
  });
});

describe("sessionsPage: counts", () => {
  it("counts the two chips over the filter without its period, status and answer", async () => {
    const ga = await program("Global Admissions");
    const ms = await program("Master's");
    const aziz = await pupil(ga.id, "Aziz Tursunov");
    const malika = await pupil(ms.id, "Malika Rahimova");
    const akmal = await mentor("Akmal Karimov");
    const inGa = { studentId: aziz.profile.id, mentorId: akmal.id, programId: ga.id };
    const inMs = { studentId: malika.profile.id, mentorId: akmal.id, programId: ms.id };
    const DISPUTED = { studentAnswer: "DISPUTED" };
    await held({ ...inGa, ...DISPUTED, note: "visa question" });
    await held({ ...inGa, ...DISPUTED, date: day("2026-03-02") });
    await held({ ...inMs, ...DISPUTED, status: "VOIDED" });
    await held({ ...inMs, ...DISPUTED, status: "RESCHEDULED" });
    await held({ ...inGa, status: "VOIDED" });
    await held({ ...inGa, status: "VOIDED", date: day("2026-03-02") });
    await held({ ...inGa, studentAnswer: "CONFIRMED" });
    await held({ ...inMs });

    const reader = await readerFor(akmal);
    const now = day("2026-10-22");
    const counts = async (query: SessionsQuery) => (await pageOf(reader, query, now)).counts;
    // A dispute on a voided session is not disputed any more; it is voided.
    expect(await counts({})).toEqual({ disputed: 3, voided: 3 });
    // A chip replaces the period, so a period, a status or an answer never changes what a chip says.
    for (const query of [{ period: "week" }, { status: "active" }, { status: "voided" }, { answer: "needed" }] as const) {
      expect(await counts(query), JSON.stringify(query)).toEqual({ disputed: 3, voided: 3 });
    }
    // What is left of the filter does narrow them.
    expect(await counts({ program: ga.id })).toEqual({ disputed: 2, voided: 2 });
    expect(await counts({ program: ms.id })).toEqual({ disputed: 1, voided: 1 });
    expect(await counts({ student: aziz.profile.id })).toEqual({ disputed: 2, voided: 2 });
    expect(await counts({ q: "visa" })).toEqual({ disputed: 1, voided: 0 });
    // And a student's chips count their own sessions, and nobody else's.
    expect((await pageOf(await readerFor(aziz.user), {}, now)).counts).toEqual({ disputed: 2, voided: 2 });
  });
});

describe("sessionsPage: programs", () => {
  it("lists the programs of the reader's own sessions once each, by name, whatever the filter", async () => {
    // Made in the reverse of the order they are listed in, so that order is the query's and not the table's.
    const sat = await program("SAT");
    const ms = await prisma.program.create({ data: { name: "Master's", colorIndex: 5 } });
    const ga = await prisma.program.create({ data: { name: "Global Admissions", colorIndex: 3 } });
    const aziz = await pupil(ga.id, "Aziz Tursunov");
    await enroll({ studentId: aziz.profile.id, programId: ms.id });
    const malika = await pupil(ga.id, "Malika Rahimova");
    const akmal = await mentor("Akmal Karimov");
    const umid = await mentor("Umid Rashidov");
    const by = (m: User, s: typeof aziz, programId: string, rest: Partial<SessionData> = {}) =>
      held({ studentId: s.profile.id, mentorId: m.id, programId, ...rest });
    await by(akmal, aziz, ms.id);
    await by(akmal, aziz, ga.id);
    await by(akmal, malika, ga.id, { status: "VOIDED" });
    await by(umid, malika, sat.id);

    const refs = (...list: (typeof ga)[]) => list.map(({ id, name, colorIndex }) => ({ id, name, colorIndex }));
    const reader = await readerFor(akmal);
    expect((await pageOf(reader)).programs).toEqual(refs(ga, ms));
    // None of the narrowing changes what the program menu offers.
    expect((await pageOf(reader, { program: ms.id })).programs).toEqual(refs(ga, ms));
    expect((await pageOf(reader, { status: "voided", period: "week", q: "no match" }, day("2026-10-22"))).programs).toEqual(
      refs(ga, ms)
    );
    // A student's are the programs of their own sessions, and not the other mentor's.
    expect((await pageOf(await readerFor(aziz.user))).programs).toEqual(refs(ga, ms));
    expect((await pageOf(await readerFor(malika.user))).programs).toEqual(refs(ga, sat));
    expect((await pageOf(await readerFor(umid))).programs).toEqual(refs(sat));
  });
});

describe("sessionsQueryFrom: the URL as a query", () => {
  it("reads the nine things a list may be asked", () => {
    const query = sessionsQueryFrom(
      new URL(
        "http://test/api/v1/sessions?cursor=abc&limit=7&student=s1&program=p1&period=30d&status=voided&answer=disputed&q=essay&as=mentor"
      ).searchParams
    );
    expect(query).toEqual({
      cursor: "abc",
      limit: "7",
      student: "s1",
      program: "p1",
      period: "30d",
      status: "voided",
      answer: "disputed",
      q: "essay",
      as: "mentor",
    });
  });

  it("leaves out what is not asked, what is not one of the words, and every filter the contract doesn't have", () => {
    const query = sessionsQueryFrom(
      new URL(
        // `as=admin` is Phase 4's, and not a word yet.
        "http://test/api/v1/sessions?period=forever&status=rescheduled&answer=all&as=admin&mentor=me&attendance=absent&kind=extra&from=2026-01-01&to=2026-02-01&page=2"
      ).searchParams
    );
    expect(query).toEqual({});
    expect(sessionsQueryFrom(new URLSearchParams())).toEqual({});
  });

  it("takes no name that every object has for a word", () =>
    expect(
      sessionsQueryFrom(new URLSearchParams("period=toString&status=constructor&answer=__proto__&as=valueOf"))
    ).toEqual({}));

  it("takes the first of a repeated key, as the website's filters do", () => {
    expect(sessionsQueryFrom(new URLSearchParams("q=first&q=second&status=active&status=voided"))).toEqual({
      q: "first",
      status: "active",
    });
  });
});
