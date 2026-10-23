import { describe, expect, it } from "vitest";

import { logForm, logOptionsFor } from "@/lib/api/v1/log";
import { SESSION_STATUS } from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { allocation, assignment, DAY, enroll, inDays, mentor, pairing, program, session, student } from "@/test/db";

/**
 * Who a mentor can log a session for, and the form the log goes in by.
 *
 * The students, their order and each program's state and plan items are the
 * website's own (`logSessionOptions`); what is new here is the figures beside
 * them, the day, and the mentor's recent sessions.
 */

/** A mentor paired with a program, and a student in it holding 600 minutes with them. */
async function held() {
  const p = await program("Global Admissions");
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  const st = await student({ programId: p.id, name: "Aziz Tursunov" });
  const a = await allocation({ studentId: st.id, mentorId: m.id, minutes: 600 });
  return { p, m, st, a };
}

/** `daysAgo` days before October 22, the day the fixtures are pinned to. */
const day = (daysAgo: number) => new Date(Date.UTC(2026, 9, 22) - daysAgo * DAY);

type Meeting = { studentId: string; programId: string; mentorId: string };

/** A session of `minutes` held `daysAgo` days before October 22, ACTIVE unless said. */
const heldOn = (who: Meeting, minutes: number, daysAgo: number, status: string = SESSION_STATUS.ACTIVE) =>
  prisma.session.create({ data: { ...who, minutes, date: day(daysAgo), status } });

