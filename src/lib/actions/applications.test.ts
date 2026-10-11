import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { applicationAccess } from "@/lib/authz";
import {
  admin,
  allocation,
  grant,
  mentor,
  pairing,
  program,
  student,
  enroll,
} from "@/test/db";

/**
 * University applications: who may read and change them, and the word count
 * that is entered once per university and picked after.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const {
  addStudentUniversity,
  correctUniversityWords,
  saveApplicationSnapshot,
  setEssayStage,
  setPrimaryUniversity,
} = await import("@/lib/actions/applications");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

/** Full Support with applications on, a mentor in it, and one student. */
async function setup() {
  const fs = await program("Full Support");
  await prisma.program.update({ where: { id: fs.id }, data: { tracksAdmissions: true } });
  const coach = await mentor("Coach");
  await pairing({ mentorId: coach.id, programId: fs.id });
  const kid = await student({ programId: fs.id });
  actor.value = coach;
  return { fs, coach, kid };
}

const access = async (userId: string, studentId: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const profile = await prisma.studentProfile.findUniqueOrThrow({
    where: { id: studentId },
    include: { enrollments: true },
  });
  return applicationAccess(user, profile);
};

describe("who may read and change an application", () => {
  it("lets a mentor working in the program read and write it", async () => {
    const { coach, kid } = await setup();
    expect(await access(coach.id, kid.id)).toEqual({ read: true, write: true });
  });

  it("lets a mentor who holds time with them there in, without a pairing", async () => {
    const { fs, kid } = await setup();
    const other = await mentor("Granted");
    await allocation({ studentId: kid.id, programId: fs.id, mentorId: other.id, minutes: 60 });
    expect(await access(other.id, kid.id)).toEqual({ read: true, write: true });
  });

  it("keeps out a mentor who reaches the student only through another program", async () => {
    const { kid } = await setup();
    const ga = await program("Global Admissions");
    await enroll({ studentId: kid.id, programId: ga.id });
    const gaMentor = await mentor("GA mentor");
    await pairing({ mentorId: gaMentor.id, programId: ga.id });
    await allocation({ studentId: kid.id, programId: ga.id, mentorId: gaMentor.id, minutes: 60 });
    expect(await access(gaMentor.id, kid.id)).toEqual({ read: false, write: false });

    actor.value = gaMentor;
    const result = await saveApplicationSnapshot(null, form({ studentProfileId: kid.id, sat: "1500" }));
    expect(result).toMatchObject({ ok: false });
    expect(await prisma.studentApplication.count()).toBe(0);
  });

  it("keeps out an admin of the student's other program", async () => {
    const { kid } = await setup();
    const ga = await program("Global Admissions");
    await enroll({ studentId: kid.id, programId: ga.id });
    const gaAdmin = await admin("GA admin");
    await grant({ userId: gaAdmin.id, programId: ga.id });
    expect(await access(gaAdmin.id, kid.id)).toEqual({ read: false, write: false });
  });

  it("lets a LEADER of the program read but not change", async () => {
    const { fs, kid } = await setup();
    const lead = await admin("Leader");
    await grant({ userId: lead.id, programId: fs.id, role: "LEADER" });
    expect(await access(lead.id, kid.id)).toEqual({ read: true, write: false });
  });

  it("shows nothing for a program that does not track applications", async () => {
    const ga = await program("Global Admissions");
    const boss = await admin("Boss");
    await grant({ userId: boss.id, programId: ga.id });
    const kid = await student({ programId: ga.id });
    expect(await access(boss.id, kid.id)).toEqual({ read: false, write: false });
  });
});

