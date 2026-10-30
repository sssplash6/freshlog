import { describe, expect, it } from "vitest";

import {
  adminScope,
  adminWriteScope,
  assertPlatformAdmin,
  assertProgramScope,
  canAdministerMentor,
  canAdministerStudent,
  canManageMentor,
  canManageProgram,
  canManageStudent,
  mentorReaches,
  ratingSeenByMentor,
  scopeProgramIds,
  staffLevel,
  withoutMentorNotes,
} from "@/lib/authz";
import {
  admin,
  allocation,
  assignment,
  cohort,
  grant,
  mentor,
  pairing,
  platformAdmin,
  program,
  session,
  student,
} from "@/test/db";

/**
 * The permission model, stated as tests, because it is the one part of this
 * app where being wrong is silent: an over-wide answer shows somebody another
 * program's students and nothing anywhere says so.
 *
 * The load-bearing case is the first one — an ADMIN row with no grants reaches
 * nothing. Every "admins see everything when they hold nothing" fallback that
 * has ever been written was written to make a page stop looking broken.
 */
describe("adminScope", () => {
  it("gives a platform admin every program without a grant", async () => {
    const p = await platformAdmin();
    await program("Master's");

    expect(await adminScope(p)).toBe("ALL");
  });

  it("gives an admin exactly the programs they were granted", async () => {
    const [a, one, two] = await Promise.all([
      admin(),
      program("Master's"),
      program("Flexible"),
    ]);
    await program("Global Admissions");
    await grant({ userId: a.id, programId: one.id });
    await grant({ userId: a.id, programId: two.id });

    const scope = await adminScope(a);

    expect(scope).not.toBe("ALL");
    expect([...(scope as ReadonlySet<string>)].sort()).toEqual(
      [one.id, two.id].sort()
    );
  });

  it("gives the ADMIN role alone nothing at all", async () => {
    const a = await admin();
    await program("Master's");

    expect(await adminScope(a)).toEqual(new Set());
  });

  it("resolves every program id for a platform admin", async () => {
    const p = await platformAdmin();
    const [one, two] = await Promise.all([program("A"), program("B")]);

    expect((await scopeProgramIds(await adminScope(p))).sort()).toEqual(
      [one.id, two.id].sort()
    );
  });
});

describe("staffLevel", () => {
  it("reads ADMIN for a platform admin in a program they hold no row for", async () => {
    const [p, prog] = await Promise.all([platformAdmin(), program()]);

    expect(await staffLevel(p, prog.id)).toBe("ADMIN");
  });

  it("reads the granted level, and null outside the grant", async () => {
    const [a, one, two] = await Promise.all([admin(), program("A"), program("B")]);
    await grant({ userId: a.id, programId: one.id, role: "SALES" });

    expect(await staffLevel(a, one.id)).toBe("SALES");
    expect(await staffLevel(a, two.id)).toBeNull();
  });
});

describe("canManageProgram / canManageStudent", () => {
  it("holds a granted program and refuses the one next to it", async () => {
    const [a, mine, theirs] = await Promise.all([
      admin(),
      program("Mine"),
      program("Theirs"),
    ]);
    await grant({ userId: a.id, programId: mine.id });
    const [ours, others] = await Promise.all([
      student({ programId: mine.id }),
      student({ programId: theirs.id }),
    ]);

    expect(await canManageProgram(a, mine.id)).toBe(true);
    expect(await canManageProgram(a, theirs.id)).toBe(false);
    expect(await canManageStudent(a, ours)).toBe(true);
    expect(await canManageStudent(a, others)).toBe(false);
  });
});

describe("canManageMentor", () => {
  it("needs a program in common", async () => {
    const [a, mine, theirs, m] = await Promise.all([
      admin(),
      program("Mine"),
      program("Theirs"),
      mentor(),
    ]);
    await grant({ userId: a.id, programId: mine.id });
    await pairing({ mentorId: m.id, programId: theirs.id });

    expect(await canManageMentor(a, m.id)).toBe(false);

    await pairing({ mentorId: m.id, programId: mine.id });

    expect(await canManageMentor(a, m.id)).toBe(true);
  });

  it("leaves a mentor paired with nothing to a platform admin", async () => {
    const [a, p, prog, m] = await Promise.all([
      admin(),
      platformAdmin(),
      program(),
      mentor(),
    ]);
    await grant({ userId: a.id, programId: prog.id });

    expect(await canManageMentor(a, m.id)).toBe(false);
    expect(await canManageMentor(p, m.id)).toBe(true);
  });
});

/**
 * The level on a grant is real: LEADER and SALES rows are read membership.
 * They count in `adminScope` — the program's pages open and its figures read —
 * and are absent from `adminWriteScope`, which every write assertion asks. A
 * read-only badge on a read-write key was the bug this describe exists to keep
 * dead: if a write assert ever asks the read set again, these fail.
 */
