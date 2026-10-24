import { describe, expect, it } from "vitest";

import type { Program, User } from "@/generated/prisma/client";
import { studentHomeFor } from "@/lib/api/v1/student-home";
import { toTodoRow } from "@/lib/api/v1/todo";
import type { StudentHome } from "@/lib/api/v1/types";
import { studentRows } from "@/lib/attention";
import { formatDate, toDateInputValue } from "@/lib/format";
import { allocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { studentLedger } from "@/lib/queries";
import { programToday } from "@/lib/when";
import { assignment, cohort, DAY, enroll, mentor, NOW, pairing, program, session, student, studentTask } from "@/test/db";

/**
 * The student's home: their hours, the booking link of each mentor they hold
 * time with, and the list the website's "Things to check" shows them.
 *
 * Every figure is one the website already shows, asked of the same functions
 * (`allocationSummary`, `studentRows`). These tests hold the app's home to the
 * website's rules where they are easy to get wrong: all of a student's programs
 * are one balance, a booking link belongs to a mentor in a program, a session to
 * confirm is counted before the roll-up folds it away, and neither what was paid
 * nor what a mentor wrote about a session reaches the student's phone.
 */

/** `n` program days from today, stored the way a deadline is: the day, at UTC midnight. */
const dayIn = (n: number) => new Date(Date.parse(`${programToday(NOW)}T00:00:00.000Z`) + n * DAY);

/** The account behind a student record, as `getCurrentUser` hands it over. */
const accountOf = (st: { userId: string }) => prisma.user.findUniqueOrThrow({ where: { id: st.userId } });

/** The home of `st`, who is a student and so always has one. */
async function homeOf(st: { userId: string }): Promise<StudentHome> {
  const home = await studentHomeFor(await accountOf(st), NOW);
  if (!home) throw new Error("a student has a home");
  return home;
}

/**
 * `m` paired with `p`, or with one cohort of it, made at `madeAt`. The link is
 * what a student books through; null is a pairing that has none yet.
 */
async function paired(
  m: User,
  p: Program,
  opts: { link?: string | null; cohortId?: string; madeAt?: Date } = {}
) {
  const pair = await pairing({ mentorId: m.id, programId: p.id, cohortId: opts.cohortId });
  return prisma.mentorAssignment.update({
    where: { id: pair.id },
    data: {
      calendlyUrl: opts.link === undefined ? "https://calendly.com/akmal-karimov" : opts.link,
      ...(opts.madeAt ? { createdAt: opts.madeAt } : {}),
    },
  });
}

/** `minutes` held with `m` in `p` until `endsInDays` program days from today. */
const grantTo = (st: { id: string }, m: User, p: Program, minutes: number, endsInDays = 60) =>
  prisma.hourAllocation.create({
    data: { studentId: st.id, programId: p.id, mentorId: m.id, minutes, deadline: dayIn(endsInDays) },
  });

/**
 * A student the website has nothing to say about: signed in, 10 hours held with
 * a mentor who has a booking link, and no deadline near. Whatever a test adds is
 * then all that "Things to check" holds.
 */
async function settled() {
  const p = await program("Global Admissions");
  const m = await mentor("Akmal Karimov");
  await paired(m, p);
  const st = await student({ programId: p.id, name: "Aziz Tursunov" });
  await prisma.studentProfile.update({ where: { id: st.id }, data: { telegramUsername: "aziz" } });
  await grantTo(st, m, p, 600);
  return { p, m, st };
}

/** A session `w.m` logged for `w.st`, `daysAgo` days back, with whatever else a test says about it. */
async function logged(
  w: { p: Program; m: User; st: { id: string } },
  opts: { minutes?: number; daysAgo?: number; note?: string; answer?: string; status?: string; withinPlan?: boolean } = {}
) {
  const created = await session({
    studentId: w.st.id,
    programId: w.p.id,
    mentorId: w.m.id,
    minutes: opts.minutes ?? 60,
    status: opts.status,
    withinPlan: opts.withinPlan,
  });
  return prisma.session.update({
    where: { id: created.id },
    data: { date: dayIn(-(opts.daysAgo ?? 2)), note: opts.note ?? null, studentAnswer: opts.answer ?? null },
  });
}

describe("studentHomeFor: the figures", () => {
  it("sums the student's hours across programs, as the website does", async () => {
    const gp = await program("Global Admissions");
    const mp = await program("Master's Program");
    const m = await mentor("Akmal Karimov");
    const st = await student({ programId: gp.id, name: "Aziz Tursunov" });
    await enroll({ studentId: st.id, programId: mp.id });
    await grantTo(st, m, gp, 300);
    await grantTo(st, m, mp, 120);
    await session({ studentId: st.id, programId: gp.id, mentorId: m.id, minutes: 60 });
    // Another student's time with the same mentor is theirs, not Aziz's.
    const other = await student({ programId: gp.id, name: "Malika Rahimova" });
    await grantTo(other, m, gp, 900);

    expect((await homeOf(st)).hours).toEqual({ allotted: 420, used: 60, remaining: 360, forfeited: 0, extra: 0 });
  });

  it("counts time that expired unused and time given on top of the plan, as the website does", async () => {
    const gp = await program("Global Admissions");
    const mp = await program("Master's Program");
    const m = await mentor("Akmal Karimov");
    const st = await student({ programId: gp.id, name: "Aziz Tursunov" });
    await enroll({ studentId: st.id, programId: mp.id });
    await grantTo(st, m, gp, 300);
    // Ended three days ago, with 100 of its 120 minutes unused.
    await grantTo(st, m, mp, 120, -3);
    await session({ studentId: st.id, programId: gp.id, mentorId: m.id, minutes: 60 });
    await session({ studentId: st.id, programId: gp.id, mentorId: m.id, minutes: 20, withinPlan: false });
    await session({ studentId: st.id, programId: mp.id, mentorId: m.id, minutes: 20 });

    // 420 given, 80 used and 100 lost leaves 240. The 20 given on top charged nothing.
    expect((await homeOf(st)).hours).toEqual({ allotted: 420, used: 80, remaining: 240, forfeited: 100, extra: 20 });
  });

  it("says which time expires next, with only the minutes that expire then", async () => {
    const p = await program("Global Admissions");
    const [soon, later] = [await mentor("Akmal Karimov"), await mentor("Umid Rashidov")];
    const st = await student({ programId: p.id, name: "Aziz Tursunov" });
    await grantTo(st, soon, p, 300, 10);
    await grantTo(st, later, p, 600, 60);
    await session({ studentId: st.id, programId: p.id, mentorId: soon.id, minutes: 100 });

    // 800 minutes are left in all, but only the 200 behind the tenth day expire on it.
    const home = await homeOf(st);
    expect(home.hours.remaining).toBe(800);
    expect(home.expiring).toEqual({ minutes: 200, day: toDateInputValue(dayIn(10)) });
  });

  it("answers a student with no time yet with nothing to show for it", async () => {
    const st = await student({ name: "Aziz Tursunov" });
    const home = await homeOf(st);
    expect(home).toMatchObject({
      hours: { allotted: 0, used: 0, remaining: 0, forfeited: 0, extra: 0 },
      expiring: null,
      grants: [],
      toConfirm: 0,
    });
    // The website has something to say to a student with no hours, and so has the app.
    expect(home.todo.map((row) => row.type)).toContain("BALANCE_NONE");
  });
});

describe("studentHomeFor: the grants", () => {
  it("describes a grant in the contract's words, and says nothing of what was paid for it", async () => {
    const w = await settled();
    await prisma.program.update({ where: { id: w.p.id }, data: { colorIndex: 3 } });
    await prisma.hourAllocation.updateMany({ where: { studentId: w.st.id }, data: { amountPaid: 7654321.5 } });
    await session({ studentId: w.st.id, programId: w.p.id, mentorId: w.m.id, minutes: 90 });

    const home = await homeOf(w.st);
    expect(home.grants).toEqual([
      {
        mentor: { id: w.m.id, name: "Akmal Karimov" },
        bank: false,
        program: { id: w.p.id, name: "Global Admissions", colorIndex: 3 },
        allocated: 600,
        remaining: 510,
        forfeited: 0,
        expired: false,
        useBy: toDateInputValue(dayIn(60)),
        daysLeft: 60,
        bookingUrl: "https://calendly.com/akmal-karimov",
      },
    ]);
    const sent = JSON.stringify(home);
    // What a student paid is the school's business, in the grant and in the total.
    expect(sent).not.toContain("7654321");
    expect(sent).not.toMatch(/paid/i);
    // An instant that was not turned into a day would not survive this.
    expect(JSON.parse(sent)).toEqual(home);
  });

  it("names a mentor by their email when they have no name", async () => {
    const w = await settled();
    const { email } = await prisma.user.update({ where: { id: w.m.id }, data: { name: null } });
    expect((await homeOf(w.st)).grants[0].mentor).toEqual({ id: w.m.id, name: email });
  });

  it("says how many days are left, and when a grant has run out", async () => {
    const gp = await program("Global Admissions");
    const mp = await program("Master's Program");
    const m = await mentor("Akmal Karimov");
    const st = await student({ programId: gp.id, name: "Aziz Tursunov" });
    await enroll({ studentId: st.id, programId: mp.id });
    await grantTo(st, m, gp, 300, 10);
    await grantTo(st, m, mp, 120, -3);

    // In the website's order: by program name.
    const { grants } = await homeOf(st);
    expect(grants.map((g) => g.program.name)).toEqual(["Global Admissions", "Master's Program"]);
    expect(grants[0]).toMatchObject({ useBy: toDateInputValue(dayIn(10)), daysLeft: 10, expired: false });
    // Nothing of its 120 minutes was used, and none of them can be now.
    expect(grants[1]).toMatchObject({
      useBy: toDateInputValue(dayIn(-3)),
      daysLeft: -3,
      expired: true,
      remaining: 0,
      forfeited: 120,
    });
  });

  it("gives time no mentor holds a grant of its own, with no mentor and no link", async () => {
    const gp = await program("Global Admissions");
    const mp = await program("Master's Program");
    const st = await student({ programId: gp.id, name: "Aziz Tursunov" });
    await enroll({ studentId: st.id, programId: mp.id });
    // An hour bank in one program, and time nobody has been chosen for in the other.
    // Both are inside the balance, so both are in the list that explains it.
    await prisma.hourAllocation.create({
      data: { studentId: st.id, programId: gp.id, mentorId: null, minutes: 120, deadline: dayIn(60), isBank: true },
    });
    await prisma.hourAllocation.create({
      data: { studentId: st.id, programId: mp.id, mentorId: null, minutes: 90, deadline: dayIn(60) },
    });

    const home = await homeOf(st);
    expect(home.hours.remaining).toBe(210);
    expect(home.grants.map((g) => [g.program.name, g.mentor, g.allocated, g.remaining, g.bookingUrl])).toEqual([
      ["Global Admissions", null, 120, 120, null],
      ["Master's Program", null, 90, 90, null],
    ]);
  });

  it("an hour bank and unassigned time are told apart", async () => {
    const gp = await program("Global Admissions");
    const mp = await program("Master's Program");
    const rp = await program("Research");
    const m = await mentor("Akmal Karimov");
    const st = await student({ programId: gp.id, name: "Aziz Tursunov" });
    await enroll({ studentId: st.id, programId: mp.id });
    await enroll({ studentId: st.id, programId: rp.id });
    // A mentor's time, time nobody has been chosen for yet, and an hour bank, one in
    // each program: the order is then the programs' name, and not a tie between rows
    // made in the same millisecond.
    await grantTo(st, m, gp, 300);
    await prisma.hourAllocation.create({
      data: { studentId: st.id, programId: mp.id, mentorId: null, minutes: 90, deadline: dayIn(60) },
    });
    await prisma.hourAllocation.create({
      data: { studentId: st.id, programId: rp.id, mentorId: null, minutes: 120, deadline: dayIn(60), isBank: true },
    });

    const { grants } = await homeOf(st);
    // The unassigned time and the bank both have no mentor; only `bank` says which is which.
    expect(grants.map((g) => [g.program.name, g.mentor?.name ?? null, g.allocated, g.bank])).toEqual([
      ["Global Admissions", "Akmal Karimov", 300, false],
      ["Master's Program", null, 90, false],
      ["Research", null, 120, true],
    ]);
  });

  it("names a mentor who logged time without a grant of their own, with the overdraw it is", async () => {
    const w = await settled();
    const other = await mentor("Umid Rashidov");
    await session({ studentId: w.st.id, programId: w.p.id, mentorId: other.id, minutes: 45 });

    const grant = (await homeOf(w.st)).grants.find((g) => g.mentor?.id === other.id);
    expect(grant).toEqual({
      mentor: { id: other.id, name: "Umid Rashidov" },
      bank: false,
      program: { id: w.p.id, name: "Global Admissions", colorIndex: w.p.colorIndex },
      allocated: 0,
      remaining: -45,
      forfeited: 0,
      expired: false,
      useBy: null,
      daysLeft: null,
      bookingUrl: null,
    });
  });
});

describe("studentHomeFor: booking links", () => {
  it("gives each grant its mentor's booking link", async () => {
    const p = await program("Global Admissions");
    const linked = await mentor("Akmal Karimov");
    const unlinked = await mentor("Umid Rashidov");
    await paired(linked, p, { link: "https://calendly.com/akmal-karimov" });
    await paired(unlinked, p, { link: null });
    const st = await student({ programId: p.id, name: "Aziz Tursunov" });
    await grantTo(st, linked, p, 300);
    await grantTo(st, unlinked, p, 300);

    const { grants } = await homeOf(st);
    const linkOf = (m: User) => grants.find((g) => g.mentor?.id === m.id)?.bookingUrl;
    expect(linkOf(linked)).toBe("https://calendly.com/akmal-karimov");
    expect(linkOf(unlinked)).toBeNull();
  });

  it("offers the link of the program the time is in, when that program has one", async () => {
    const gp = await program("Global Admissions");
    const mp = await program("Master's Program");
    const m = await mentor("Akmal Karimov");
    await paired(m, gp, { link: "https://calendly.com/akmal-global" });
    await paired(m, mp, { link: "https://calendly.com/akmal-masters" });
    const st = await student({ programId: gp.id, name: "Aziz Tursunov" });
    await enroll({ studentId: st.id, programId: mp.id });
    await grantTo(st, m, gp, 300);
    await grantTo(st, m, mp, 120);

    const { grants } = await homeOf(st);
    expect(grants.map((g) => [g.program.name, g.bookingUrl])).toEqual([
      ["Global Admissions", "https://calendly.com/akmal-global"],
      ["Master's Program", "https://calendly.com/akmal-masters"],
    ]);
  });

  it("a mentor with no link in this program offers their link from another", async () => {
    const gp = await program("Global Admissions");
    const mp = await program("Master's Program");
    const m = await mentor("Akmal Karimov");
    await paired(m, gp, { link: "https://calendly.com/akmal-karimov" });
    // Paired in the Master's Program too, with no link there yet. The Book page offers
    // the same calendar for that time: it is the same person's either way.
    await paired(m, mp, { link: null });
    const st = await student({ programId: gp.id, name: "Aziz Tursunov" });
    await enroll({ studentId: st.id, programId: mp.id });
    await grantTo(st, m, gp, 300);
    await grantTo(st, m, mp, 120);

    const { grants } = await homeOf(st);
    expect(grants.map((g) => [g.program.name, g.bookingUrl])).toEqual([
      ["Global Admissions", "https://calendly.com/akmal-karimov"],
      ["Master's Program", "https://calendly.com/akmal-karimov"],
    ]);
  });

  it("takes the first made of the links a mentor has elsewhere", async () => {
    const gp = await program("Global Admissions");
    const mp = await program("Master's Program");
    const rp = await program("Research");
    const st = await student({ programId: gp.id, name: "Aziz Tursunov" });
    await enroll({ studentId: st.id, programId: mp.id });
    await enroll({ studentId: st.id, programId: rp.id });
    const m = await mentor("Akmal Karimov");
    const at = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, seconds));
    // Not paired in the program the time is in at all. Of the two links elsewhere the
    // Master's was written first and made second, so reading them as they were stored
    // would pick the wrong one.
    await paired(m, mp, { link: "https://calendly.com/akmal-masters", madeAt: at(2) });
    await paired(m, rp, { link: "https://calendly.com/akmal-research", madeAt: at(1) });
    await grantTo(st, m, gp, 300);

    expect((await homeOf(st)).grants[0].bookingUrl).toBe("https://calendly.com/akmal-research");
  });

  it("takes the link of whichever of a mentor's pairings has one, the first made when both do", async () => {
    const p = await program("Global Admissions");
    const autumn = await cohort({ programId: p.id, name: "Autumn" });
    const st = await student({ programId: p.id, cohortId: autumn.id, name: "Aziz Tursunov" });
    const first = await mentor("Akmal Karimov");
    const second = await mentor("Umid Rashidov");
    const at = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, seconds));
    // Each is paired twice: with the whole program, and with the student's cohort.
    await paired(first, p, { link: null, madeAt: at(1) });
    await paired(first, p, { link: "https://calendly.com/akmal-autumn", cohortId: autumn.id, madeAt: at(2) });
    // Written in the opposite order to the order they were made in, so that reading
    // them as they were stored would pick the wrong one.
    await paired(second, p, { link: "https://calendly.com/umid-autumn", cohortId: autumn.id, madeAt: at(2) });
    await paired(second, p, { link: "https://calendly.com/umid-program", madeAt: at(1) });
    await grantTo(st, first, p, 300);
    await grantTo(st, second, p, 300);

    const { grants } = await homeOf(st);
    const linkOf = (m: User) => grants.find((g) => g.mentor?.id === m.id)?.bookingUrl;
    expect(linkOf(first)).toBe("https://calendly.com/akmal-autumn");
    expect(linkOf(second)).toBe("https://calendly.com/umid-program");
  });

  it("takes a link only from the pairings the student can book through", async () => {
    const p = await program("Global Admissions");
    const elsewhere = await program("Master's Program");
    const autumn = await cohort({ programId: p.id, name: "Autumn" });
    const spring = await cohort({ programId: p.id, name: "Spring" });
    const st = await student({ programId: p.id, cohortId: autumn.id, name: "Aziz Tursunov" });
    const m = await mentor("Akmal Karimov");
    // One pairing with a cohort the student is not in, and one in a program they are not in.
    await paired(m, p, { link: "https://calendly.com/akmal-spring", cohortId: spring.id });
    await paired(m, elsewhere, { link: "https://calendly.com/akmal-masters" });
    await grantTo(st, m, p, 300);

    expect((await homeOf(st)).grants[0].bookingUrl).toBeNull();
  });
});

