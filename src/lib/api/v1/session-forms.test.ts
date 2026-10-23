import { describe, expect, it } from "vitest";

import { answerForm, answerOf, editForm, editOf, isMinutes, isOneOf, isText } from "@/lib/api/v1/session-forms";
import type { ApiSession, TimeKind } from "@/lib/api/v1/types";

/**
 * The actions read every field as `String(formData.get(name) ?? "")`, so what a
 * form holds is what they believe, and a missing field is an answer too:
 * `editSession` replaces a session whole, and a field it isn't sent resets.
 */
const current = {
  id: "s1",
  day: "2026-10-20",
  minutes: 60,
  attendance: "LATE",
  kind: "EXTRA",
  note: "Essay",
  task: { id: "a1", purpose: "Essay" },
} as ApiSession;

describe("editForm", () => {
  // What the row holds. For most readers it is what `current` shows too.
  const stored = "Essay";

  it("keeps everything an edit leaves out", () => {
    expect(Object.fromEntries(editForm(current, { minutes: 45 }, stored))).toEqual({
      sessionId: "s1",
      minutes: "45",
      date: "2026-10-20",
      attendance: "LATE",
      timeKind: "EXTRA",
      note: "Essay",
      assignmentId: "a1",
    });
  });

  it("changes every field it is sent", () => {
    const edit = {
      day: "2026-10-21",
      minutes: 30,
      attendance: "ABSENT",
      kind: "PLAN",
      note: "Redo the opening.",
      assignmentId: "a2",
    } as const;
    expect(Object.fromEntries(editForm(current, edit, stored))).toEqual({
      sessionId: "s1",
      minutes: "30",
      date: "2026-10-21",
      attendance: "ABSENT",
      timeKind: "PLAN",
      note: "Redo the opening.",
      assignmentId: "a2",
    });
  });

  // A student who also administers the program may edit their own session, and
  // is never shown the mentor's note: `current.note` is null for them while the
  // row has one. Filled from `current`, any edit would erase it.
  it("a note the edit leaves out is the stored one, whatever the reader saw", () => {
    const unseen = { ...current, note: null };
    expect(editForm(unseen, { minutes: 45 }, "Went through the essay.").get("note")).toBe("Went through the essay.");
  });

  it("sends a note the edit names, not the stored one", () =>
    expect(editForm(current, { note: "Redo the opening." }, stored).get("note")).toBe("Redo the opening."));

  it("clears a note with an empty string, never the word null", () =>
    expect(editForm(current, { note: null }, stored).get("note")).toBe(""));

  it("clears a note the same way when it is sent as an empty string", () =>
    expect(editForm(current, { note: "" }, stored).get("note")).toBe(""));

  it("sends an empty note for a session that has none", () =>
    expect(editForm(current, { minutes: 45 }, null).get("note")).toBe(""));

  it("leaves out a plan item the session doesn't have", () =>
    expect(editForm({ ...current, task: null }, {}, stored).has("assignmentId")).toBe(false));

  it("names a plan item the session doesn't have yet", () =>
    expect(editForm({ ...current, task: null }, { assignmentId: "a2" }, stored).get("assignmentId")).toBe("a2"));

  it("keeps the plan item it has when the edit names an empty one", () =>
    expect(editForm(current, { assignmentId: "" }, stored).get("assignmentId")).toBe("a1"));

  it("never writes the words null or undefined, whatever the session lacks", () => {
    const bare = editForm({ ...current, note: null, task: null }, {}, null);
    expect([...bare.values()]).not.toContain("null");
    expect([...bare.values()]).not.toContain("undefined");
    expect(bare.get("note")).toBe("");
  });

  it("holds the action's fields and no others, so no mentor is ever named", () => {
    const form = editForm(current, { minutes: 45 }, stored);
    expect([...form.keys()].sort()).toEqual(
      ["assignmentId", "attendance", "date", "minutes", "note", "sessionId", "timeKind"].sort()
    );
  });
});

