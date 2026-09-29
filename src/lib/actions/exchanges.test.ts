import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { EXCHANGE_STATUS, SESSION_STATUS } from "@/lib/constants";
import {
  admin,
  allocation,
  grant,
  mentor,
  pairing,
  program,
  session,
  student,
} from "@/test/db";

/**
 * Lending a student to another program.
 *
 * Three rules carry the whole feature, and each of them is a way the hours
 * could otherwise be spent twice or spent by the wrong people:
 *
 *   1. The SENDER speaks for the program the student is in — a mentor who works
 *      there, or one of its admins. Nobody else can commit a program's name to
 *      a placement.
 *   2. The CAP is the sending program's, and the host allocates under it. A
 *      grant that would push the total past what was promised is refused, and
 *      so is one dated past the placement's own use-by.
 *   3. The ROWS stay single-program. The allocation and the session live in the
 *      host program and carry `exchangeId`, which is the only thing the sending
 *      program reads them through — so a figure is never counted in two places.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { sendOnExchange, returnExchange } = await import("@/lib/actions/exchanges");
const { setMentorAllocation } = await import("@/lib/actions/students");
const { logSession } = await import("@/lib/actions/sessions");
const { visibleExchanges, exchangeFigures } = await import("@/lib/exchanges");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const USE_BY = "2026-12-01";

const send = (studentProfileId: string, toProgramId: string, extra: Record<string, string> = {}) =>
  sendOnExchange(
    null,
    form({
      studentProfileId,
      toProgramId,
      minutes: "420",
      deadline: USE_BY,
      ...extra,
    })
  );

const allocate = (
  studentProfileId: string,
  programId: string,
  mentorId: string,
  minutes: string,
  extra: Record<string, string> = {}
) =>
  setMentorAllocation(
    null,
    form({
      studentProfileId,
      programId,
      mentorId,
      minutes,
      mode: "set",
      deadline: USE_BY,
      ...extra,
    })
  );

/** Imkon has a student and a mentor; Global has an admin and a mentor. */
async function school() {
  const [imkon, global] = await Promise.all([program("Imkon"), program("Global Admissions")]);
  const [malika, khusanboy, aziza, globalAdmin] = await Promise.all([
    student({ programId: imkon.id, name: "Malika Karimova" }),
    mentor("Khusanboy Tolibov"),
    mentor("Aziza Rustamova"),
    admin("Global Admin"),
  ]);
  await Promise.all([
    pairing({ mentorId: khusanboy.id, programId: imkon.id }),
    pairing({ mentorId: aziza.id, programId: global.id }),
    grant({ userId: globalAdmin.id, programId: global.id }),
  ]);
  return { imkon, global, malika, khusanboy, aziza, globalAdmin };
}

