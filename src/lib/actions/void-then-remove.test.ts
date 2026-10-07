import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { SESSION_STATUS } from "@/lib/constants";
import {
  admin,
  allocation,
  enroll,
  grant,
  mentor,
  pairing,
  program,
  session,
  student,
} from "@/test/db";

/**
 * "Void the sessions first" is a promise.
 *
 * Every guard that refuses to erase a grant, a membership or an exchange
 * because time was logged against it tells the admin to void those sessions
 * first. Until 30 September 2026 each of them counted the voided rows too, so
 * voiding changed nothing and the advice was a dead end: an admin who voided a
 * mentor's duplicate session in Global Admissions still could not take the
 * mentor out of it.
 *
 * A voided session is kept as a record, and it still must not stand in the
 * way. The other side of that is restoring: a session voided so its program
 * could be let go must not be put back into a program the student has left.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { deleteStudent, removeMentorAllocation, unenrollStudent } = await import("@/lib/actions/students");
const { restoreSession, voidSession } = await import("@/lib/actions/sessions");
const { sendOnExchange, returnExchange } = await import("@/lib/actions/exchanges");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

/** A student in Flexible and Global Admissions, and Sega double-granted in Global. */
async function doubleLogged() {
  const [flexible, global] = await Promise.all([
    program("Flexible Program"),
    program("Global Admissions"),
  ]);
  const [pupil, sega, boss] = await Promise.all([
    student({ programId: flexible.id }),
    mentor("Sega"),
    admin("Boss"),
  ]);
  await enroll({ studentId: pupil.id, programId: global.id });
  await Promise.all([
    grant({ userId: boss.id, programId: flexible.id }),
    grant({ userId: boss.id, programId: global.id }),
    pairing({ mentorId: sega.id, programId: global.id }),
  ]);
  await allocation({ studentId: pupil.id, programId: global.id, mentorId: sega.id, minutes: 600 });
  const duplicate = await session({
    studentId: pupil.id,
    programId: global.id,
    mentorId: sega.id,
    minutes: 90,
  });
  actor.value = boss;
  return { flexible, global, pupil, sega, boss, duplicate };
}

const removeSega = (pupilId: string, programId: string, segaId: string) =>
  removeMentorAllocation(
    null,
    form({ studentProfileId: pupilId, programId, mentorId: segaId })
  );

describe("removing a mentor's time", () => {
  it("is refused while their session there still stands", async () => {
    const { global, pupil, sega } = await doubleLogged();

    const state = await removeSega(pupil.id, global.id, sega.id);

    expect(state).toMatchObject({ ok: false });
    await expect(prisma.hourAllocation.count()).resolves.toBe(1);
  });

  it("goes through once that session is voided, and keeps the voided record", async () => {
    const { global, pupil, sega, duplicate } = await doubleLogged();
    await expect(
      voidSession(null, form({ sessionId: duplicate.id }))
    ).resolves.toMatchObject({ ok: true });

    const state = await removeSega(pupil.id, global.id, sega.id);

    expect(state).toMatchObject({ ok: true });
    await expect(prisma.hourAllocation.count()).resolves.toBe(0);
    await expect(
      prisma.session.findUniqueOrThrow({ where: { id: duplicate.id }, select: { status: true } })
    ).resolves.toEqual({ status: SESSION_STATUS.VOIDED });
  });

  it("is still refused by a rescheduled meeting, which is not voided", async () => {
    const { global, pupil, sega, duplicate } = await doubleLogged();
    await prisma.session.update({
      where: { id: duplicate.id },
      data: { status: SESSION_STATUS.RESCHEDULED },
    });

    const state = await removeSega(pupil.id, global.id, sega.id);

    expect(state).toMatchObject({ ok: false });
  });

  it("removes an hour bank whose only meeting was voided", async () => {
    const { global, pupil, duplicate } = await doubleLogged();
    await prisma.hourAllocation.create({
      data: {
        studentId: pupil.id,
        programId: global.id,
        mentorId: null,
        isBank: true,
        minutes: 300,
        deadline: new Date("2026-12-01"),
      },
    });
    await prisma.session.update({ where: { id: duplicate.id }, data: { fromBank: true } });

    const refused = await removeMentorAllocation(
      null,
      form({ studentProfileId: pupil.id, programId: global.id, mentorId: "", bank: "1" })
    );
    expect(refused).toMatchObject({ ok: false });

    await voidSession(null, form({ sessionId: duplicate.id }));
    const removed = await removeMentorAllocation(
      null,
      form({ studentProfileId: pupil.id, programId: global.id, mentorId: "", bank: "1" })
    );

    expect(removed).toMatchObject({ ok: true });
    await expect(prisma.hourAllocation.count({ where: { isBank: true } })).resolves.toBe(0);
  });
});

