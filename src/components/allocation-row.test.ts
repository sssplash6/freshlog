import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AllocationsTable,
  timeByMentorEntries,
  type AllocationEntry,
} from "@/components/allocation-row";

const hasan: AllocationEntry = {
  mentor: { id: "hasan", name: "Hasan Mavlonov", email: "hasan@example.com" },
  program: { id: "masters", name: "Master's" },
  allocated: 60,
  completed: 111,
  missed: 0,
  remaining: -51,
  forfeited: 0,
  expired: false,
  deadline: new Date("2026-11-26T00:00:00Z"),
};

const plan = (minuteLimit: number, progress = "IN_PROGRESS") => ({
  programId: "masters",
  mentorId: "hasan",
  minuteLimit,
  progress,
  mentor: hasan.mentor,
  program: hasan.program,
});

describe("time by mentor", () => {
  it("does not count a grant-funded agenda budget twice", () => {
    // The ordinary case: a 4h grant named a task, and the task was born with
    // the same 4h as its budget. Assigned is the commitment — 4h, not 8h.
    const entries = timeByMentorEntries(
      [{ ...hasan, allocated: 240, completed: 60, remaining: 180 }],
      [plan(240)],
    );

    expect(entries[0]).toMatchObject({ allocated: 240, assigned: 240 });
  });

  it("still shows an agenda budget that outgrows its grant", async () => {
    const entries = timeByMentorEntries([hasan], [plan(720)]);

    expect(entries[0]).toMatchObject({ allocated: 60, assigned: 720 });

    const html = renderToStaticMarkup(
      createElement(AllocationsTable, { entries, framed: false }),
    );
    expect(html).toContain("12h");
  });

  it("ignores a finished item's budget", () => {
    const entries = timeByMentorEntries([hasan], [plan(720, "DONE")]);

    expect(entries[0]).toMatchObject({ allocated: 60, assigned: 60 });
  });

  it("adds a mentor who has planned work but no allocation yet", () => {
    const [entry] = timeByMentorEntries([], [plan(720)]);

    expect(entry).toMatchObject({
      mentor: { id: "hasan" },
      allocated: 0,
      completed: 0,
      remaining: 0,
      assigned: 720,
    });
  });
});