describe("studentHomeFor: things to check", () => {
  it("carries the id of each session to confirm", async () => {
    const w = await settled();
    const s = await logged(w, { minutes: 60, daysAgo: 2 });

    const home = await homeOf(w.st);
    expect(home.toConfirm).toBe(1);
    expect(home.todo).toEqual([
      {
        key: `SESSION_UNCONFIRMED:${w.m.id}::${s.id}`,
        type: "SESSION_UNCONFIRMED",
        severity: "attention",
        label: "Confirm this session",
        // Which meeting it was: the day and the length, and nothing more.
        explanation: `${formatDate(dayIn(-2))} · 1h`,
        subject: { kind: "mentor", id: w.m.id, name: "Akmal Karimov" },
        // A student's rows are about their own account, and name no program.
        program: null,
        count: null,
        href: "/student/meetings",
        sessionId: s.id,
        log: null,
      },
    ]);
  });

  it("keeps three sessions to confirm as three rows, each with its own key", async () => {
    const w = await settled();
    const ids = [(await logged(w, { daysAgo: 3 })).id, (await logged(w, { daysAgo: 2 })).id, (await logged(w, { daysAgo: 1 })).id];

    const home = await homeOf(w.st);
    expect(home.todo.map((row) => row.sessionId).sort()).toEqual(ids.sort());
    // One mentor logged all three, and the app keys its list on this: each key has
    // its session in it, and none had to be numbered to tell it from the others.
    expect(new Set(home.todo.map((row) => row.key)).size).toBe(3);
    expect(home.todo.every((row) => row.key.endsWith(`:${row.sessionId}`))).toBe(true);
    expect(home.toConfirm).toBe(3);
  });

  it("rolls four sessions to confirm into one row with no id, and still counts four", async () => {
    const w = await settled();
    for (const daysAgo of [4, 3, 2, 1]) await logged(w, { daysAgo });

    const home = await homeOf(w.st);
    expect(home.todo).toEqual([
      {
        key: "SESSION_UNCONFIRMED::",
        type: "SESSION_UNCONFIRMED",
        severity: "attention",
        label: "4 sessions are waiting to be confirmed",
        explanation: null,
        subject: null,
        program: null,
        count: 4,
        href: "/student/meetings",
        sessionId: null,
        log: null,
      },
    ]);
    // Counted from the sessions, so it does not depend on what the roll-up did to the rows.
    expect(home.toConfirm).toBe(4);
  });

  it("counts the sessions the website is asking about, and not those it has stopped asking about", async () => {
    const w = await settled();
    const waiting = await logged(w);
    await logged(w, { answer: "CONFIRMED" });
    await logged(w, { answer: "DISPUTED" });
    await logged(w, { status: "VOIDED" });
    await logged(w, { status: "RESCHEDULED" });
    // Given on top of the plan, so there is nothing for the student to agree with.
    await logged(w, { withinPlan: false });
    // Past the month the row keeps asking for.
    await logged(w, { daysAgo: 45 });
    // Another student's, with the same mentor.
    const other = await student({ programId: w.p.id, name: "Malika Rahimova" });
    await logged({ ...w, st: other });

    const home = await homeOf(w.st);
    expect(home.toConfirm).toBe(1);
    expect(home.todo.map((row) => row.sessionId)).toEqual([waiting.id]);
  });

  it("a student's answer carries no mentor note", async () => {
    const w = await settled();
    const s = await logged(w, { note: "Went through the essay." });

    const home = await homeOf(w.st);
    // The session is in the answer, as a row to confirm, and what the mentor wrote about it is not.
    expect(home.todo.map((row) => row.sessionId)).toEqual([s.id]);
    expect(JSON.stringify(home)).not.toContain("Went through the essay.");
  });

  it("is the website's own list, row for row, in its order, under keys of their own", async () => {
    const p = await program("Global Admissions");
    const m = await mentor("Akmal Karimov");
    // No way to book yet, time that ends in five days, and two sessions to confirm.
    await paired(m, p, { link: null });
    const st = await student({ programId: p.id, name: "Aziz Tursunov" });
    await grantTo(st, m, p, 600, 5);
    await logged({ p, m, st }, { daysAgo: 3 });
    await logged({ p, m, st }, { daysAgo: 1 });

    const home = await homeOf(st);
    const theirs = await studentRows(
      await accountOf(st),
      await prisma.studentProfile.findUniqueOrThrow({ where: { id: st.id }, include: { enrollments: true } }),
      await allocationSummary(st.id),
      await studentLedger(st.id),
      NOW
    );
    // Enough rows for "the same list" to mean something.
    expect(home.todo.map((row) => row.type)).toEqual(
      expect.arrayContaining(["BOOKING_LINK_MISSING", "ALLOCATION_EXPIRING", "SESSION_UNCONFIRMED"])
    );
    expect(home.todo).toEqual(theirs.map((row) => toTodoRow(row)));
    expect(new Set(home.todo.map((row) => row.key)).size).toBe(home.todo.length);
  });
});