describe("read-only grant levels (LEADER / SALES)", () => {
  it("reads the program but holds no write scope for it", async () => {
    const [a, prog] = await Promise.all([admin(), program("Watched")]);
    await grant({ userId: a.id, programId: prog.id, role: "LEADER" });

    expect(await adminScope(a)).toEqual(new Set([prog.id]));
    expect(await adminWriteScope(a)).toEqual(new Set());
  });

  it("opens a student's page and refuses to change them", async () => {
    const [a, prog] = await Promise.all([admin(), program("Watched")]);
    await grant({ userId: a.id, programId: prog.id, role: "SALES" });
    const s = await student({ programId: prog.id });

    expect(await canManageStudent(a, s)).toBe(true);
    expect(await canAdministerStudent(a, s)).toBe(false);
  });

  it("opens a mentor's record and refuses to change it", async () => {
    const [a, prog, m] = await Promise.all([admin(), program(), mentor()]);
    await grant({ userId: a.id, programId: prog.id, role: "LEADER" });
    await pairing({ mentorId: m.id, programId: prog.id });

    expect(await canManageMentor(a, m.id)).toBe(true);
    expect(await canAdministerMentor(a, m.id)).toBe(false);
  });

  it("refuses every write assertion on the program", async () => {
    const [a, prog] = await Promise.all([admin(), program("Watched")]);
    await grant({ userId: a.id, programId: prog.id, role: "SALES" });

    expect(await canManageProgram(a, prog.id)).toBe(false);
    expect(await assertProgramScope(a, prog.id)).toEqual({
      ok: false,
      error: "You don't administer that program.",
    });
  });

  it("still refuses a write when the same user holds ADMIN elsewhere", async () => {
    const [a, writes, reads] = await Promise.all([
      admin(),
      program("Writable"),
      program("Readable"),
    ]);
    await grant({ userId: a.id, programId: writes.id });
    await grant({ userId: a.id, programId: reads.id, role: "LEADER" });

    expect(await assertProgramScope(a, writes.id)).toBeNull();
    expect(await assertProgramScope(a, reads.id)).toEqual({
      ok: false,
      error: "You don't administer that program.",
    });
  });

  it("lets a platform admin write regardless of level rows", async () => {
    const [p, prog] = await Promise.all([platformAdmin(), program()]);
    await grant({ userId: p.id, programId: prog.id, role: "SALES" });

    expect(await adminWriteScope(p)).toBe("ALL");
    expect(await assertProgramScope(p, prog.id)).toBeNull();
  });
});

/**
 * The five legs, one test each. They are separate rows in separate tables on
 * purpose: hours can be granted and removed, a task can be moved, a session
 * already happened, and each of those alone makes somebody a mentor's student.
 */
describe("mentorReaches", () => {
  it("reaches a student they hold hours with", async () => {
    const [prog, m] = await Promise.all([program(), mentor()]);
    const s = await student({ programId: prog.id });
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });

    expect(await mentorReaches(m, s)).toBe(true);
  });

  it("reaches a student they have logged a session with", async () => {
    const [prog, m] = await Promise.all([program(), mentor()]);
    const s = await student({ programId: prog.id });
    await session({ studentId: s.id, mentorId: m.id, minutes: 60 });

    expect(await mentorReaches(m, s)).toBe(true);
  });

  it("reaches a student whose task is theirs, with no hours and no history", async () => {
    const [prog, m] = await Promise.all([program(), mentor()]);
    const s = await student({ programId: prog.id });
    await assignment({ studentId: s.id, mentorId: m.id });

    expect(await mentorReaches(m, s)).toBe(true);
  });

  it("reaches a student holding unassigned time in a program they work in", async () => {
    const [prog, m] = await Promise.all([program(), mentor()]);
    const s = await student({ programId: prog.id });
    await pairing({ mentorId: m.id, programId: prog.id });
    await allocation({ studentId: s.id, mentorId: null, minutes: 300 });

    expect(await mentorReaches(m, s)).toBe(true);
  });

  it("reaches anyone else in a program they work in, so a meeting can be recorded", async () => {
    const [prog, m] = await Promise.all([program(), mentor()]);
    const s = await student({ programId: prog.id });
    await pairing({ mentorId: m.id, programId: prog.id });

    expect(await mentorReaches(m, s)).toBe(true);
  });

  it("does not reach a student in a program they do not work in", async () => {
    const [mine, theirs, m] = await Promise.all([
      program("Mine"),
      program("Theirs"),
      mentor(),
    ]);
    await pairing({ mentorId: m.id, programId: mine.id });
    const s = await student({ programId: theirs.id });

    expect(await mentorReaches(m, s)).toBe(false);
  });

  it("reads a cohort-scoped pairing as the whole program it is inside", async () => {
    // A cohort narrows a caseload, never reach: the rule is that a mentor
    // assigned to a program may log hours with anybody enrolled in it, and a
    // Spring-25 student who turns up to an Autumn-25 mentor's meeting is
    // exactly the case the fifth leg exists for.
    const [prog, m] = await Promise.all([program(), mentor()]);
    const [mine, theirs] = await Promise.all([
      cohort({ programId: prog.id, name: "Autumn" }),
      cohort({ programId: prog.id, name: "Spring" }),
    ]);
    await pairing({ mentorId: m.id, programId: prog.id, cohortId: mine.id });
    const [inCohort, outside] = await Promise.all([
      student({ programId: prog.id, cohortId: mine.id }),
      student({ programId: prog.id, cohortId: theirs.id }),
    ]);

    expect(await mentorReaches(m, inCohort)).toBe(true);
    expect(await mentorReaches(m, outside)).toBe(true);
  });

  it("still stops at the edge of the programs they are assigned to", async () => {
    const [mine, theirs, m] = await Promise.all([
      program("Mine"),
      program("Theirs"),
      mentor(),
    ]);
    await pairing({ mentorId: m.id, programId: mine.id });
    const [ours, others] = await Promise.all([
      student({ programId: mine.id }),
      student({ programId: theirs.id }),
    ]);

    expect(await mentorReaches(m, ours)).toBe(true);
    expect(await mentorReaches(m, others)).toBe(false);
  });

  it("still reaches a student whose hours survived the pairing being removed", async () => {
    const [prog, m] = await Promise.all([program(), mentor()]);
    const s = await student({ programId: prog.id });
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 120 });

    // No MentorAssignment row at all: the grant is the authorization.
    expect(await mentorReaches(m, s)).toBe(true);
  });
});

