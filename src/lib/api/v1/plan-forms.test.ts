import { describe, expect, it } from "vitest";

import { planItemEditForm, planItemEditOf, planItemProgressForm } from "@/lib/api/v1/plan-forms";
import type { ApiPlanItem } from "@/lib/api/v1/types";

/**
 * `updateAssignment` replaces a plan item whole, and reads every field as
 * `String(formData.get(name) ?? "")`: a field it isn't sent resets.
 */
const current = {
  id: "a1",
  purpose: "Personal statement",
  minuteLimit: 120,
  due: "2026-11-02",
  dueNote: "Early November",
  note: null,
  progress: "IN_PROGRESS",
} as ApiPlanItem;

// What the row holds. `current.note` is null for a student's view, the row's is not.
const stored = { mentorId: "m1", progress: "DONE", note: "Weak on structure." };

describe("planItemEditOf", () => {
  it("takes the five fields, and nothing a body names besides", () => {
    expect(
      planItemEditOf({ purpose: "Essay", minuteLimit: null, due: null, dueNote: "x", note: "y", mentorId: "z", progress: "DONE" })
    ).toEqual({ edit: { purpose: "Essay", minuteLimit: null, due: null, dueNote: "x", note: "y" } });
  });

  it("refuses a field of the wrong type on that field", () => {
    expect(planItemEditOf({ purpose: null })).toEqual({ field: "purpose" });
    expect(planItemEditOf({ minuteLimit: "60" })).toEqual({ field: "minuteLimit" });
    expect(planItemEditOf({ dueNote: 5 })).toEqual({ field: "dueNote" });
    expect(planItemEditOf({ note: false })).toEqual({ field: "note" });
  });

  it("refuses a due day that does not exist, rather than letting it roll into March", () => {
    expect(planItemEditOf({ due: "2026-02-31" })).toEqual({ field: "due" });
    expect(planItemEditOf({ due: "" })).toEqual({ field: "due" });
  });
});

describe("planItemEditForm", () => {
  it("keeps the stored mentor and progress whatever the body says", () => {
    const body = { purpose: "Essay", mentorId: "someone-else", progress: "NOT_STARTED" };
    const asked = planItemEditOf(body);
    if (!("edit" in asked)) throw new Error("refused");
    const form = planItemEditForm(current, asked.edit, stored);
    if (!(form instanceof FormData)) throw new Error("refused");
    expect(form.get("mentorId")).toBe("m1");
    expect(form.get("progress")).toBe("DONE");
    // Even an edit forced to name them cannot move them.
    const forced = planItemEditForm(current, { mentorId: "x", progress: "NOT_STARTED" } as never, stored);
    expect(forced instanceof FormData && [forced.get("mentorId"), forced.get("progress")]).toEqual(["m1", "DONE"]);
  });

  it("keeps everything an edit leaves out", () => {
    const form = planItemEditForm(current, { minuteLimit: 90 }, stored);
    expect(Object.fromEntries(form as FormData)).toEqual({
      assignmentId: "a1",
      purpose: "",
      purposeCustom: "Personal statement",
      mentorId: "m1",
      minuteLimit: "90",
      dueNote: "Early November",
      dueOn: "2026-11-02",
      note: "Weak on structure.",
      progress: "DONE",
    });
  });

  it("fills a note a student was shown as null from the stored row", () => {
    const form = planItemEditForm(current, { purpose: "Statement" }, stored) as FormData;
    expect(form.get("note")).toBe("Weak on structure.");
  });

  it("clears with null, and sends an unassigned item's mentor as empty", () => {
    const form = planItemEditForm(
      current,
      { minuteLimit: null, due: null, dueNote: null, note: null },
      { mentorId: null, progress: "NOT_STARTED", note: "x" }
    ) as FormData;
    expect(Object.fromEntries(form)).toMatchObject({ mentorId: "", minuteLimit: "", dueNote: "", dueOn: "", note: "", progress: "NOT_STARTED" });
  });

  it("sends an item with no limit, day or note as empty fields", () => {
    const bare = { ...current, minuteLimit: null, due: null, dueNote: null } as ApiPlanItem;
    const form = planItemEditForm(bare, { purpose: "A" }, { mentorId: "m1", progress: "NOT_STARTED", note: null }) as FormData;
    expect(Object.fromEntries(form)).toMatchObject({ minuteLimit: "", dueNote: "", dueOn: "", note: "" });
  });

  it("refuses a due day that does not exist with field due", () => {
    expect(planItemEditForm(current, { due: "2026-02-31" }, stored)).toEqual({ field: "due" });
  });
});

describe("planItemProgressForm", () => {
  it.each(["NOT_STARTED", "IN_PROGRESS", "DONE", "AUTO"])("takes %s", (progress) => {
    const form = planItemProgressForm("a1", { progress }) as FormData;
    expect(Object.fromEntries(form)).toEqual({ assignmentId: "a1", progress });
  });

  it('refuses "PAUSED" with field "progress"', () => {
    expect(planItemProgressForm("a1", { progress: "PAUSED" })).toEqual({ field: "progress" });
  });

  it("refuses a missing, lower-case or non-text word, and a body that is no object", () => {
    for (const body of [{}, { progress: "done" }, { progress: 1 }, { progress: null }, null, "DONE", []])
      expect(planItemProgressForm("a1", body), JSON.stringify(body)).toEqual({ field: "progress" });
  });
});