describe("logOptionsFor: students", () => {
  it("lists the mentor's students with their minutes, use-by and plan items", async () => {
    const { p, m, st, a } = await held();
    await session({ studentId: st.id, mentorId: m.id, minutes: 60 });
    const essay = await assignment({ studentId: st.id, mentorId: m.id, purpose: "Main essay" });
    const open = await assignment({ studentId: st.id, mentorId: null, purpose: "Activities list", position: 1 });

    expect((await logOptionsFor(m)).students).toEqual([
      {
        id: st.id,
        name: "Aziz Tursunov",
        programs: [
          {
            program: { id: p.id, name: "Global Admissions", colorIndex: 0 },
            state: "ready",
            remaining: 540,
            allocated: 600,
            useBy: toDateInputValue(a.deadline),
            goals: [
              { id: essay.id, label: "Main essay" },
              // The website's own label: logging against it would make it theirs.
              { id: open.id, label: "Activities list (unassigned)" },
            ],
          },
        ],
      },
    ]);
  });

  it("leaves out a student nobody has approved", async () => {
    const { p, m } = await held();
    const pending = await student({ programId: p.id, name: "Malika Rahimova", status: "PENDING" });
    await allocation({ studentId: pending.id, mentorId: m.id, minutes: 300 });

    expect((await logOptionsFor(m)).students.map((s) => s.name)).toEqual(["Aziz Tursunov"]);
  });

  it("gives a student the mentor merely shares a program with no figures", async () => {
    const p = await program("Global Admissions");
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: p.id });
    const st = await student({ programId: p.id, name: "Malika Rahimova" });

    expect((await logOptionsFor(m)).students).toEqual([
      {
        id: st.id,
        name: "Malika Rahimova",
        programs: [
          {
            program: { id: p.id, name: "Global Admissions", colorIndex: 0 },
            state: "none",
            remaining: null,
            allocated: null,
            useBy: null,
            goals: [],
          },
        ],
      },
    ]);
  });

  /**
   * `remaining` is the figure `state` was decided from, so the two never disagree: what is left
   * in an unassigned pool or an hour bank where the hours are in one, else what is left of the
   * mentor's own grant, and nothing when `state` is none. `allocated` is only the mentor's own
   * grant. The next four are the rows that are not a grant of the mentor's.
   */
  it("reads a student whose hours are in an unassigned pool by what the pool holds", async () => {
    const p = await program("Global Admissions");
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: p.id });
    const st = await student({ programId: p.id, name: "Aziz Tursunov" });
    const pool = await allocation({ studentId: st.id, mentorId: null, minutes: 300 });

    expect((await logOptionsFor(m)).students[0].programs).toMatchObject([
      // The pool is not this mentor's grant, but a log claims what it needs from it.
      { state: "ready", remaining: 300, allocated: null, useBy: toDateInputValue(pool.deadline) },
    ]);
  });

  it("reads an overdrawn hour bank by how far over it is", async () => {
    const p = await program("Global Admissions");
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: p.id });
    const st = await student({ programId: p.id, name: "Aziz Tursunov" });
    const bank = await prisma.hourAllocation.create({
      data: { studentId: st.id, programId: p.id, mentorId: null, minutes: 60, deadline: inDays(20), isBank: true },
    });
    // Every meeting draws the bank, whoever holds it: 120 minutes against 60.
    await prisma.session.create({
      data: { studentId: st.id, programId: p.id, mentorId: m.id, minutes: 120, date: day(2), fromBank: true },
    });

    expect((await logOptionsFor(m)).students[0].programs).toMatchObject([
      { state: "overdrawn", remaining: -60, allocated: null, useBy: toDateInputValue(bank.deadline) },
    ]);
  });

  it("gives a student the mentor has met with nothing allotted no figures", async () => {
    const p = await program("Global Admissions");
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: p.id });
    const st = await student({ programId: p.id, name: "Aziz Tursunov" });
    // Charged against nothing, which the caseload counts as 90 over; the picker calls it no time.
    await session({ studentId: st.id, mentorId: m.id, minutes: 90 });

    expect((await logOptionsFor(m)).students[0].programs).toMatchObject([
      { state: "none", remaining: null, allocated: null, useBy: null },
    ]);
  });

  it("reads a grant that was set down to nothing as no grant at all", async () => {
    const p = await program("Global Admissions");
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: p.id });
    const st = await student({ programId: p.id, name: "Aziz Tursunov" });
    // The allocation form accepts 0. The row stays, with its use-by, but holds no time.
    await allocation({ studentId: st.id, mentorId: m.id, minutes: 0 });
    await session({ studentId: st.id, mentorId: m.id, minutes: 30 });

    expect((await logOptionsFor(m)).students[0].programs).toMatchObject([
      { state: "none", remaining: null, allocated: null, useBy: null },
    ]);
  });

  it("reads each program's figures from that program's own grant", async () => {
    const { p, m, st } = await held();
    const masters = await program("Master's Program");
    await pairing({ mentorId: m.id, programId: masters.id });
    await enroll({ studentId: st.id, programId: masters.id });
    await allocation({ studentId: st.id, programId: masters.id, mentorId: m.id, minutes: 300 });
    await session({ studentId: st.id, programId: p.id, mentorId: m.id, minutes: 60 });
    await session({ studentId: st.id, programId: masters.id, mentorId: m.id, minutes: 120 });

    const [only] = (await logOptionsFor(m)).students;

    expect(only.programs.map((x) => [x.program.name, x.allocated, x.remaining])).toEqual([
      ["Global Admissions", 600, 540],
      ["Master's Program", 300, 180],
    ]);
  });

  it("carries each program's dot, from the grant and from the pairing alike", async () => {
    const m = await mentor("Akmal Karimov");
    const granted = await prisma.program.create({ data: { name: "Master's Program", colorIndex: 3 } });
    const shared = await prisma.program.create({ data: { name: "Imkon", colorIndex: 5 } });
    await pairing({ mentorId: m.id, programId: granted.id });
    await pairing({ mentorId: m.id, programId: shared.id });
    const st = await student({ programId: granted.id });
    await enroll({ studentId: st.id, programId: shared.id });
    await allocation({ studentId: st.id, programId: granted.id, mentorId: m.id, minutes: 300 });

    const [only] = (await logOptionsFor(m)).students;

    expect(only.programs.map((x) => [x.program.name, x.program.colorIndex])).toEqual([
      ["Master's Program", 3],
      ["Imkon", 5],
    ]);
  });

  it("says overdrawn and expired as the website does, with the figures to match", async () => {
    const p = await program("Global Admissions");
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: p.id });
    const over = await student({ programId: p.id, name: "Aziz Tursunov" });
    await allocation({ studentId: over.id, mentorId: m.id, minutes: 60 });
    await session({ studentId: over.id, mentorId: m.id, minutes: 90 });
    const lapsed = await student({ programId: p.id, name: "Bobur Qodirov" });
    const grant = await allocation({ studentId: lapsed.id, mentorId: m.id, minutes: 300, deadlineInDays: -2 });
    await session({ studentId: lapsed.id, mentorId: m.id, minutes: 60 });

    const programs = (await logOptionsFor(m)).students.map((s) => s.programs[0]);

    expect(programs).toEqual([
      expect.objectContaining({ state: "overdrawn", allocated: 60, remaining: -30 }),
      // Unused hours on an expired grant are forfeited, so nothing is left.
      expect.objectContaining({ state: "expired", allocated: 300, remaining: 0, useBy: toDateInputValue(grant.deadline) }),
    ]);
  });
});