describe("assertProgramScope / assertPlatformAdmin", () => {
  it("passes silently in scope and refuses in a sentence outside it", async () => {
    const [a, mine, theirs] = await Promise.all([
      admin(),
      program("Mine"),
      program("Theirs"),
    ]);
    await grant({ userId: a.id, programId: mine.id });

    expect(await assertProgramScope(a, mine.id)).toBeNull();
    expect(await assertProgramScope(a, theirs.id)).toEqual({
      ok: false,
      error: "You don't administer that program.",
    });
  });

  it("refuses a signed-out caller before it asks anything else", async () => {
    const prog = await program();

    expect(await assertProgramScope(null, prog.id)).toEqual({
      ok: false,
      error: "Sign in to do that.",
    });
    expect(assertPlatformAdmin(null)).toEqual({
      ok: false,
      error: "Sign in to do that.",
    });
  });

  it("lets only a platform admin past the platform gate", async () => {
    const [a, p] = await Promise.all([admin(), platformAdmin()]);

    expect(assertPlatformAdmin(p)).toBeNull();
    expect(assertPlatformAdmin(a)).toEqual({
      ok: false,
      error: "Only a platform admin can do that.",
    });
  });
});

describe("withoutMentorNotes", () => {
  const session = (note: string | null) => ({
    id: "s1",
    minutes: 60,
    note,
    studentNote: "I thought it went well",
  });

  it("blanks the mentor's note", () => {
    expect(withoutMentorNotes([session("Struggled with the opening")])[0].note)
      .toBeNull();
  });

  it("leaves the student's own words alone", () => {
    expect(withoutMentorNotes([session("anything")])[0].studentNote).toBe(
      "I thought it went well"
    );
  });

  it("keeps every other field, so the row still reads", () => {
    const [out] = withoutMentorNotes([session("x")]);
    expect(out.id).toBe("s1");
    expect(out.minutes).toBe(60);
  });

  it("does not mutate what it was given — the staff board reads the same rows", () => {
    const rows = [session("Struggled with the opening")];
    withoutMentorNotes(rows);
    expect(rows[0].note).toBe("Struggled with the opening");
  });

  it("is a no-op on a session that had no note", () => {
    expect(withoutMentorNotes([session(null)])[0].note).toBeNull();
  });
});

describe("ratingSeenByMentor", () => {
  it("names the meetings whose own mentor administers their program", async () => {
    const ga = await program("Global Admissions");
    const imkon = await program("Imkon");
    const valera = await mentor("Valera");
    await grant({ userId: valera.id, programId: ga.id });
    await grant({ userId: valera.id, programId: imkon.id, role: "LEADER" });
    const plain = await mentor("Plain Mentor");
    const founder = await platformAdmin("Founder");
    const seen = await ratingSeenByMentor([
      { id: "admin-here", programId: ga.id, mentor: valera },
      { id: "leader-there", programId: imkon.id, mentor: valera },
      { id: "no-grant", programId: ga.id, mentor: plain },
      { id: "platform", programId: imkon.id, mentor: founder },
    ]);
    expect([...seen].sort()).toEqual(["admin-here", "platform"]);
  });

  it("asks nothing of an empty page", async () => {
    expect((await ratingSeenByMentor([])).size).toBe(0);
  });
});
