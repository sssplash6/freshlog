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

describe("time by mentor", () => {
  it("adds an agenda budget to the assigned total", () => {
    const entries = timeByMentorEntries(
      [hasan],
      [
        {
          programId: "masters",
          mentorId: "hasan",
          minuteLimit: 720,
          mentor: hasan.mentor,
          program: hasan.program,
        },
      ],
    );

    expect(entries[0]).toMatchObject({ allocated: 60, assigned: 780 });

    const html = renderToStaticMarkup(
      createElement(AllocationsTable, { entries, framed: false }),
    );
    expect(html).not.toContain("Planned");
    expect(html).toContain("13h");
  });

  it("adds a mentor who has planned work but no allocation yet", () => {
    const [entry] = timeByMentorEntries(
      [],
      [
        {
          programId: "masters",
          mentorId: "hasan",
          minuteLimit: 720,
          mentor: hasan.mentor,
          program: hasan.program,
        },
      ],
    );

    expect(entry).toMatchObject({
      mentor: { id: "hasan" },
      allocated: 0,
      completed: 0,
      remaining: 0,
      assigned: 720,
    });
  });
});