describe("sending a student on exchange", () => {
  it("places them in the host program as a visitor, capped at the hours sent", async () => {
    const { global, malika, khusanboy } = await school();
    actor.value = khusanboy;

    const state = await send(malika.id, global.id, { note: "Needs help with essays" });

    expect(state).toMatchObject({ ok: true });
    const exchange = await prisma.programExchange.findFirstOrThrow({
      include: { enrollment: true },
    });
    expect(exchange).toMatchObject({
      minutes: 420,
      status: EXCHANGE_STATUS.OPEN,
      sentById: khusanboy.id,
      note: "Needs help with essays",
    });
    // The membership is what makes every existing gate work — and it says it
    // is a visit, not an enrollment.
    expect(exchange.enrollment).toMatchObject({
      programId: global.id,
      exchangeId: exchange.id,
      cohortId: null,
    });
  });

  it("tells the host program's admins, the sender's admins and the student", async () => {
    const { imkon, global, malika, khusanboy, globalAdmin } = await school();
    const imkonAdmin = await admin("Imkon Admin");
    await grant({ userId: imkonAdmin.id, programId: imkon.id });
    actor.value = khusanboy;

    await send(malika.id, global.id);

    const told = await prisma.notification.findMany({
      where: { type: "EXCHANGE_SENT" },
      select: { userId: true },
    });
    expect(new Set(told.map((n) => n.userId))).toEqual(
      new Set([globalAdmin.id, imkonAdmin.id, malika.userId])
    );
  });

  it("refuses a mentor who works in neither of the student's programs", async () => {
    const { global, malika } = await school();
    const stranger = await mentor("Stranger");
    actor.value = stranger;

    const state = await send(malika.id, global.id);

    expect(state).toMatchObject({ ok: false });
    await expect(prisma.programExchange.count()).resolves.toBe(0);
    await expect(
      prisma.studentEnrollment.count({ where: { programId: global.id } })
    ).resolves.toBe(0);
  });

  it("refuses to send them where they already study", async () => {
    const { imkon, global, malika, khusanboy } = await school();
    await prisma.studentEnrollment.create({
      data: { studentId: malika.id, programId: global.id },
    });
    actor.value = khusanboy;

    const state = await send(malika.id, global.id, { fromProgramId: imkon.id });

    expect(state).toMatchObject({ ok: false, field: "toProgramId" });
    await expect(prisma.programExchange.count()).resolves.toBe(0);
  });

  it("raises the cap instead of opening a second placement", async () => {
    const { global, malika, khusanboy } = await school();
    actor.value = khusanboy;

    await send(malika.id, global.id);
    const state = await send(malika.id, global.id, { minutes: "60", deadline: "2026-11-01" });

    expect(state).toMatchObject({ ok: true });
    const exchanges = await prisma.programExchange.findMany();
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].minutes).toBe(480);
    // The later date stands: hours already promised are never shortened by a
    // top-up aimed at nearer work.
    expect(exchanges[0].deadline).toEqual(new Date(`${USE_BY}T00:00:00.000Z`));
  });
});

describe("the host allocates under the cap", () => {
  it("lets the host admin split the hours and refuses the one that goes over", async () => {
    const { global, malika, khusanboy, aziza, globalAdmin } = await school();
    actor.value = khusanboy;
    await send(malika.id, global.id);
    actor.value = globalAdmin;

    const colleague = await mentor("Dilnoza Yusupova");
    await pairing({ mentorId: colleague.id, programId: global.id });

    const first = await allocate(malika.id, global.id, aziza.id, "240");
    expect(first).toMatchObject({ ok: true });

    // Aziza holds 4h of the 7h; 3h are left, so 4h more is 1h too many.
    const second = await allocate(malika.id, global.id, colleague.id, "240");
    expect(second).toMatchObject({ ok: false });
    expect((second as { error: string }).error).toContain("exchange");

    const third = await allocate(malika.id, global.id, colleague.id, "180");
    expect(third).toMatchObject({ ok: true });

    const granted = await prisma.hourAllocation.findMany({
      where: { programId: global.id },
      select: { minutes: true, exchangeId: true },
    });
    expect(granted.reduce((sum, a) => sum + a.minutes, 0)).toBe(420);
    // Every grant made under it names it — which is what keeps the cap
    // countable and what the sending program reads them through.
    expect(granted.every((a) => a.exchangeId !== null)).toBe(true);
  });

  it("refuses hours dated past the day the placement runs out", async () => {
    const { global, malika, khusanboy, aziza, globalAdmin } = await school();
    actor.value = khusanboy;
    await send(malika.id, global.id);
    actor.value = globalAdmin;

    const state = await allocate(malika.id, global.id, aziza.id, "60", {
      deadline: "2027-01-01",
    });

    expect(state).toMatchObject({ ok: false });
    await expect(
      prisma.hourAllocation.count({ where: { programId: global.id } })
    ).resolves.toBe(0);
  });

  it("leaves an ordinary program's grants alone", async () => {
    const { imkon, malika, khusanboy } = await school();
    const imkonAdmin = await admin("Imkon Admin");
    await grant({ userId: imkonAdmin.id, programId: imkon.id });
    actor.value = imkonAdmin;

    const state = await allocate(malika.id, imkon.id, khusanboy.id, "6000");

    expect(state).toMatchObject({ ok: true });
    await expect(
      prisma.hourAllocation.findFirstOrThrow({ where: { programId: imkon.id } })
    ).resolves.toMatchObject({ minutes: 6000, exchangeId: null });
  });
});