describe("logOptionsFor: today", () => {
  it("says what today is in Tashkent", async () => {
    const m = await mentor();
    expect((await logOptionsFor(m, new Date("2026-10-22T20:00:00Z"))).today).toBe("2026-10-23");
    // 23:59 in Tashkent is still the 22nd.
    expect((await logOptionsFor(m, new Date("2026-10-22T18:59:59Z"))).today).toBe("2026-10-22");
  });
});

describe("logOptionsFor: recent", () => {
  it("remembers the latest session with each student, newest first", async () => {
    const { p, m, st } = await held();
    const malika = await student({ programId: p.id, name: "Malika Rahimova" });
    const aziz = { studentId: st.id, programId: p.id, mentorId: m.id };
    await heldOn(aziz, 30, 3);
    await heldOn({ ...aziz, studentId: malika.id }, 45, 2);
    await heldOn(aziz, 90, 1);

    expect((await logOptionsFor(m)).recent).toEqual([
      { studentProfileId: st.id, programId: p.id, minutes: 90 },
      { studentProfileId: malika.id, programId: p.id, minutes: 45 },
    ]);
  });

  it("breaks a tie on the day by the order the sessions were logged in", async () => {
    const { p, m, st } = await held();
    const aziz = { studentId: st.id, programId: p.id, mentorId: m.id };
    await prisma.session.create({ data: { ...aziz, minutes: 30, date: day(1), createdAt: new Date("2026-10-22T08:00:00Z") } });
    await prisma.session.create({ data: { ...aziz, minutes: 75, date: day(1), createdAt: new Date("2026-10-22T09:00:00Z") } });

    expect((await logOptionsFor(m)).recent).toEqual([{ studentProfileId: st.id, programId: p.id, minutes: 75 }]);
  });

  it("skips a voided session, so the one before it is the latest", async () => {
    const { p, m, st } = await held();
    const aziz = { studentId: st.id, programId: p.id, mentorId: m.id };
    await heldOn(aziz, 45, 2);
    await heldOn(aziz, 90, 1, SESSION_STATUS.VOIDED);

    expect((await logOptionsFor(m)).recent).toEqual([{ studentProfileId: st.id, programId: p.id, minutes: 45 }]);
  });

  it("reads only the mentor's own sessions", async () => {
    const { p, m, st } = await held();
    const colleague = await mentor("Umid Rashidov");
    await heldOn({ studentId: st.id, programId: p.id, mentorId: colleague.id }, 90, 1);

    expect((await logOptionsFor(m)).recent).toEqual([]);
  });

  it("keeps a student's two programs apart", async () => {
    const { p, m, st } = await held();
    const masters = await program("Master's Program");
    await enroll({ studentId: st.id, programId: masters.id });
    await heldOn({ studentId: st.id, programId: p.id, mentorId: m.id }, 30, 2);
    await heldOn({ studentId: st.id, programId: masters.id, mentorId: m.id }, 120, 1);

    expect((await logOptionsFor(m)).recent).toEqual([
      { studentProfileId: st.id, programId: masters.id, minutes: 120 },
      { studentProfileId: st.id, programId: p.id, minutes: 30 },
    ]);
  });

  it("keeps at most eight", async () => {
    const { p, m } = await held();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const st = await student({ programId: p.id, name: `Student ${i}` });
      ids.push(st.id);
      await heldOn({ studentId: st.id, programId: p.id, mentorId: m.id }, 30 + i, 10 - i);
    }

    const { recent } = await logOptionsFor(m);

    // The newest eight: the last student was seen most recently.
    expect(recent.map((r) => r.studentProfileId)).toEqual(ids.slice(2).reverse());
  });

  it("reads the latest fifty sessions and no more", async () => {
    const { p, m, st } = await held();
    const malika = await student({ programId: p.id, name: "Malika Rahimova" });
    const bobur = await student({ programId: p.id, name: "Bobur Qodirov" });
    const rustam = await student({ programId: p.id, name: "Rustam Karimov" });
    const by = (studentId: string) => ({ studentId, programId: p.id, mentorId: m.id });
    // 49 sessions with Malika, then Aziz's is the 50th and Bobur's the 51st.
    await prisma.session.createMany({
      data: Array.from({ length: 49 }, (_, i) => ({ ...by(malika.id), minutes: 30, date: day(i) })),
    });
    await heldOn(by(st.id), 45, 49);
    await heldOn(by(bobur.id), 60, 50);
    await heldOn(by(rustam.id), 90, 51);

    expect((await logOptionsFor(m)).recent).toEqual([
      { studentProfileId: malika.id, programId: p.id, minutes: 30 },
      { studentProfileId: st.id, programId: p.id, minutes: 45 },
    ]);
  });
});

