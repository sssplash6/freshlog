import { describe, expect, it } from "vitest";

import type { Program, User } from "@/generated/prisma/client";
import { mentorHomeFor } from "@/lib/api/v1/mentor-home";
import { readerFor, sessionsPage } from "@/lib/api/v1/sessions";
import { attentionFor } from "@/lib/attention";
import { toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { programToday } from "@/lib/when";
import { admin, DAY, enroll, grant, mentor, NOW, pairing, program, session, student } from "@/test/db";

/**
 * The mentor's home: their caseload with freshform's own status on each row,
 * and the To do the website's bell shows them.
 *
 * Every figure is one the website already shows. These tests hold the app's
 * home to the website's rules where they are easy to get wrong: an overdraw
 * nets against what is left, a mentor who also administers is told what a
 * mentor is told, and a bank is not unassigned time.
 */

/** `n` program days from today, stored the way a deadline is: the day, at UTC midnight. */
const dayIn = (n: number) => new Date(Date.parse(`${programToday(NOW)}T00:00:00.000Z`) + n * DAY);

/** `m` paired with `p`, and a booking link, so nothing about the mentor themself is waiting in To do. */
async function pairedWith(m: User, p: Program) {
  const pair = await pairing({ mentorId: m.id, programId: p.id });
  await prisma.mentorAssignment.update({
    where: { id: pair.id },
    data: { calendlyUrl: "https://calendly.com/akmal-karimov" },
  });
}

async function atWork() {
  const p = await program("Global Admissions");
  const m = await mentor("Akmal Karimov");
  await pairedWith(m, p);
  return { p, m };
}

/**
 * A student of `p` who holds `minutes` with `m` until `endsInDays` days from
 * today, has used `used` of them, and has signed in (so the website has nothing
 * else to say about them unless `signedIn` is false).
 */
async function holding(
  { p, m }: { p: Program; m: User },
  opts: { name: string; minutes: number; used?: number; endsInDays?: number; signedIn?: boolean }
) {
  const st = await student({ programId: p.id, name: opts.name });
  if (opts.signedIn !== false) {
    await prisma.studentProfile.update({
      where: { id: st.id },
      data: { telegramUsername: opts.name.split(" ")[0].toLowerCase() },
    });
  }
  await prisma.hourAllocation.create({
    data: {
      studentId: st.id,
      programId: p.id,
      mentorId: m.id,
      minutes: opts.minutes,
      deadline: dayIn(opts.endsInDays ?? 60),
    },
  });
  if (opts.used) await session({ studentId: st.id, programId: p.id, mentorId: m.id, minutes: opts.used });
  return st;
}

describe("mentorHomeFor: the figures", () => {
  it("nets an overdraw against what is left, as the website does", async () => {
    const w = await atWork();
    await holding(w, { name: "Aziz Tursunov", minutes: 300 });
    // 60 granted, 120 used: 60 over.
    await holding(w, { name: "Malika Rahimova", minutes: 60, used: 120 });
    const home = await mentorHomeFor(w.m, {}, NOW);
    expect(home.students.map((row) => row.remaining).sort((a, b) => a - b)).toEqual([-60, 300]);
    expect(home.summary.remaining).toBe(240);
  });

  it("counts a student in two programs as the page's Your students does: a row each, and the tabs narrow it", async () => {
    const w = await atWork();
    const other = await program("Master's Program");
    await pairedWith(w.m, other);
    const st = await holding(w, { name: "Aziz Tursunov", minutes: 300 });
    await enroll({ studentId: st.id, programId: other.id });
    await prisma.hourAllocation.create({
      data: { studentId: st.id, programId: other.id, mentorId: w.m.id, minutes: 120, deadline: dayIn(60) },
    });
    const home = await mentorHomeFor(w.m, {}, NOW);
    expect(home.students).toHaveLength(2);
    expect(home.summary).toMatchObject({ students: 2, remaining: 420 });
    expect(home.tabs.programs.map((p) => p.id).sort()).toEqual([w.p.id, other.id].sort());
    expect(home.columns.program).toBe(true);
    // A program tab narrows the rows and the figures with them, as on the page.
    const one = await mentorHomeFor(w.m, { program: other.id }, NOW);
    expect(one.students.map((r) => r.program.id)).toEqual([other.id]);
    expect(one.summary).toMatchObject({ students: 1, remaining: 120 });
    expect(one.view.program).toBe(other.id);
  });

  it("counts their disputed sessions, and not voided ones", async () => {
    const w = await atWork();
    const st = await holding(w, { name: "Aziz Tursunov", minutes: 600 });
    const logged = async (answer: string, opts: { status?: string; mentorId?: string } = {}) => {
      const s = await session({
        studentId: st.id,
        programId: w.p.id,
        mentorId: opts.mentorId ?? w.m.id,
        minutes: 30,
        status: opts.status,
      });
      await prisma.session.update({ where: { id: s.id }, data: { studentAnswer: answer } });
    };
    await logged("DISPUTED");
    await logged("DISPUTED");
    // Voided since: the dispute was dealt with.
    await logged("DISPUTED", { status: "VOIDED" });
    await logged("CONFIRMED");
    // Another mentor's, about the same student.
    await logged("DISPUTED", { mentorId: (await mentor("Umid Rashidov")).id });
    expect((await mentorHomeFor(w.m, {}, NOW)).summary.disputed).toBe(2);
  });

  it("counts as disputed exactly what the mentor's ledger lists and counts as disputed", async () => {
    const w = await atWork();
    const st = await holding(w, { name: "Aziz Tursunov", minutes: 600 });
    const disputed = async (opts: { status?: string; withinPlan?: boolean; mentorId?: string } = {}) => {
      const s = await session({
        studentId: st.id,
        programId: w.p.id,
        mentorId: opts.mentorId ?? w.m.id,
        minutes: 30,
        status: opts.status,
        withinPlan: opts.withinPlan,
      });
      await prisma.session.update({ where: { id: s.id }, data: { studentAnswer: "DISPUTED" } });
    };
    await disputed();
    // Given on top of the plan, and moved: neither is voided, so both are still disputed.
    await disputed({ withinPlan: false });
    await disputed({ status: "RESCHEDULED" });
    await disputed({ status: "VOIDED" });
    await disputed({ mentorId: (await mentor("Umid Rashidov")).id });

    const { summary } = await mentorHomeFor(w.m, {}, NOW);
    const ledger = await sessionsPage(await readerFor(w.m), { answer: "disputed" }, NOW);
    if ("refused" in ledger) throw new Error(ledger.refused);
    expect(summary.disputed).toBe(3);
    // The ledger's `answer=disputed` and its chip: the three can never disagree.
    expect(ledger.totals.count).toBe(summary.disputed);
    expect(ledger.counts.disputed).toBe(summary.disputed);
  });
});

describe("mentorHomeFor: the caseload", () => {
  it("describes a row in the contract's words, with no database row and no instant passed through", async () => {
    const w = await atWork();
    await prisma.program.update({ where: { id: w.p.id }, data: { colorIndex: 3 } });
    const st = await holding(w, { name: "Aziz Tursunov", minutes: 600, used: 90, endsInDays: 10 });
    const { email } = await prisma.user.findUniqueOrThrow({ where: { id: st.userId } });

    const home = await mentorHomeFor(w.m, {}, NOW);
    expect(home.students).toEqual([
      {
        student: { id: st.id, userId: st.userId, name: "Aziz Tursunov" },
        program: { id: w.p.id, name: "Global Admissions", colorIndex: 3 },
        allocated: 600,
        remaining: 510,
        useBy: toDateInputValue(dayIn(10)),
        daysLeft: 10,
        expired: false,
        pool: null,
        bankLeft: null,
        approved: true,
        status: null,
        telegram: "aziz",
        email,
        level: null,
        lastSession: toDateInputValue((await prisma.session.findFirstOrThrow({ where: { studentId: st.id } })).date),
        forfeited: 0,
      },
    ]);
    // A `Date` or a field the contract does not name would not survive this.
    expect(JSON.parse(JSON.stringify(home))).toEqual(home);
  });

  it("names a student by their email when they have no name", async () => {
    const w = await atWork();
    const st = await holding(w, { name: "Aziz Tursunov", minutes: 300 });
    const { email } = await prisma.user.update({ where: { id: st.userId }, data: { name: null } });
    expect((await mentorHomeFor(w.m, {}, NOW)).students[0].student.name).toBe(email);
  });

  it("keeps the page's order: whoever needs the mentor first, then by soonest use-by; or the order asked", async () => {
    const w = await atWork();
    const later = await holding(w, { name: "Aziz Tursunov", minutes: 300 });
    const over = await holding(w, { name: "Malika Rahimova", minutes: 60, used: 120 });
    const soon = await holding(w, { name: "Dilnoza Yusupova", minutes: 600, endsInDays: 3 });
    const home = await mentorHomeFor(w.m, {}, NOW);
    expect(home.students.map((row) => row.student.id)).toEqual([over.id, soon.id, later.id]);
    expect(home.view.sort).toBeNull();
    const byName = await mentorHomeFor(w.m, { sort: "student", dir: "asc" }, NOW);
    expect(byName.students.map((row) => row.student.name)).toEqual(["Aziz Tursunov", "Dilnoza Yusupova", "Malika Rahimova"]);
    expect(byName.view).toMatchObject({ sort: "student", dir: "asc" });
  });

  it("says when each was last seen, and how much an expired grant lost", async () => {
    const w = await atWork();
    const lapsed = await holding(w, { name: "Aziz Tursunov", minutes: 300, used: 60, endsInDays: -2 });
    const row = (await mentorHomeFor(w.m, {}, NOW)).students.find((r) => r.student.id === lapsed.id);
    expect(row).toMatchObject({ expired: true, forfeited: 240 });
    expect(row?.lastSession).not.toBeNull();
  });

  it("gives each row its most serious status", async () => {
    const w = await atWork();
    // Over by an hour and never signed in: two statuses, and the overdraw is the one that matters.
    const over = await holding(w, { name: "Malika Rahimova", minutes: 60, used: 120, signedIn: false });
    const soon = await holding(w, { name: "Aziz Tursunov", minutes: 600, endsInDays: 3 });
    const sooner = await holding(w, { name: "Nigora Qodirova", minutes: 600, endsInDays: 1 });
    const fine = await holding(w, { name: "Dilnoza Yusupova", minutes: 600 });

    const home = await mentorHomeFor(w.m, {}, NOW);
    const statusOf = (id: string) => home.students.find((row) => row.student.id === id)?.status;
    expect(statusOf(over.id)).toEqual({ type: "BALANCE_OVERDRAWN", severity: "problem" });
    expect(statusOf(soon.id)).toEqual({ type: "ALLOCATION_EXPIRING", severity: "attention" });
    expect(statusOf(sooner.id)).toEqual({ type: "ALLOCATION_EXPIRING", severity: "attention" });
    expect(statusOf(fine.id)).toBeNull();
    // `expiring` counts the rows that is the status of: two of the four, not the overdrawn one.
    expect(home.summary.expiring).toBe(2);
  });

  it("says how many days are left, and until when", async () => {
    const w = await atWork();
    const st = await holding(w, { name: "Aziz Tursunov", minutes: 600, endsInDays: 3 });
    const row = (await mentorHomeFor(w.m, {}, NOW)).students.find((r) => r.student.id === st.id);
    expect(row).toMatchObject({ useBy: toDateInputValue(dayIn(3)), daysLeft: 3, expired: false });
  });

  it("lists time nobody holds yet apart, as the page's Time to claim, and keeps a bank in the caseload", async () => {
    const w = await atWork();
    const pooled = await student({ programId: w.p.id, name: "Malika Rahimova" });
    const banked = await student({ programId: w.p.id, name: "Dilnoza Yusupova" });
    await prisma.hourAllocation.create({
      data: { studentId: pooled.id, programId: w.p.id, mentorId: null, minutes: 90, deadline: dayIn(60) },
    });
    await prisma.hourAllocation.create({
      data: { studentId: banked.id, programId: w.p.id, mentorId: null, minutes: 120, deadline: dayIn(60), isBank: true },
    });
    const home = await mentorHomeFor(w.m, {}, NOW);
    // Any mentor of the program may claim it, so it is nobody's student yet (5c5c8a5).
    expect(home.students.map((row) => row.student.id)).toEqual([banked.id]);
    expect(home.claim.map((row) => [row.student.id, row.pool])).toEqual([[pooled.id, 90]]);
    expect(home.summary.students).toBe(1);
    // Every meeting draws a bank, whoever holds it: it is not unassigned.
    expect(home.students[0].pool).toBeNull();
  });

  it("says what an hour bank holds on the bank's own row, and nothing on any other", async () => {
    const w = await atWork();
    const granted = await holding(w, { name: "Aziz Tursunov", minutes: 300 });
    const pooled = await student({ programId: w.p.id, name: "Malika Rahimova" });
    const banked = await student({ programId: w.p.id, name: "Dilnoza Yusupova" });
    const overdrawn = await student({ programId: w.p.id, name: "Nigora Qodirova" });
    const unassigned = (studentId: string, minutes: number, isBank: boolean) =>
      prisma.hourAllocation.create({
        data: { studentId, programId: w.p.id, mentorId: null, minutes, deadline: dayIn(60), isBank },
      });
    await unassigned(pooled.id, 90, false);
    await unassigned(banked.id, 120, true);
    await unassigned(overdrawn.id, 60, true);
    // Every meeting draws a bank, whoever holds it: 30 of 120, and 90 of 60.
    await session({ studentId: banked.id, programId: w.p.id, mentorId: w.m.id, minutes: 30, fromBank: true });
    await session({ studentId: overdrawn.id, programId: w.p.id, mentorId: w.m.id, minutes: 90, fromBank: true });

    const home = await mentorHomeFor(w.m, {}, NOW);
    const rowOf = (id: string) => [...home.students, ...home.claim].find((row) => row.student.id === id);
    // The figure the website's caseload shows "in their bank": none of it is this mentor's grant.
    expect(rowOf(banked.id)).toMatchObject({ bankLeft: 90, allocated: 0, remaining: 0, pool: null });
    expect(rowOf(overdrawn.id)).toMatchObject({ bankLeft: -30, allocated: 0, remaining: 0, pool: null });
    expect(rowOf(pooled.id)).toMatchObject({ bankLeft: null, pool: 90 });
    expect(rowOf(granted.id)).toMatchObject({ bankLeft: null, allocated: 300, remaining: 300 });
  });
});

describe("mentorHomeFor: To do", () => {
  it("is freshform's list, in freshform's order, with a log to write for a student whose time is running out", async () => {
    const w = await atWork();
    await prisma.program.update({ where: { id: w.p.id }, data: { colorIndex: 3 } });
    const soon = await holding(w, { name: "Aziz Tursunov", minutes: 600, endsInDays: 3 });
    await holding(w, { name: "Malika Rahimova", minutes: 60, used: 120 });

    const home = await mentorHomeFor(w.m, {}, NOW);
    const theirs = await attentionFor(w.m, "mentor");
    expect(home.todo.map((row) => row.type)).toEqual(theirs.statuses.map((status) => status.type));

    expect(home.todo.find((row) => row.type === "ALLOCATION_EXPIRING")).toEqual({
      key: `ALLOCATION_EXPIRING:${soon.id}:${w.p.id}`,
      type: "ALLOCATION_EXPIRING",
      severity: "attention",
      label: expect.stringMatching(/expires/),
      explanation: "Schedule a meeting before it is lost.",
      subject: { kind: "student", id: soon.id, name: "Aziz Tursunov" },
      program: { id: w.p.id, name: "Global Admissions", colorIndex: 3 },
      count: null,
      href: `/students/${soon.id}`,
      sessionId: null,
      log: { studentProfileId: soon.id, programId: w.p.id, minutes: null, day: null, attendance: null },
    });
  });

  it("leaves time to claim to Time to claim, and keeps anything else true of that student", async () => {
    const w = await atWork();
    const pooled = await student({ programId: w.p.id, name: "Malika Rahimova" });
    await prisma.studentProfile.update({ where: { id: pooled.id }, data: { telegramUsername: "malika" } });
    // Never signed in: that is still worth saying, whoever's time it is.
    const unseen = await student({ programId: w.p.id, name: "Dilnoza Yusupova" });
    const banked = await student({ programId: w.p.id, name: "Nigora Qodirova" });
    await prisma.studentProfile.update({ where: { id: banked.id }, data: { telegramUsername: "nigora" } });
    const unassigned = (studentId: string, isBank = false) =>
      prisma.hourAllocation.create({
        data: { studentId, programId: w.p.id, mentorId: null, minutes: 90, deadline: dayIn(60), isBank },
      });
    await unassigned(pooled.id);
    await unassigned(unseen.id);
    await unassigned(banked.id, true);

    const home = await mentorHomeFor(w.m, {}, NOW);
    expect(home.claim.map((row) => row.student.id).sort()).toEqual([pooled.id, unseen.id].sort());
    const about = (id: string) => home.todo.filter((row) => row.subject?.id === id).map((row) => row.type);
    expect(about(pooled.id)).toEqual([]);
    expect(about(unseen.id)).toEqual(["STUDENT_NOT_SIGNED_IN"]);
    // A bank is in the caseload, not to claim, so its rows are unchanged.
    expect(about(banked.id)).toEqual(["BALANCE_NONE"]);
    // The row in Time to claim keeps its own status, which the app words it by.
    expect(home.claim.find((row) => row.student.id === pooled.id)?.status?.type).toBe("BALANCE_NONE");
  });

  it("gives a student whose time is running out in two programs a row for each, under keys of their own", async () => {
    const w = await atWork();
    const other = await program("Master's Program");
    await pairedWith(w.m, other);
    const st = await holding(w, { name: "Aziz Tursunov", minutes: 300, endsInDays: 3 });
    await enroll({ studentId: st.id, programId: other.id });
    await prisma.hourAllocation.create({
      data: { studentId: st.id, programId: other.id, mentorId: w.m.id, minutes: 200, deadline: dayIn(2) },
    });

    const { todo } = await mentorHomeFor(w.m, {}, NOW);
    const expiring = todo.filter((row) => row.type === "ALLOCATION_EXPIRING");
    expect(expiring.map((row) => row.subject?.id)).toEqual([st.id, st.id]);
    expect(expiring.map((row) => row.program?.id).sort()).toEqual([w.p.id, other.id].sort());
    // The app keys its list on this: no two rows of one answer may share one.
    expect(new Set(todo.map((row) => row.key)).size).toBe(todo.length);
  });

  it("numbers the rows of a student sent to one host program from two of the mentor's programs", async () => {
    const w = await atWork();
    const other = await program("Master's Program");
    const host = await prisma.program.update({
      where: { id: (await program("Imkon")).id },
      data: { colorIndex: 4 },
    });
    const st = await student({ programId: w.p.id, name: "Aziz Tursunov" });
    await enroll({ studentId: st.id, programId: other.id });
    // The mentor sent the same student to the host from each of their programs, and
    // nobody there holds the hours of either yet.
    for (const from of [w.p, other]) {
      await prisma.programExchange.create({
        data: {
          studentId: st.id,
          fromProgramId: from.id,
          toProgramId: host.id,
          minutes: 420,
          deadline: dayIn(60),
          sentById: w.m.id,
        },
      });
    }

    const { todo } = await mentorHomeFor(w.m, {}, NOW);
    // Two rows of one kind about one student in one program: only a number tells them apart.
    expect(todo.map((row) => row.key)).toEqual([
      `EXCHANGE_UNALLOCATED:${st.id}:${host.id}`,
      `EXCHANGE_UNALLOCATED:${st.id}:${host.id}#2`,
    ]);
    // And the dot on both is the host's, where the row is settled.
    expect(todo.map((row) => row.program)).toEqual([
      { id: host.id, name: "Imkon", colorIndex: 4 },
      { id: host.id, name: "Imkon", colorIndex: 4 },
    ]);
  });

  it("a mentor who also administers gets the mentor's To do, not the staff's", async () => {
    const p = await program("Global Admissions");
    // Nodira administers Global Admissions and mentors in it: one person, two halves.
    const nodira = await prisma.user.update({
      where: { id: (await admin("Nodira Aliyeva")).id },
      data: { isMentor: true },
    });
    await grant({ userId: nodira.id, programId: p.id });
    await pairedWith(nodira, p);
    await holding({ p, m: nodira }, { name: "Aziz Tursunov", minutes: 600, endsInDays: 3 });
    // A student of the program she holds no time with, whose address is a placeholder: the
    // staff's list asks about that, and the mentor's never does.
    const placeholder = await student({ programId: p.id, name: "Placeholder Pupil" });
    await prisma.user.update({ where: { id: placeholder.userId }, data: { email: "pupil@import.invalid" } });

    // The trap: the staff's list is what `attentionFor` answers any lens but "mentor" with, and
    // a request with a bearer token has no lens cookie to say which she is looking through.
    const staffs = (await attentionFor(nodira, "admin")).statuses.map((status) => status.type);
    expect(staffs).toContain("STUDENT_PLACEHOLDER_EMAIL");

    const types = (await mentorHomeFor(nodira, {}, NOW)).todo.map((row) => row.type);
    expect(types).toContain("ALLOCATION_EXPIRING");
    expect(types).not.toContain("STUDENT_PLACEHOLDER_EMAIL");
  });

  it("refuses a person who cannot mentor, rather than answer with the staff's list", async () => {
    const p = await program("Global Admissions");
    const nodira = await admin("Nodira Aliyeva");
    await grant({ userId: nodira.id, programId: p.id });
    await expect(mentorHomeFor(nodira, {}, NOW)).rejects.toThrow(/mentor/i);
  });
});

describe("mentorHomeFor: unread and what the cap left out", () => {
  it("unread counts only the mentor's unread notifications", async () => {
    const w = await atWork();
    const note = (userId: string, read: boolean) =>
      prisma.notification.create({ data: { userId, type: "TASK_MOVED", message: "Moved", read } });
    await note(w.m.id, false);
    await note(w.m.id, true);
    await note((await mentor("Umid Rashidov")).id, false);
    expect((await mentorHomeFor(w.m, {}, NOW)).unread).toBe(1);
  });

  it("a mentor's home says how many To do rows the cap left out (todoSpilled)", async () => {
    const w = await atWork();
    expect((await mentorHomeFor(w.m, {}, NOW)).todoSpilled).toBe(0);
    // The website rolls rows up by type and program, so it takes a program each to get past the cap of ten.
    for (let i = 0; i < 13; i++) {
      const p = await program(`Program ${i}`);
      await pairedWith(w.m, p);
      await holding({ p, m: w.m }, { name: `Student ${i}`, minutes: 600, endsInDays: 3 });
    }
    const home = await mentorHomeFor(w.m, {}, NOW);
    const theirs = await attentionFor(w.m, "mentor");
    expect(theirs.spilled).toBeGreaterThan(0);
    expect(home.todoSpilled).toBe(theirs.spilled);
    expect(home.todo).toHaveLength(10);
  });
});