describe("the snapshot and the essay stages", () => {
  it("saves and validates the snapshot", async () => {
    const { kid } = await setup();
    expect(
      await saveApplicationSnapshot(null, form({ studentProfileId: kid.id, sat: "1455" }))
    ).toMatchObject({ ok: false, field: "sat" });
    expect(
      await saveApplicationSnapshot(null, form({ studentProfileId: kid.id, ielts: "7.3" }))
    ).toMatchObject({ ok: false, field: "ielts" });

    const ok = await saveApplicationSnapshot(
      null,
      form({ studentProfileId: kid.id, sat: "1,480", ielts: "7.5", school: " Lyceum  No. 1 ", gpa: "3.9/4.0" })
    );
    expect(ok).toMatchObject({ ok: true });
    expect(await prisma.studentApplication.findUnique({ where: { studentId: kid.id } })).toMatchObject({
      sat: 1480,
      ielts: 7.5,
      school: "Lyceum No. 1",
      gpa: "3.9/4.0",
    });
  });

  it("refuses to move another student's supplemental through this student", async () => {
    const { fs, kid } = await setup();
    const other = await student({ programId: fs.id });
    await addStudentUniversity(null, form({ studentProfileId: other.id, universityId: "new", newName: "Yale", words: "750" }));
    const row = await prisma.studentUniversity.findFirstOrThrow({ where: { studentId: other.id } });

    const result = await setEssayStage(
      null,
      form({ studentProfileId: kid.id, target: row.id, stage: "DONE" })
    );
    expect(result).toMatchObject({ ok: false });
    expect((await prisma.studentUniversity.findUniqueOrThrow({ where: { id: row.id } })).essayStage).toBeNull();
  });
});

describe("the university list", () => {
  it("saves a new university's word count once, and fills it in after", async () => {
    const { fs, kid } = await setup();
    await addStudentUniversity(
      null,
      form({ studentProfileId: kid.id, universityId: "new", newName: "Princeton University", words: "1,000" })
    );
    const princeton = await prisma.university.findFirstOrThrow();
    expect(princeton).toMatchObject({ name: "Princeton University", supplementalWords: 1000 });

    // Typed again for another student, differently, with a different count:
    // it is the same university, and the saved count stands.
    const second = await student({ programId: fs.id });
    const result = await addStudentUniversity(
      null,
      form({ studentProfileId: second.id, universityId: "new", newName: "princeton  university", words: "650" })
    );
    expect(result).toMatchObject({ ok: true });
    expect(result && result.ok && result.message).toContain("that count stands");
    expect(await prisma.university.count()).toBe(1);
    expect(
      await prisma.studentUniversity.findFirstOrThrow({ where: { studentId: second.id } })
    ).toMatchObject({ universityId: princeton.id });
  });

  it("keeps one primary, and a round only on it", async () => {
    const { kid } = await setup();
    await addStudentUniversity(
      null,
      form({ studentProfileId: kid.id, universityId: "new", newName: "MIT", words: "900", primary: "on", round: "EA" })
    );
    await addStudentUniversity(
      null,
      form({ studentProfileId: kid.id, universityId: "new", newName: "Harvard", words: "800", primary: "on", round: "REA" })
    );
    const rows = await prisma.studentUniversity.findMany({
      where: { studentId: kid.id },
      include: { university: true },
    });
    const byName = Object.fromEntries(rows.map((r) => [r.university.name, r]));
    expect(byName.MIT).toMatchObject({ isPrimary: false, round: null });
    expect(byName.Harvard).toMatchObject({ isPrimary: true, round: "REA" });

    await setPrimaryUniversity(null, form({ studentProfileId: kid.id, id: byName.MIT.id, round: "" }));
    const after = await prisma.studentUniversity.findMany({ where: { studentId: kid.id, isPrimary: true } });
    expect(after.map((r) => r.id)).toEqual([byName.MIT.id]);
  });

  it("lets an admin, and not a mentor, correct a word count", async () => {
    const { fs, coach, kid } = await setup();
    await addStudentUniversity(
      null,
      form({ studentProfileId: kid.id, universityId: "new", newName: "Stanford", words: "500" })
    );
    const stanford = await prisma.university.findFirstOrThrow();

    actor.value = coach;
    expect(
      await correctUniversityWords(null, form({ universityId: stanford.id, words: "650" }))
    ).toMatchObject({ ok: false });

    const boss = await admin("Boss");
    await grant({ userId: boss.id, programId: fs.id });
    actor.value = boss;
    expect(
      await correctUniversityWords(null, form({ universityId: stanford.id, words: "650" }))
    ).toMatchObject({ ok: true });
    expect((await prisma.university.findUniqueOrThrow({ where: { id: stanford.id } })).supplementalWords).toBe(650);
  });
});
