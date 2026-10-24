import { describe, expect, it } from "vitest";

import { isDay, taskCreateForm, taskEditForm, taskEditOf, taskProgressForm } from "@/lib/api/v1/work-forms";
import type { ApiTask } from "@/lib/api/v1/types";

/**
 * The task actions read every field as `String(formData.get(name) ?? "")`, so
 * what a form holds is what they believe: a field that is missing is an answer
 * (`updateStudentTask` replaces a task whole, and `setStudentTaskProgress` reads
 * no percent as 0%).
 */
const current = { id: "t1", title: "Rewrite the draft", due: "2026-11-03", note: "Start with the intro." } as ApiTask;

const form = (made: FormData | { field: string }) => {
  if (!(made instanceof FormData)) throw new Error(`refused on ${made.field}`);
  return Object.fromEntries(made);
};

describe("isDay", () => {
  it("takes a real calendar day and nothing else", () => {
    expect(isDay("2026-11-03")).toBe(true);
    expect(isDay("2024-02-29")).toBe(true);
    expect(isDay("2026-02-31")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("2026-2-3")).toBe(false);
    expect(isDay(" 2026-11-03")).toBe(false);
    expect(isDay("2026-11-03T00:00:00Z")).toBe(false);
    expect(isDay(20261103)).toBe(false);
  });
});

describe("taskCreateForm", () => {
  const body = { studentProfileId: "p1", programId: "g1", title: "Rewrite", due: "2026-11-03" };

  it("sends the five fields setStudentTask reads, with the day as dueOn", () => {
    expect(form(taskCreateForm({ ...body, note: "Intro first." }))).toEqual({
      studentProfileId: "p1",
      programId: "g1",
      title: "Rewrite",
      dueOn: "2026-11-03",
      note: "Intro first.",
    });
  });

  it("sends a left-out note as an empty one", () => expect(form(taskCreateForm(body)).note).toBe(""));

  it("refuses 2026-02-31 with field \"due\"", () =>
    expect(taskCreateForm({ ...body, due: "2026-02-31" })).toEqual({ field: "due" }));

  it("refuses a title over 100 characters with field \"title\"", () => {
    expect(taskCreateForm({ ...body, title: "x".repeat(101) })).toEqual({ field: "title" });
    expect(taskCreateForm({ ...body, title: "x".repeat(100) })).toBeInstanceOf(FormData);
  });

  it("refuses a note over 500 characters with field \"note\"", () =>
    expect(taskCreateForm({ ...body, note: "x".repeat(501) })).toEqual({ field: "note" }));

  it("refuses a field of the wrong type, on that field", () => {
    expect(taskCreateForm({ ...body, title: 5 })).toEqual({ field: "title" });
    expect(taskCreateForm({ ...body, studentProfileId: undefined })).toEqual({ field: "studentProfileId" });
    expect(taskCreateForm({ ...body, programId: null })).toEqual({ field: "programId" });
    expect(taskCreateForm({ ...body, note: 7 })).toEqual({ field: "note" });
    expect(taskCreateForm({ ...body, due: undefined })).toEqual({ field: "due" });
  });
});

describe("taskEditOf", () => {
  it("takes only title, due and note", () =>
    expect(taskEditOf({ title: "A", percent: 90, mentorId: "m" })).toEqual({ edit: { title: "A" } }));

  it("refuses a value of the wrong type, on its field", () => {
    expect(taskEditOf({ title: 3 })).toEqual({ field: "title" });
    expect(taskEditOf({ due: null })).toEqual({ field: "due" });
    expect(taskEditOf({ note: 3 })).toEqual({ field: "note" });
  });
});

describe("taskEditForm", () => {
  it("keeps everything an edit leaves out", () =>
    expect(form(taskEditForm(current, { title: "New" }))).toEqual({
      taskId: "t1",
      title: "New",
      dueOn: "2026-11-03",
      note: "Start with the intro.",
    }));

  it("fills a left-out note from the stored task, and null clears it", () => {
    expect(form(taskEditForm(current, { due: "2026-11-10" })).note).toBe("Start with the intro.");
    expect(form(taskEditForm(current, { note: null })).note).toBe("");
    expect(form(taskEditForm({ ...current, note: null }, { title: "New" })).note).toBe("");
  });

  it("refuses an impossible day and a long title", () => {
    expect(taskEditForm(current, { due: "2026-02-31" })).toEqual({ field: "due" });
    expect(taskEditForm(current, { title: "x".repeat(101) })).toEqual({ field: "title" });
  });
});

describe("taskProgressForm", () => {
  it("taskProgressForm({}) is refused with field \"percent\", never sent as 0", () =>
    expect(taskProgressForm("t1", {})).toEqual({ field: "percent" }));

  it("taskProgressForm({ done: true }) sends intent=done", () =>
    expect(form(taskProgressForm("t1", { done: true }))).toEqual({ taskId: "t1", intent: "done" }));

  it("sends a percent as intent=percent", () => {
    expect(form(taskProgressForm("t1", { percent: 50 }))).toEqual({ taskId: "t1", intent: "percent", percent: "50" });
    expect(form(taskProgressForm("t1", { percent: 0 })).percent).toBe("0");
    expect(form(taskProgressForm("t1", { percent: 100 })).percent).toBe("100");
  });

  it("refuses everything else on field \"percent\"", () => {
    for (const body of [
      { percent: "50" },
      { percent: 101 },
      { percent: -1 },
      { percent: 12.5 },
      { percent: null },
      { percent: Infinity },
      { done: false },
      { done: "true" },
      { done: true, percent: 50 },
    ])
      expect(taskProgressForm("t1", body)).toEqual({ field: "percent" });
  });
});
