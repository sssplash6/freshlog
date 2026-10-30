import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DeadlineText } from "@/components/ui/status-chip";

/**
 * A use-by date is a whole Tashkent day, as the ledger counts it: hours to use
 * by 13 November can still be used at 23:30 on the 13th. Stored at UTC
 * midnight, the date is 05:00 Tashkent as an instant, and the date used to say
 * "expired" from then on while the hours were still there.
 */
describe("DeadlineText", () => {
  const deadline = new Date("2026-11-13T00:00:00.000Z");
  const at = (iso: string) => renderToStaticMarkup(createElement(DeadlineText, { deadline, now: new Date(iso) }));

  it("says today, not expired, on the evening of the day", () => {
    // 20:00 Tashkent on the 13th.
    const html = at("2026-11-13T15:00:00.000Z");
    expect(html).toContain("today");
    expect(html).not.toContain("expired");
  });

  it("says expired from Tashkent midnight after it", () => {
    expect(at("2026-11-13T19:00:00.000Z")).toContain("expired");
  });
});