describe("both programs read the same hours", () => {
  it("stamps the session with the exchange and shows it to the sender", async () => {
    const { global, malika, khusanboy, aziza, globalAdmin } = await school();
    actor.value = khusanboy;
    await send(malika.id, global.id);
    actor.value = globalAdmin;
    await allocate(malika.id, global.id, aziza.id, "420");

    actor.value = aziza;
    const logged = await logSession(
      null,
      form({
        studentProfileId: malika.id,
        programId: global.id,
        minutes: "120",
        date: "2026-09-10",
      })
    );
    expect(logged).toMatchObject({ ok: true });

    const exchange = await prisma.programExchange.findFirstOrThrow();
    await expect(
      prisma.session.findFirstOrThrow({ select: { programId: true, exchangeId: true } })
    ).resolves.toEqual({ programId: global.id, exchangeId: exchange.id });

    // The mentor who sent her reads the host program's rows — through the
    // exchange, and only the exchange's own.
    const sender = await prisma.user.findUniqueOrThrow({ where: { id: khusanboy.id } });
    const [view] = await visibleExchanges(sender, malika);
    expect(view.figures).toMatchObject({
      cap: 420,
      allocated: 420,
      unallocated: 0,
      used: 120,
      remaining: 300,
    });
    expect(view.sessions).toHaveLength(1);
    expect(view.mentors).toMatchObject([{ allocated: 420, used: 120 }]);
  });

  it("shows nothing to a mentor in a third program", async () => {
    const { global, malika, khusanboy } = await school();
    const other = await program("Master's");
    const outsider = await mentor("Outsider");
    await pairing({ mentorId: outsider.id, programId: other.id });
    actor.value = khusanboy;
    await send(malika.id, global.id);

    await expect(visibleExchanges(outsider, malika)).resolves.toHaveLength(0);
  });
});

describe("calling an exchange off", () => {
  it("takes back the visit and the hours nobody spent", async () => {
    const { global, malika, khusanboy, aziza, globalAdmin } = await school();
    actor.value = khusanboy;
    await send(malika.id, global.id);
    actor.value = globalAdmin;
    await allocate(malika.id, global.id, aziza.id, "420");

    const exchange = await prisma.programExchange.findFirstOrThrow();
    const state = await returnExchange(null, form({ exchangeId: exchange.id }));

    expect(state).toMatchObject({ ok: true });
    await expect(
      prisma.programExchange.findFirstOrThrow({ select: { status: true } })
    ).resolves.toEqual({ status: EXCHANGE_STATUS.RETURNED });
    await expect(
      prisma.studentEnrollment.count({ where: { programId: global.id } })
    ).resolves.toBe(0);
    await expect(
      prisma.hourAllocation.count({ where: { programId: global.id } })
    ).resolves.toBe(0);

    // The allocations go; their history does not. Each returned grant is
    // written as a terminal change down to zero, so the student's History can
    // still say where the host-program hours went.
    const trail = await prisma.hourAllotmentChange.findMany({
      where: { studentId: malika.id, programId: global.id },
      orderBy: { createdAt: "asc" },
    });
    expect(trail.map((t) => [t.oldMinutes, t.newMinutes])).toEqual([
      [0, 420],
      [420, 0],
    ]);
  });

  it("refuses once an hour has been delivered", async () => {
    const { global, malika, khusanboy, aziza, globalAdmin } = await school();
    actor.value = khusanboy;
    await send(malika.id, global.id);
    const exchange = await prisma.programExchange.findFirstOrThrow();
    await allocation({
      studentId: malika.id,
      programId: global.id,
      mentorId: aziza.id,
      minutes: 420,
    });
    await prisma.session.update({
      where: {
        id: (
          await session({
            studentId: malika.id,
            programId: global.id,
            mentorId: aziza.id,
            minutes: 60,
          })
        ).id,
      },
      data: { exchangeId: exchange.id },
    });

    actor.value = globalAdmin;
    const state = await returnExchange(null, form({ exchangeId: exchange.id }));

    expect(state).toMatchObject({ ok: false });
    await expect(
      prisma.studentEnrollment.count({ where: { programId: global.id } })
    ).resolves.toBe(1);
  });

  it("refuses somebody with no part in either program", async () => {
    const { global, malika, khusanboy } = await school();
    actor.value = khusanboy;
    await send(malika.id, global.id);
    const exchange = await prisma.programExchange.findFirstOrThrow();

    actor.value = await mentor("Passer-by");
    const state = await returnExchange(null, form({ exchangeId: exchange.id }));

    expect(state).toMatchObject({ ok: false });
    await expect(
      prisma.programExchange.findFirstOrThrow({ select: { status: true } })
    ).resolves.toEqual({ status: EXCHANGE_STATUS.OPEN });
  });
});

