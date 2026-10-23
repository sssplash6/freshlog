import { describe, expect, it } from "vitest";

import type { Program, User } from "@/generated/prisma/client";
import { mentorHomeFor } from "@/lib/api/v1/mentor-home";
import { attentionFor } from "@/lib/attention";
import { toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { mentorCaseload } from "@/lib/queries";
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
    const home = await mentorHomeFor(w.m, NOW);
    expect(home.students.map((row) => row.remaining).sort((a, b) => a - b)).toEqual([-60, 300]);
    expect(home.summary.remaining).toBe(240);
  });

  it("counts a student once, though they are a row in each of two programs", async () => {
    const w = await atWork();
    const other = await program("Master's Program");
    await pairedWith(w.m, other);
    const st = await holding(w, { name: "Aziz Tursunov", minutes: 300 });
    await enroll({ studentId: st.id, programId: other.id });
    await prisma.hourAllocation.create({
      data: { studentId: st.id, programId: other.id, mentorId: w.m.id, minutes: 120, deadline: dayIn(60) },
    });
    const home = await mentorHomeFor(w.m, NOW);
    expect(home.students).toHaveLength(2);
    expect(home.summary).toMatchObject({ students: 1, remaining: 420 });
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
    expect((await mentorHomeFor(w.m, NOW)).summary.disputed).toBe(2);
  });
});

describe("mentorHomeFor: the caseload", () => {
  it("describes a row in the contract's words, with no database row and no instant passed through", async () => {
    const w = await atWork();
    await prisma.program.update({ where: { id: w.p.id }, data: { colorIndex: 3 } });
    const st = await holding(w, { name: "Aziz Tursunov", minutes: 600, used: 90, endsInDays: 10 });
    const { email } = await prisma.user.findUniqueOrThrow({ where: { id: st.userId } });

    const home = await mentorHomeFor(w.m, NOW);
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
        approved: true,
        status: null,
        telegram: "aziz",
        email,
      },
    ]);
    // A `Date` or a field the contract does not name would not survive this.
    expect(JSON.parse(JSON.stringify(home))).toEqual(home);
  });

  it("names a student by their email when they have no name", async () => {
    const w = await atWork();
    const st = await holding(w, { name: "Aziz Tursunov", minutes: 300 });
    const { email } = await prisma.user.update({ where: { id: st.userId }, data: { name: null } });
    expect((await mentorHomeFor(w.m, NOW)).students[0].student.name).toBe(email);
  });

  it("keeps the website's order", async () => {
    const w = await atWork();
    await holding(w, { name: "Aziz Tursunov", minutes: 300 });
    await holding(w, { name: "Malika Rahimova", minutes: 60, used: 120 });
    await holding(w, { name: "Dilnoza Yusupova", minutes: 600, endsInDays: 3 });
    const home = await mentorHomeFor(w.m, NOW);
    const theirs = await mentorCaseload(w.m.id);
    expect(home.students.map((row) => row.student.id)).toEqual(theirs.students.map((row) => row.profile.id));
  });

  it("gives each row its most serious status", async () => {
    const w = await atWork();
    // Over by an hour and never signed in: two statuses, and the overdraw is the one that matters.
    const over = await holding(w, { name: "Malika Rahimova", minutes: 60, used: 120, signedIn: false });
    const soon = await holding(w, { name: "Aziz Tursunov", minutes: 600, endsInDays: 3 });
    const sooner = await holding(w, { name: "Nigora Qodirova", minutes: 600, endsInDays: 1 });
    const fine = await holding(w, { name: "Dilnoza Yusupova", minutes: 600 });

    const home = await mentorHomeFor(w.m, NOW);
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
    const row = (await mentorHomeFor(w.m, NOW)).students.find((r) => r.student.id === st.id);
    expect(row).toMatchObject({ useBy: toDateInputValue(dayIn(3)), daysLeft: 3, expired: false });
  });

  it("shows time nobody holds yet as a pool, and leaves a bank out of it", async () => {
    const w = await atWork();
    const pooled = await student({ programId: w.p.id, name: "Malika Rahimova" });
    const banked = await student({ programId: w.p.id, name: "Dilnoza Yusupova" });
    await prisma.hourAllocation.create({
      data: { studentId: pooled.id, programId: w.p.id, mentorId: null, minutes: 90, deadline: dayIn(60) },
    });
    await prisma.hourAllocation.create({
      data: { studentId: banked.id, programId: w.p.id, mentorId: null, minutes: 120, deadline: dayIn(60), isBank: true },
    });
    const home = await mentorHomeFor(w.m, NOW);
    const poolOf = (id: string) => home.students.find((row) => row.student.id === id)?.pool;
    expect(poolOf(pooled.id)).toBe(90);
    // Every meeting draws a bank, whoever holds it: it is not unassigned.
    expect(poolOf(banked.id)).toBeNull();
  });
});

describe("mentorHomeFor: To do", () => {
  it("is freshform's list, in freshform's order, with a log to write for a student whose time is running out", async () => {
    const w = await atWork();
    await prisma.program.update({ where: { id: w.p.id }, data: { colorIndex: 3 } });
    const soon = await holding(w, { name: "Aziz Tursunov", minutes: 600, endsInDays: 3 });
    await holding(w, { name: "Malika Rahimova", minutes: 60, used: 120 });

    const home = await mentorHomeFor(w.m, NOW);
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

  it("gives a student whose time is running out in two programs a row for each, under keys of their own", async () => {
    const w = await atWork();
    const other = await program("Master's Program");
    await pairedWith(w.m, other);
    const st = await holding(w, { name: "Aziz Tursunov", minutes: 300, endsInDays: 3 });
    await enroll({ studentId: st.id, programId: other.id });
    await prisma.hourAllocation.create({
      data: { studentId: st.id, programId: other.id, mentorId: w.m.id, minutes: 200, deadline: dayIn(2) },
    });

    const { todo } = await mentorHomeFor(w.m, NOW);
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

    const { todo } = await mentorHomeFor(w.m, NOW);
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

    const types = (await mentorHomeFor(nodira, NOW)).todo.map((row) => row.type);
    expect(types).toContain("ALLOCATION_EXPIRING");
    expect(types).not.toContain("STUDENT_PLACEHOLDER_EMAIL");
  });

  it("refuses a person who cannot mentor, rather than answer with the staff's list", async () => {
    const p = await program("Global Admissions");
    const nodira = await admin("Nodira Aliyeva");
    await grant({ userId: nodira.id, programId: p.id });
    await expect(mentorHomeFor(nodira, NOW)).rejects.toThrow(/mentor/i);
  });
});
