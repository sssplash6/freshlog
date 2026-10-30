import { describe, expect, it } from "vitest";

import { apiExchange } from "@/lib/api/v1/exchanges";
import { EXCHANGE_STATUS } from "@/lib/constants";
import type { ExchangeView } from "@/lib/exchanges";

/**
 * An exchange's use-by is a whole Tashkent day, like the grants under it: it
 * ran out at 05:00 on its day, the stored instant, while those grants could
 * still be used until midnight.
 */
describe("apiExchange: ran out", () => {
  // Only what the contract reads; the rest of a loaded exchange is not asked.
  const exchange = {
    id: "ex-1",
    studentId: "sp-1",
    student: { userId: "u-1", user: { name: "Aziz Tursunov", email: "aziz@example.com" } },
    fromProgram: { id: "imkon", name: "Imkon", colorIndex: 0 },
    toProgram: { id: "ga", name: "Global Admissions", colorIndex: 1 },
    status: EXCHANGE_STATUS.OPEN,
    deadline: new Date("2026-11-13T00:00:00.000Z"),
    figures: { cap: 420, allocated: 420, unallocated: 0, used: 0, missed: 0, remaining: 420, forfeited: 0, extra: 0 },
    mentors: [],
    sentBy: { name: "Nodira Aliyeva", email: "nodira@example.com" },
    note: null,
    returnedBy: null,
    returnNote: null,
    sessions: [],
  } as unknown as ExchangeView;
  const at = (iso: string) => apiExchange(exchange, { canReturn: false, withStudent: false, now: new Date(iso) });

  it("has not run out on the evening of its day", () => {
    // 20:00 Tashkent on the 13th.
    expect(at("2026-11-13T15:00:00.000Z").ranOut).toBe(false);
  });

  it("runs out at Tashkent midnight after it", () => {
    expect(at("2026-11-13T19:00:00.000Z").ranOut).toBe(true);
  });
});
