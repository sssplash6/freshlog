import { describe, expect, it, vi } from "vitest";

import { issueToken } from "@/lib/api/tokens";
import { mentorReaches } from "@/lib/authz";
import { USER_STATUS } from "@/lib/constants";
import { mentorsWhere, studentsWhere } from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import { mentorCaseload, mentorsInProgram, studentsWithHours } from "@/lib/queries";
import {
  admin,
  allocation,
  enroll,
  grant,
  mentor,
  pairing,
  platformAdmin,
  program,
  session,
  student,
} from "@/test/db";

/**
 * Archiving is for somebody who has left. These pin its two halves: nothing
 * about their record is removed, and they are gone from everywhere a person is
 * listed, picked or let in.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { archiveMentor, archiveStudent, restoreMentor, restoreStudent } = await import(
  "@/lib/actions/archive"
);

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

/** An admin of every program named, signed in. */
async function adminOf(...programIds: string[]) {
  const boss = await admin("Boss");
  for (const programId of programIds) await grant({ userId: boss.id, programId });
  actor.value = boss;
  return boss;
}

const STAFF = { audience: "staff" as const, userId: "reader" };
const statusOf = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id } })).status;

describe("archiving a student", () => {
  /** A student with 120 granted minutes, 60 of them used. */
  async function withHistory() {
    const p = await program("Global Admissions");
    const m = await mentor("Malika");
    await pairing({ mentorId: m.id, programId: p.id });
    const s = await student({ programId: p.id, name: "Aziz Karimov" });
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 120 });
    await session({ studentId: s.id, mentorId: m.id, minutes: 60 });
    return { p, m, s };
  }

  it("keeps every hour and every row, and records when and who", async () => {
    const { p, s } = await withHistory();
    const boss = await adminOf(p.id);

    const res = await archiveStudent(null, form({ studentProfileId: s.id }));

    expect(res).toEqual({
      ok: true,
      message: "Aziz Karimov is archived. Their hours and history are kept.",
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(user.status).toBe(USER_STATUS.ARCHIVED);
    expect(user.archivedAt).toBeInstanceOf(Date);
    expect(user.archivedById).toBe(boss.id);
    expect(await prisma.hourAllocation.count({ where: { studentId: s.id } })).toBe(1);
    expect(await prisma.session.count({ where: { studentId: s.id } })).toBe(1);
    expect(await prisma.studentEnrollment.count({ where: { studentId: s.id } })).toBe(1);

    // The figures are read exactly as they stood, by the one list that shows them.
    const [row] = await studentsWithHours({ id: s.id }, { includeArchived: true });
    expect(row.allottedMinutes).toBe(120);
    expect(row.remainingMinutes).toBe(60);
  });

  it("takes them off the roster and its totals, and onto the Archived list", async () => {
    const { p, s } = await withHistory();
    const other = await student({ programId: p.id, name: "Still Here" });
    await adminOf(p.id);
    await archiveStudent(null, form({ studentProfileId: s.id }));
    const now = new Date();

    const current = await prisma.studentProfile.findMany({
      where: studentsWhere({}, STAFF, now),
      select: { id: true },
    });
    expect(current.map((r) => r.id)).toEqual([other.id]);
    // A hand-built `where` — every program total is summed from one — is safe too.
    const summed = await studentsWithHours({ enrollments: { some: { programId: p.id } } });
    expect(summed.map((r) => r.id)).toEqual([other.id]);

    const gone = await prisma.studentProfile.findMany({
      where: studentsWhere({ status: "archived" }, STAFF, now),
      select: { id: true },
    });
    expect(gone.map((r) => r.id)).toEqual([s.id]);
  });

  it("takes them out of a mentor's reach and caseload, and restoring puts them back", async () => {
    const { p, m, s } = await withHistory();
    await adminOf(p.id);
    expect(await mentorReaches(m, s)).toBe(true);

    await archiveStudent(null, form({ studentProfileId: s.id }));
    expect(await mentorReaches(m, s)).toBe(false);
    expect((await mentorCaseload(m.id)).students).toEqual([]);

    const res = await restoreStudent(null, form({ studentProfileId: s.id }));
    expect(res).toEqual({
      ok: true,
      message: "Aziz Karimov is restored and can sign in again.",
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(user.status).toBe(USER_STATUS.ACTIVE);
    expect(user.archivedAt).toBeNull();
    expect(user.archivedById).toBeNull();
    expect(await mentorReaches(m, s)).toBe(true);
    expect((await mentorCaseload(m.id)).students).toHaveLength(1);
  });

  it("is refused to an admin of only one of their programs", async () => {
    const { p, s } = await withHistory();
    const masters = await program("Master's Program");
    await enroll({ studentId: s.id, programId: masters.id });
    await adminOf(p.id);

    const res = await archiveStudent(null, form({ studentProfileId: s.id }));

    expect(res?.ok).toBe(false);
    expect(res && !res.ok && res.error).toContain("a program you don't administer");
    expect(await statusOf(s.userId)).toBe(USER_STATUS.ACTIVE);
  });

  it("answers somebody with no grant as if the student did not exist", async () => {
    const { m, s } = await withHistory();
    actor.value = m;
    expect(await archiveStudent(null, form({ studentProfileId: s.id }))).toEqual({
      ok: false,
      error: "Student not found.",
    });
    expect(await archiveStudent(null, form({ studentProfileId: "nobody" }))).toEqual({
      ok: false,
      error: "Student not found.",
    });
    expect(await statusOf(s.userId)).toBe(USER_STATUS.ACTIVE);
  });

  it("is refused for a sign-up nobody has approved", async () => {
    const p = await program();
    const s = await student({ programId: p.id, status: USER_STATUS.PENDING });
    await adminOf(p.id);
    const res = await archiveStudent(null, form({ studentProfileId: s.id }));
    expect(res?.ok).toBe(false);
    expect(await statusOf(s.userId)).toBe(USER_STATUS.PENDING);
  });
});

describe("archiving a mentor", () => {
  async function working() {
    const p = await program("Global Admissions");
    const m = await mentor("Malika");
    await pairing({ mentorId: m.id, programId: p.id });
    const s = await student({ programId: p.id });
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 120 });
    await session({ studentId: s.id, mentorId: m.id, minutes: 60 });
    return { p, m, s };
  }

  it("keeps their pairings, sessions and the hours students hold with them", async () => {
    const { p, m } = await working();
    await adminOf(p.id);
    await issueToken(m.id, "Phone");

    const res = await archiveMentor(null, form({ mentorId: m.id }));

    expect(res?.ok).toBe(true);
    expect(await statusOf(m.id)).toBe(USER_STATUS.ARCHIVED);
    expect(await prisma.mentorAssignment.count({ where: { mentorId: m.id } })).toBe(1);
    expect(await prisma.session.count({ where: { mentorId: m.id } })).toBe(1);
    expect(await prisma.hourAllocation.count({ where: { mentorId: m.id } })).toBe(1);
    // The app on their phone is signed out with them.
    expect(await prisma.apiToken.count({ where: { userId: m.id, revokedAt: null } })).toBe(0);
  });

  it("takes them off the roster and out of the pickers, and onto the Archived list", async () => {
    const { p, m } = await working();
    const colleague = await mentor("Colleague");
    await pairing({ mentorId: colleague.id, programId: p.id });
    await adminOf(p.id);
    await archiveMentor(null, form({ mentorId: m.id }));

    const ids = async (params: Record<string, string>) =>
      (
        await prisma.user.findMany({ where: mentorsWhere(params, {}), select: { id: true } })
      ).map((u) => u.id);
    expect(await ids({})).toEqual([colleague.id]);
    expect(await ids({ status: "archived" })).toEqual([m.id]);
    expect((await mentorsInProgram(p.id)).map((u) => u.id)).toEqual([colleague.id]);
  });

  it("restores a paired mentor as active, and an unpaired one as unassigned", async () => {
    const { p, m } = await working();
    const loose = await mentor("Never Placed");
    actor.value = await platformAdmin();

    await archiveMentor(null, form({ mentorId: m.id }));
    await archiveMentor(null, form({ mentorId: loose.id }));
    await restoreMentor(null, form({ mentorId: m.id }));
    await restoreMentor(null, form({ mentorId: loose.id }));

    expect(await statusOf(m.id)).toBe(USER_STATUS.ACTIVE);
    expect(await statusOf(loose.id)).toBe(USER_STATUS.UNASSIGNED);
    expect(await prisma.mentorAssignment.count({ where: { mentorId: m.id, programId: p.id } })).toBe(1);
  });

  it("is refused to an admin of only one of their programs", async () => {
    const { p, m } = await working();
    const masters = await program("Master's Program");
    await pairing({ mentorId: m.id, programId: masters.id });
    await adminOf(p.id);

    const res = await archiveMentor(null, form({ mentorId: m.id }));

    expect(res && !res.ok && res.error).toContain("a program you don't administer");
    expect(await statusOf(m.id)).toBe(USER_STATUS.ACTIVE);
  });

  it("never archives yourself, a platform admin, or an admin on a program admin's say-so", async () => {
    const p = await program();
    const boss = await platformAdmin("Boss");
    const dual = await prisma.user.update({
      where: { id: (await admin("Dual")).id },
      data: { isMentor: true },
    });
    await pairing({ mentorId: dual.id, programId: p.id });
    const runs = await prisma.user.update({
      where: { id: (await platformAdmin("Runs It")).id },
      data: { isMentor: true },
    });
    await prisma.user.update({ where: { id: boss.id }, data: { isMentor: true } });

    await adminOf(p.id);
    expect((await archiveMentor(null, form({ mentorId: dual.id })))?.ok).toBe(false);

    actor.value = boss;
    expect((await archiveMentor(null, form({ mentorId: boss.id })))?.ok).toBe(false);
    expect((await archiveMentor(null, form({ mentorId: runs.id })))?.ok).toBe(false);
    expect((await archiveMentor(null, form({ mentorId: dual.id })))?.ok).toBe(true);

    expect(await statusOf(boss.id)).toBe(USER_STATUS.ACTIVE);
    expect(await statusOf(runs.id)).toBe(USER_STATUS.ACTIVE);
    expect(await statusOf(dual.id)).toBe(USER_STATUS.ARCHIVED);
  });
});
