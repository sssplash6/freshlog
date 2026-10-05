import { describe, expect, it } from "vitest";

import { logSessionOptions, mentorCaseload } from "@/lib/queries";
import {
  allocation,
  assignment,
  cohort,
  enroll,
  mentor,
  pairing,
  program,
  session,
  student,
} from "@/test/db";

/**
 * "Who are my students?" — the question `/mentor` opens with.
 *
 * Hours and tasks are separate rows, and a task can be moved between mentors
 * on its own while the hours stay banked with whoever they were granted to. So
 * a caseload built only from hours answered this question with ten people for
 * a mentor whose list held dozens of students' work.
 */
describe("mentorCaseload", () => {
  it("lists a student whose task is this mentor's, with no hours and no sessions", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id, name: "Guzal" });
    const m = await mentor("Umid");
    await assignment({ studentId: s.id, mentorId: m.id, purpose: "Essay writing" });

    const { students } = await mentorCaseload(m.id);

    expect(students).toHaveLength(1);
    expect(students[0]).toMatchObject({
      reach: "task",
      allocated: 0,
      remaining: 0,
      deadline: null,
    });
    expect(students[0].profile.id).toBe(s.id);
  });

  it("does not list a student over a task nobody owns yet", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await assignment({ studentId: s.id, mentorId: null });

    const { students } = await mentorCaseload(m.id);

    expect(students).toHaveLength(0);
  });

  it("keeps a student the mentor already holds hours with as one allocation row", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });
    await assignment({ studentId: s.id, mentorId: m.id });

    const { students } = await mentorCaseload(m.id);

    expect(students).toHaveLength(1);
    expect(students[0]).toMatchObject({ reach: "allocation", allocated: 600 });
  });

  it("names a task student once, however many tasks of theirs are this mentor's", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await assignment({ studentId: s.id, mentorId: m.id, purpose: "Essay writing" });
    await assignment({
      studentId: s.id,
      mentorId: m.id,
      purpose: "University list building",
      position: 1,
    });

    const { students } = await mentorCaseload(m.id);

    expect(students).toHaveLength(1);
    expect(students[0].reach).toBe("task");
  });
});

/**
 * Who the log picker offers — the mentor half of the permission model, read
 * back out of the query that builds the form.
 *
 * The rule is one sentence: a mentor assigned to a program may log hours with
 * anybody enrolled in that program. Every case below is a way the picker used
 * to disagree with `logSession`, and a picker that hides somebody the action
 * would have accepted is a permission the form invented.
 */
describe("who a mentor may log for", () => {
  const optionFor = (
    options: ReturnType<typeof logSessionOptions>,
    profileId: string
  ) => options.find((o) => o.profileId === profileId);

  it("offers everyone in the mentor's program, granted or not", async () => {
    const p = await program("Master's");
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id });
    const s = await student({ programId: p.id, name: "Guzal" });

    const caseload = await mentorCaseload(m.id);
    const option = optionFor(logSessionOptions(caseload), s.id);

    expect(caseload.students).toHaveLength(0);
    expect(option?.programs).toEqual([
      expect.objectContaining({ value: p.id, balance: "No time allocated to you" }),
    ]);
  });

  it("ignores the cohort a pairing names", async () => {
    const p = await program("Global Admissions");
    const [autumn, spring] = await Promise.all([
      cohort({ programId: p.id, name: "Autumn" }),
      cohort({ programId: p.id, name: "Spring" }),
    ]);
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id, cohortId: autumn.id });
    const s = await student({ programId: p.id, cohortId: spring.id });

    const options = logSessionOptions(await mentorCaseload(m.id));

    expect(optionFor(options, s.id)).toBeDefined();
  });

  it("keeps a student whose hours expired — logging still counts against them", async () => {
    const p = await program("Master's");
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id });
    const s = await student({ programId: p.id });
    await allocation({
      studentId: s.id,
      mentorId: m.id,
      minutes: 600,
      deadlineInDays: -1,
    });

    const options = logSessionOptions(await mentorCaseload(m.id));

    expect(optionFor(options, s.id)?.programs[0].balance).toContain(
      "logging still counts against them"
    );
  });

  it("marks each student by what logging for them would do to the balance", async () => {
    const p = await program("Master's");
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id });
    const [fine, none, over, expired] = await Promise.all([
      student({ programId: p.id, name: "Fine" }),
      student({ programId: p.id, name: "None" }),
      student({ programId: p.id, name: "Over" }),
      student({ programId: p.id, name: "Expired" }),
    ]);
    await allocation({ studentId: fine.id, mentorId: m.id, minutes: 600 });
    await allocation({ studentId: over.id, mentorId: m.id, minutes: 60 });
    await session({ studentId: over.id, mentorId: m.id, minutes: 180 });
    await allocation({ studentId: expired.id, mentorId: m.id, minutes: 600, deadlineInDays: -1 });

    const options = logSessionOptions(await mentorCaseload(m.id));
    const state = (id: string) => optionFor(options, id)?.programs[0].state;

    expect(state(fine.id)).toBe("ready");
    expect(state(none.id)).toBe("none");
    expect(state(over.id)).toBe("overdrawn");
    expect(state(expired.id)).toBe("expired");
    expect(optionFor(options, over.id)?.programs[0].balance).toBe(
      "Overdrawn by 2h — logging adds to it"
    );
    // Held at the bottom, so the default pick is never the spent one.
    expect(options[0].profileId).toBe(fine.id);
    expect(options.slice(-2).map((o) => o.profileId).sort()).toEqual(
      [over.id, expired.id].sort()
    );
  });

  it("offers only the programs of theirs the student is actually in", async () => {
    const [mine, theirs] = await Promise.all([program("Mine"), program("Theirs")]);
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: mine.id });
    await pairing({ mentorId: m.id, programId: theirs.id });
    const s = await student({ programId: mine.id });

    const options = logSessionOptions(await mentorCaseload(m.id));

    expect(optionFor(options, s.id)?.programs.map((x) => x.value)).toEqual([mine.id]);
  });

  it("offers both programs when the student is in two of theirs", async () => {
    const [mine, also] = await Promise.all([program("Mine"), program("Also mine")]);
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: mine.id });
    await pairing({ mentorId: m.id, programId: also.id });
    const s = await student({ programId: mine.id });
    await enroll({ studentId: s.id, programId: also.id });

    const options = logSessionOptions(await mentorCaseload(m.id));

    expect(optionFor(options, s.id)?.programs.map((x) => x.value).sort()).toEqual(
      [mine.id, also.id].sort()
    );
  });

  it("offers nobody from a program the mentor is not assigned to", async () => {
    const [mine, theirs] = await Promise.all([program("Mine"), program("Theirs")]);
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: mine.id });
    const outside = await student({ programId: theirs.id });

    const options = logSessionOptions(await mentorCaseload(m.id));

    expect(optionFor(options, outside.id)).toBeUndefined();
  });

  it("leaves out a student who has not been approved yet", async () => {
    const p = await program("Master's");
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id });
    const s = await student({ programId: p.id, status: "PENDING" });

    const options = logSessionOptions(await mentorCaseload(m.id));

    expect(optionFor(options, s.id)).toBeUndefined();
  });
});