describe("logForm", () => {
  const BODY = { studentProfileId: "p1", day: "2026-10-22", minutes: 60 };
  const entries = (form: FormData | { field: string }) => Object.fromEntries(form as FormData);

  it("never names a mentor, whatever the body says", () =>
    expect((logForm({ ...BODY, mentorId: "someone" }) as FormData).has("mentorId")).toBe(false));

  it("hands the action only the fields it reads, the day and the kind under the website form's names", () => {
    const form = logForm({
      studentProfileId: "p1",
      programId: "g1",
      day: "2026-10-22",
      minutes: 45,
      attendance: "LATE",
      kind: "EXTRA",
      note: "Went through the essay.",
      assignmentId: "a1",
      agendaName: "A new item",
      unknown: "ignored",
    });
    expect(entries(form)).toEqual({
      studentProfileId: "p1",
      programId: "g1",
      date: "2026-10-22",
      minutes: "45",
      attendance: "LATE",
      timeKind: "EXTRA",
      note: "Went through the essay.",
      assignmentId: "a1",
    });
  });

  it("leaves out what the request leaves out, so the action's own defaults apply", () => {
    expect(entries(logForm(BODY))).toEqual({ studentProfileId: "p1", date: "2026-10-22", minutes: "60" });
  });

  it("leaves a missing student, day or minutes to the action, which names it in the website's words", () => {
    expect([...(logForm({}) as FormData)]).toEqual([]);
  });

  it.each([
    ["minutes sent as text", { minutes: "60" }, "minutes"],
    ["minutes that are not a finite number", { minutes: Infinity }, "minutes"],
    ["a day that is not text", { day: 20261022 }, "day"],
    ["a student that is not text", { studentProfileId: 7 }, "studentProfileId"],
    ["a program that is not text", { programId: 7 }, "programId"],
    ["an attendance outside its values", { attendance: "SICK" }, "attendance"],
    ["an attendance in lower case", { attendance: "late" }, "attendance"],
    ["a kind outside its values", { kind: "BONUS" }, "kind"],
    ["a note that is not text", { note: 7 }, "note"],
    ["a note that is null", { note: null }, "note"],
    ["a plan item that is not text", { assignmentId: ["a1"] }, "assignmentId"],
  ])("refuses %s, naming the field", (_, over, field) => {
    expect(logForm({ ...BODY, ...over })).toEqual({ field });
  });
});