describe("the figures a sender reads", () => {
  // Pure arithmetic, no database: an expired grant forfeits what is left on
  // it, per its own deadline — the same rule allocationSummary applies to the
  // ledger these rows belong to.
  const past = new Date("2026-01-01T00:00:00.000Z");
  const future = new Date("2099-01-01T00:00:00.000Z");
  const now = new Date("2026-06-01T00:00:00.000Z").getTime();
  const charged = (mentorId: string, minutes: number, attended = true) => ({
    mentorId,
    minutes,
    attended,
    status: SESSION_STATUS.ACTIVE,
    withinPlan: true,
  });

  it("forfeits what an expired grant still holds, and counts the rest of used", async () => {
    const figures = exchangeFigures(
      420,
      [
        { mentorId: "m1", minutes: 420, deadline: past },
      ],
      [
        charged("m1", 120),
        charged("m1", 60, false), // a no-show still spends the hours
      ],
      now
    );

    expect(figures).toMatchObject({
      cap: 420,
      allocated: 420,
      used: 180,
      missed: 60,
      forfeited: 240,
      remaining: 0,
      unallocated: 0,
    });
  });

  it("leaves a live grant untouched and keeps extras out of every total", async () => {
    const figures = exchangeFigures(
      420,
      [{ mentorId: "m1", minutes: 300, deadline: future }],
      [
        charged("m1", 60),
        { ...charged("m1", 30), withinPlan: false }, // extra work
        { ...charged("m1", 15), status: SESSION_STATUS.VOIDED },
      ],
      now
    );

    expect(figures).toMatchObject({
      used: 60,
      missed: 0,
      extra: 30,
      forfeited: 0,
      remaining: 240,
      unallocated: 120,
    });
  });

  it("forfeits per mentor, not across the placement", async () => {
    // Two mentors, two deadlines: only the expired grant lapses, and only by
    // what ITS holder did not spend — the other mentor's delivered hours do
    // not rescue it.
    const figures = exchangeFigures(
      420,
      [
        { mentorId: "m1", minutes: 240, deadline: past },
        { mentorId: "m2", minutes: 180, deadline: future },
      ],
      [charged("m2", 180)],
      now
    );

    expect(figures).toMatchObject({
      used: 180,
      forfeited: 240,
      remaining: 0,
    });
  });
});

describe("an exchange is not an enrollment", () => {
  it("refuses to move or unenroll the visit", async () => {
    const { global, malika, khusanboy, globalAdmin } = await school();
    const third = await program("Master's");
    actor.value = khusanboy;
    await send(malika.id, global.id);

    const { moveStudent, unenrollStudent } = await import("@/lib/actions/students");
    const visit = await prisma.studentEnrollment.findFirstOrThrow({
      where: { programId: global.id },
    });
    actor.value = globalAdmin;

    await expect(
      moveStudent(
        null,
        form({
          studentProfileId: malika.id,
          enrollmentId: visit.id,
          programId: third.id,
        })
      )
    ).resolves.toMatchObject({ ok: false });
    await expect(
      unenrollStudent(null, form({ enrollmentId: visit.id }))
    ).resolves.toMatchObject({ ok: false });
    await expect(
      prisma.studentEnrollment.findUniqueOrThrow({ where: { id: visit.id } })
    ).resolves.toMatchObject({ programId: global.id });
  });
});
