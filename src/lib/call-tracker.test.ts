/**
 * The browser extension's call tracker (`extension/tracker.js`). It lives
 * outside `src` because Chrome loads it as is, but it decides how long every
 * logged call was, so it is tested with everything else.
 */
import { describe, expect, it } from "vitest";

import { parseCallReport } from "@/lib/call-match";
import {
  emptyState,
  logUrl,
  meetCode,
  MIN_CALL_MS,
  onTabGone,
  onTick,
  remember,
  STALE_MS,
  sweep,
} from "../../extension/tracker.js";

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 10, 23, 10, 0);
const code = "abc-defg-hij";
const inCall = (people: string[] = []) => ({ code, inCall: true, people });
const left = { code, inCall: false, people: [] };

/** Report every `step` ms from `from` to `to`, the way the content script does. */
function run(state: ReturnType<typeof emptyState>, from: number, to: number, people: string[] = [], step = 5000) {
  for (let t = from; t <= to; t += step) state = onTick(state, "1", inCall(people), t).state;
  return state;
}

describe("call tracker", () => {
  it("times a call from the first report in it to the last", () => {
    let state = run(emptyState(), T0, T0 + 47 * MIN, ["Aziz Karimov"]);
    const { state: after, ended } = onTick(state, "1", left, T0 + 47 * MIN + 5000);
    state = after;
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ code, start: T0, end: T0 + 47 * MIN, status: "new" });
    expect(ended[0].people).toEqual([{ name: "Aziz Karimov", firstSeen: T0 }]);
    expect(state.live).toEqual({});
  });

  it("keeps when each person first appeared", () => {
    let state = run(emptyState(), T0, T0 + 10 * MIN, ["Sanjar"]);
    state = run(state, T0 + 10 * MIN + 5000, T0 + 40 * MIN, ["Sanjar", "Aziz"]);
    const { ended } = onTabGone(state, "1");
    expect(ended[0].people).toEqual([
      { name: "Sanjar", firstSeen: T0 },
      { name: "Aziz", firstSeen: T0 + 10 * MIN + 5000 },
    ]);
  });

  it("drops a call too short to be a lesson", () => {
    const state = run(emptyState(), T0, T0 + MIN_CALL_MS - 5000);
    expect(onTick(state, "1", left, T0 + MIN_CALL_MS).ended).toEqual([]);
  });

  it("ends a call when its tab closes", () => {
    const state = run(emptyState(), T0, T0 + 30 * MIN);
    expect(onTabGone(state, "1").ended[0]).toMatchObject({ start: T0, end: T0 + 30 * MIN });
  });

  it("ends a call when the tab moves straight into another meeting", () => {
    const state = run(emptyState(), T0, T0 + 30 * MIN);
    const { state: after, ended } = onTick(state, "1", { code: "xyz-abcd-efg", inCall: true, people: [] }, T0 + 31 * MIN);
    expect(ended[0]).toMatchObject({ code, end: T0 + 30 * MIN });
    expect(after.live["1"]).toMatchObject({ code: "xyz-abcd-efg", start: T0 + 31 * MIN });
  });

  it("ends a call whose tab went quiet at the last report, not when it was noticed", () => {
    const state = run(emptyState(), T0, T0 + 40 * MIN);
    expect(sweep(state, T0 + 40 * MIN + STALE_MS - 1000).ended).toEqual([]);
    const { ended, state: after } = sweep(state, T0 + 8 * 60 * MIN);
    expect(ended[0]).toMatchObject({ start: T0, end: T0 + 40 * MIN });
    expect(after.live).toEqual({});
  });

  it("survives a background tab reporting once a minute", () => {
    let state = run(emptyState(), T0, T0 + 45 * MIN, [], 60 * 1000);
    state = sweep(state, T0 + 45 * MIN + 30 * 1000).state;
    expect(state.live["1"]).toBeDefined();
  });

  it("starts a call from when the connection came up, when the fallback says so", () => {
    const state = onTick(emptyState(), "1", { ...inCall(), degraded: true, since: T0 - MIN }, T0).state;
    expect(state.live["1"].start).toBe(T0 - MIN);
  });

  it("does not believe a start from the future or from long ago", () => {
    expect(onTick(emptyState(), "1", { ...inCall(), since: T0 + MIN }, T0).state.live["1"].start).toBe(T0);
    expect(onTick(emptyState(), "1", { ...inCall(), since: T0 - 60 * MIN }, T0).state.live["1"].start).toBe(T0);
  });

  it("tracks two tabs apart", () => {
    let state = onTick(emptyState(), "1", inCall(), T0).state;
    state = onTick(state, "2", { code: "xyz-abcd-efg", inCall: true, people: [] }, T0 + MIN).state;
    expect(Object.keys(state.live).sort()).toEqual(["1", "2"]);
  });

  it("keeps the newest calls, once each, for a week", () => {
    const call = (start: number) => ({ id: `c@${start}`, code, start, end: start + 30 * MIN, people: [], status: "new" as const });
    const old = call(T0 - 8 * 24 * 60 * MIN);
    const kept = remember([call(T0), old], [call(T0 + 60 * MIN), call(T0)], T0 + 2 * 60 * MIN);
    expect(kept.map((c) => c.start)).toEqual([T0 + 60 * MIN, T0]);
  });

  it("writes an address the app reads back as the same call", () => {
    const state = run(emptyState(), T0, T0 + 47 * MIN, ["Aziz Karimov", "Малика ~ Холикова"]);
    const [call] = onTabGone(state, "1").ended;
    const url = new URL(logUrl("https://www.freshlog.net/", call));
    expect(url.pathname).toBe("/sessions/from-call");

    const params: Record<string, string | string[]> = {};
    for (const key of new Set(url.searchParams.keys())) {
      const all = url.searchParams.getAll(key);
      params[key] = key === "p" ? all : all[0];
    }
    expect(parseCallReport(params, T0 + 60 * MIN)).toEqual({
      start: T0,
      end: T0 + 47 * MIN,
      code,
      people: [
        { name: "Aziz Karimov", firstSeen: T0 },
        { name: "Малика ~ Холикова", firstSeen: T0 },
      ],
    });
  });

  it("reads a meeting code out of a Meet address and nothing else", () => {
    expect(meetCode("/abc-defg-hij")).toBe(code);
    expect(meetCode("/abc-defg-hij/")).toBe(code);
    expect(meetCode("/")).toBeNull();
    expect(meetCode("/landing")).toBeNull();
  });
});
