import { describe, expect, it } from "vitest";

import { parseTriage } from "@/lib/telegram-triage";

/** The model's answer is checked, never trusted. */
describe("parseTriage", () => {
  const offered = new Set(["r1"]);

  it("reads bugs, features and updates to an offered report", () => {
    const raw = JSON.stringify({
      items: [
        { verdict: "BUG", title: "Broken", description: "It broke." },
        { verdict: "FEATURE", title: "Wanted", description: "" },
        { verdict: "UPDATE", reportId: "r1", description: "More detail." },
      ],
    });
    expect(parseTriage(raw, offered)).toEqual([
      { verdict: "BUG", title: "Broken", description: "It broke." },
      { verdict: "FEATURE", title: "Wanted", description: "Wanted" },
      { verdict: "UPDATE", reportId: "r1", description: "More detail." },
    ]);
  });

  it("drops an update to a report it was not shown, and items without words", () => {
    const raw = JSON.stringify({
      items: [
        { verdict: "UPDATE", reportId: "guessed", description: "x" },
        { verdict: "BUG", title: "  ", description: "x" },
        { verdict: "CHATTER", title: "hi" },
      ],
    });
    expect(parseTriage(raw, offered)).toEqual([]);
  });

  it("reads JSON wrapped in a code fence, and caps the number of items", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ verdict: "BUG", title: `t${i}`, description: "d" }));
    const raw = "```json\n" + JSON.stringify({ items }) + "\n```";
    expect(parseTriage(raw, offered)).toHaveLength(5);
  });

  it("throws on an answer that is not JSON", () => {
    expect(() => parseTriage("Sure! Here is the list:", offered)).toThrow();
  });
});