describe("editOf", () => {
  it("takes the six fields an edit may name", () => {
    const body = {
      day: "2026-10-21",
      minutes: 45,
      attendance: "RESCHEDULED",
      kind: "EXTRA",
      note: null,
      assignmentId: "a2",
    };
    expect(editOf(body)).toEqual({ edit: body });
  });

  it("takes an empty body as an edit that changes nothing", () => expect(editOf({})).toEqual({ edit: {} }));

  it("passes on only what it knows, so a body cannot name another session or a mentor", () =>
    expect(editOf({ minutes: 45, sessionId: "s2", mentorId: "m2", status: "VOIDED" })).toEqual({
      edit: { minutes: 45 },
    }));

  // Wording and range are the action's to judge ("Minutes must be whole
  // minutes", "Pick a valid date."); only a value of the wrong type is refused
  // here, and an attendance or a kind that is none of its values, because the
  // action would quietly turn those into Attended and Plan.
  it.each([
    ["day", 20261021],
    ["day", null],
    ["minutes", "lots"],
    ["minutes", "45"],
    ["minutes", null],
    ["attendance", "SKIPPED"],
    ["attendance", "late"],
    ["attendance", null],
    ["kind", "FREE"],
    ["kind", false],
    ["note", 5],
    ["assignmentId", 7],
    ["assignmentId", null],
  ])("names %s when it is %j", (field, value) => expect(editOf({ [field]: value })).toEqual({ field }));

  // JSON has no Infinity, but a number too large for a double parses to one.
  it("takes minutes too large to be a number as not a number", () =>
    expect(editOf(JSON.parse('{"minutes":1e999}'))).toEqual({ field: "minutes" }));

  it("names the first field that is wrong, in the order the contract lists them", () =>
    expect(editOf({ note: 5, minutes: "lots", day: "2026-10-21" })).toEqual({ field: "minutes" }));

  it.each(["", "not a day", "2999-01-01"])("leaves the day %j to the action", (day) =>
    expect(editOf({ day })).toEqual({ edit: { day } })
  );

  it.each([0, -5, 1.5, 100000])("leaves the minutes %j to the action", (minutes) =>
    expect(editOf({ minutes })).toEqual({ edit: { minutes } })
  );
});

describe("answerForm", () => {
  it("sends the session, the answer and the note when there is one", () =>
    expect(Object.fromEntries(answerForm("s1", { answer: "DISPUTED", note: "It was 30 minutes." }))).toEqual({
      sessionId: "s1",
      answer: "DISPUTED",
      studentNote: "It was 30 minutes.",
    }));

  it("leaves the note out when there isn't one, and never rates", () => {
    const form = answerForm("s1", { answer: "CONFIRMED" });
    expect(Object.fromEntries(form)).toEqual({ sessionId: "s1", answer: "CONFIRMED" });
    expect(form.has("studentNote")).toBe(false);
    expect(form.has("studentRating")).toBe(false);
  });

  it("sends an empty note as it is, for the action to treat as none", () =>
    expect(answerForm("s1", { answer: "CONFIRMED", note: "" }).get("studentNote")).toBe(""));

  it("never writes the words null or undefined", () => {
    const form = answerForm("s1", { answer: "CONFIRMED", note: undefined });
    expect([...form.values()]).not.toContain("undefined");
    expect([...form.values()]).not.toContain("null");
  });
});

/** The checks every body is held to, an edit's here and a log's in log.ts. */
describe("the field checks", () => {
  const values = ["PLAN", "plan", "", 45, 1e999, Number.NaN, null, undefined, ["PLAN"]];

  it("isText takes text, an empty one too, and nothing else", () =>
    expect(values.map((value) => isText(value))).toEqual([true, true, true, false, false, false, false, false, false]));

  it("isMinutes takes a finite number, and leaves its range to the action", () =>
    expect(values.map((value) => isMinutes(value))).toEqual([false, false, false, true, false, false, false, false, false]));

  it("isOneOf takes a choice only as the contract spells it", () =>
    expect(values.map((value) => isOneOf<TimeKind>(["PLAN", "EXTRA"])(value))).toEqual([
      true, false, false, false, false, false, false, false, false,
    ]));

  // `tsc` holds these two: an @ts-expect-error with nothing to expect is itself an error.
  it("isOneOf is typed from the contract: each call names its type, and takes only that type's choices", () => {
    // @ts-expect-error -- "BONUS" is no TimeKind, so it can't be one of the choices.
    isOneOf<TimeKind>(["PLAN", "BONUS"]);
    // @ts-expect-error -- a call that names no type has no choices to take.
    isOneOf(["PLAN", "EXTRA"]);
  });
});

describe("answerOf", () => {
  it("takes the answer, and the note when it comes", () => {
    expect(answerOf({ answer: "CONFIRMED" })).toEqual({ request: { answer: "CONFIRMED" } });
    expect(answerOf({ answer: "DISPUTED", note: "It was 30 minutes." })).toEqual({
      request: { answer: "DISPUTED", note: "It was 30 minutes." },
    });
  });

  it("passes on only what it knows, so a rating or another session's id goes nowhere", () =>
    expect(answerOf({ answer: "CONFIRMED", studentRating: 5, sessionId: "s2" })).toEqual({
      request: { answer: "CONFIRMED" },
    }));

  it.each([
    ["answer", undefined],
    ["answer", "MAYBE"],
    ["answer", "confirmed"],
    ["answer", true],
    ["note", 5],
    ["note", null],
  ])("names %s when it is %j", (field, value) =>
    expect(answerOf({ answer: "CONFIRMED", [field]: value })).toEqual({ field })
  );
});