describe("studentHomeFor: who has one", () => {
  it("is nobody's for a mentor", async () => expect(await studentHomeFor(await mentor("Akmal Karimov"), NOW)).toBeNull());
});

describe("studentHomeFor: tasks, plan, unread", () => {
  it("lists the student's open tasks before done ones, and their plan items with no note", async () => {
    const w = await settled();
    const later = await studentTask({ studentId: w.st.id, mentorId: w.m.id, title: "Later", dueInDays: 9 });
    const done = await studentTask({
      studentId: w.st.id,
      mentorId: w.m.id,
      title: "Finished",
      dueInDays: 1,
      percent: 100,
      completedAt: NOW,
    });
    const sooner = await studentTask({ studentId: w.st.id, mentorId: w.m.id, title: "Sooner", dueInDays: 3 });
    const finishedItem = await assignment({ studentId: w.st.id, mentorId: w.m.id, purpose: "Done one", position: 0 });
    await prisma.assignment.update({ where: { id: finishedItem.id }, data: { progress: "DONE", note: "staff only" } });
    const second = await assignment({ studentId: w.st.id, mentorId: w.m.id, purpose: "Second", position: 2 });
    const first = await assignment({ studentId: w.st.id, mentorId: null, purpose: "First", position: 1, minuteLimit: 120 });
    await prisma.assignment.update({ where: { id: second.id }, data: { note: "Weak on the thesis." } });
    await logged(w, { minutes: 45 }).then((s) => prisma.session.update({ where: { id: s.id }, data: { assignmentId: first.id } }));

    const home = await homeOf(w.st);
    expect(home.tasks.map((t) => t.id)).toEqual([sooner.id, later.id, done.id]);
    expect(home.tasks[0]).toMatchObject({
      title: "Sooner",
      student: { id: w.st.id, name: "Aziz Tursunov" },
      mentor: { id: w.m.id },
      can: { progress: true, edit: false, delete: false },
    });
    expect(home.plan.map((i) => i.id)).toEqual([first.id, second.id, finishedItem.id]);
    expect(home.plan.every((item) => item.note === null)).toBe(true);
    expect(JSON.stringify(home)).not.toContain("Weak on the thesis.");
    expect(home.plan[0]).toMatchObject({ minuteLimit: 120, loggedMinutes: 45, can: { edit: false, progress: false } });
    expect(home.today).toBe(programToday(NOW));
  });

  it("unread counts only the reader's unread notifications", async () => {
    const w = await settled();
    const other = await student({ programId: w.p.id, name: "Malika Rahimova" });
    const note = (userId: string, read: boolean) =>
      prisma.notification.create({ data: { userId, type: "TASK_SET", message: "A task", read } });
    await note(w.st.userId, false);
    await note(w.st.userId, false);
    await note(w.st.userId, true);
    await note(other.userId, false);
    expect((await homeOf(w.st)).unread).toBe(2);
    expect((await homeOf(other)).unread).toBe(1);
  });

  it("carries only the student's own tasks, whichever program they are in", async () => {
    const w = await settled();
    const other = await student({ programId: w.p.id, name: "Malika Rahimova" });
    await studentTask({ studentId: other.id, mentorId: w.m.id, title: "Hers" });
    expect((await homeOf(w.st)).tasks).toEqual([]);
    expect((await homeOf(other)).tasks.map((t) => t.title)).toEqual(["Hers"]);
  });
});