describe("taking a student off a program", () => {
  it("goes through once the sessions there are voided and the time removed", async () => {
    const { global, pupil, sega, duplicate } = await doubleLogged();
    const membership = await prisma.studentEnrollment.findFirstOrThrow({
      where: { studentId: pupil.id, programId: global.id },
    });

    await voidSession(null, form({ sessionId: duplicate.id }));
    await removeSega(pupil.id, global.id, sega.id);
    const state = await unenrollStudent(null, form({ enrollmentId: membership.id }));

    expect(state).toMatchObject({ ok: true });
    await expect(
      prisma.studentEnrollment.count({ where: { studentId: pupil.id, programId: global.id } })
    ).resolves.toBe(0);
  });
});

describe("restoring a voided session", () => {
  it("still works while the student is in the session's program", async () => {
    const { duplicate } = await doubleLogged();
    await voidSession(null, form({ sessionId: duplicate.id }));

    const state = await restoreSession(null, form({ sessionId: duplicate.id }));

    expect(state).toMatchObject({ ok: true });
  });

  it("is refused once the student has left that program", async () => {
    const { global, pupil, sega, duplicate } = await doubleLogged();
    const membership = await prisma.studentEnrollment.findFirstOrThrow({
      where: { studentId: pupil.id, programId: global.id },
    });
    await voidSession(null, form({ sessionId: duplicate.id }));
    await removeSega(pupil.id, global.id, sega.id);
    await unenrollStudent(null, form({ enrollmentId: membership.id }));

    const state = await restoreSession(null, form({ sessionId: duplicate.id }));

    expect(state).toMatchObject({ ok: false });
    await expect(
      prisma.session.findUniqueOrThrow({ where: { id: duplicate.id }, select: { status: true } })
    ).resolves.toEqual({ status: SESSION_STATUS.VOIDED });
  });
});

describe("calling an exchange off", () => {
  it("goes through once the time logged under it is voided", async () => {
    const [imkon, global] = await Promise.all([program("Imkon"), program("Global Admissions")]);
    const [pupil, khusanboy, aziza, globalAdmin] = await Promise.all([
      student({ programId: imkon.id }),
      mentor("Khusanboy"),
      mentor("Aziza"),
      admin("Global Admin"),
    ]);
    await Promise.all([
      pairing({ mentorId: khusanboy.id, programId: imkon.id }),
      pairing({ mentorId: aziza.id, programId: global.id }),
      grant({ userId: globalAdmin.id, programId: global.id }),
    ]);
    actor.value = khusanboy;
    await sendOnExchange(
      null,
      form({ studentProfileId: pupil.id, toProgramId: global.id, minutes: "420", deadline: "2026-12-01" })
    );
    const exchange = await prisma.programExchange.findFirstOrThrow();
    const logged = await session({
      studentId: pupil.id,
      programId: global.id,
      mentorId: aziza.id,
      minutes: 60,
    });
    await prisma.session.update({ where: { id: logged.id }, data: { exchangeId: exchange.id } });

    actor.value = globalAdmin;
    await expect(
      returnExchange(null, form({ exchangeId: exchange.id }))
    ).resolves.toMatchObject({ ok: false });

    await voidSession(null, form({ sessionId: logged.id }));
    const state = await returnExchange(null, form({ exchangeId: exchange.id }));

    expect(state).toMatchObject({ ok: true });
  });
});

describe("removing a student", () => {
  const remove = (pupilId: string) =>
    deleteStudent(null, form({ studentProfileId: pupilId })).catch((e) => e);

  it("is refused while a session of theirs still stands", async () => {
    const { pupil } = await doubleLogged();

    await expect(remove(pupil.id)).resolves.toMatchObject({ ok: false });
    await expect(prisma.session.count()).resolves.toBe(1);
  });

  it("goes through once their sessions are voided, and frees the address", async () => {
    const { pupil, duplicate } = await doubleLogged();
    const email = (await prisma.user.findFirstOrThrow({ where: { studentProfile: { id: pupil.id } } })).email;
    await voidSession(null, form({ sessionId: duplicate.id }));

    // A successful delete redirects, which Next implements by throwing.
    await remove(pupil.id);

    await expect(prisma.studentProfile.count({ where: { id: pupil.id } })).resolves.toBe(0);
    await expect(prisma.session.count()).resolves.toBe(0);
    await expect(prisma.hourAllocation.count()).resolves.toBe(0);
    await expect(prisma.user.count({ where: { email } })).resolves.toBe(0);
  });
});
