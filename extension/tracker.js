/**
 * The call tracker: what the extension knows about the mentor's calls, and the
 * one place it decides that a call has started or ended.
 *
 * Pure. The service worker (`background.js`) owns the storage and the clock and
 * hands both in; the tests in `src/lib/call-tracker.test.ts` drive it the same
 * way. Nothing here touches `chrome.*`.
 *
 * A call is the stretch of time one Meet tab spends in a meeting. The content
 * script reports every few seconds whether the tab is in a call and whose tiles
 * it can see; a call ends when the tab says it left, the tab closes, the tab
 * moves to another meeting, or the reports simply stop — a crashed tab or a
 * closed laptop lid sends no goodbye.
 */

/** Shorter than this is a mis-click or a mic check, not a lesson. */
export const MIN_CALL_MS = 3 * 60 * 1000;

/**
 * No report for this long and the call is over. Chrome throttles timers in a
 * background tab to about one a minute, so this has to outlast that or a
 * mentor who switched tabs mid-lesson would have it cut in two.
 */
export const STALE_MS = 150 * 1000;

/**
 * How far back a tick may say its call began. The fallback in `content.js`
 * waits a minute before believing a call; anything older than this is a
 * clock that cannot be trusted.
 */
const MAX_BACKDATE_MS = 5 * 60 * 1000;

/** Names kept per call. A lesson is two or three people; a webinar is noise. */
const MAX_PEOPLE = 15;

/** Calls kept in the popup's list, and for how long. */
const KEEP_CALLS = 20;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @typedef {{ code: string, start: number, last: number, people: Record<string, number> }} LiveCall
 * @typedef {{ live: Record<string, LiveCall> }} TrackerState
 * @typedef {{ code: string | null, inCall: boolean, people: string[],
 *   degraded?: boolean, since?: number }} Tick
 * @typedef {{ id: string, code: string, start: number, end: number,
 *   people: { name: string, firstSeen: number }[],
 *   status: "new" | "opened" | "dismissed" }} EndedCall
 */

/** @returns {TrackerState} */
export function emptyState() {
  return { live: {} };
}

/**
 * One report from one tab.
 *
 * @param {TrackerState} state
 * @param {string} tabId
 * @param {Tick} tick
 * @param {number} now
 * @returns {{ state: TrackerState, ended: EndedCall[] }}
 */
export function onTick(state, tabId, tick, now) {
  const live = { ...state.live };
  /** @type {EndedCall[]} */
  const ended = [];
  const was = live[tabId];

  if (was && (!tick.inCall || tick.code !== was.code)) {
    const call = close(was);
    if (call) ended.push(call);
    delete live[tabId];
  }

  if (tick.inCall && tick.code) {
    const since =
      typeof tick.since === "number" && tick.since <= now && now - tick.since <= MAX_BACKDATE_MS
        ? tick.since
        : now;
    const call = live[tabId] ?? { code: tick.code, start: since, last: now, people: {} };
    const people = { ...call.people };
    for (const raw of tick.people) {
      const name = String(raw).trim().slice(0, 60);
      if (!name || name in people) continue;
      if (Object.keys(people).length >= MAX_PEOPLE) break;
      people[name] = now;
    }
    live[tabId] = { ...call, last: now, people };
  }

  return { state: { live }, ended };
}

/**
 * The tab closed, or navigated away from Meet altogether.
 *
 * @param {TrackerState} state
 * @param {string} tabId
 */
export function onTabGone(state, tabId) {
  const was = state.live[tabId];
  if (!was) return { state, ended: [] };
  const live = { ...state.live };
  delete live[tabId];
  const call = close(was);
  return { state: { live }, ended: call ? [call] : [] };
}

/**
 * Calls whose tab went quiet. Run on a timer, since a quiet tab is exactly the
 * one that will not report its own end.
 *
 * @param {TrackerState} state
 * @param {number} now
 */
export function sweep(state, now) {
  const live = { ...state.live };
  /** @type {EndedCall[]} */
  const ended = [];
  for (const [tabId, call] of Object.entries(live)) {
    if (now - call.last < STALE_MS) continue;
    delete live[tabId];
    const done = close(call);
    if (done) ended.push(done);
  }
  return { state: { live }, ended };
}

/**
 * A live call, finished. It ends at the last report that saw it, not at the
 * moment somebody noticed it had stopped — a laptop that slept through the
 * evening did not hold a six-hour lesson.
 *
 * @param {LiveCall} call
 * @returns {EndedCall | null}
 */
function close(call) {
  if (call.last - call.start < MIN_CALL_MS) return null;
  return {
    id: `${call.code}@${call.start}`,
    code: call.code,
    start: call.start,
    end: call.last,
    people: Object.entries(call.people).map(([name, firstSeen]) => ({ name, firstSeen })),
    status: "new",
  };
}

/**
 * Add finished calls to the kept list, newest first, without the old ones.
 *
 * @param {EndedCall[]} calls
 * @param {EndedCall[]} ended
 * @param {number} now
 */
export function remember(calls, ended, now) {
  const seen = new Set(ended.map((c) => c.id));
  return [...ended, ...calls.filter((c) => !seen.has(c.id))]
    .filter((c) => now - c.end < KEEP_MS)
    .slice(0, KEEP_CALLS);
}

/**
 * The address that turns a call into a filled-in Log a session form. The app
 * decides who it was with; this only says what happened.
 *
 * @param {string} base  e.g. "https://www.freshlog.net"
 * @param {EndedCall} call
 */
export function logUrl(base, call) {
  const q = new URLSearchParams();
  q.set("start", String(call.start));
  q.set("end", String(call.end));
  q.set("code", call.code);
  for (const p of call.people) q.append("p", `${p.firstSeen}~${p.name}`);
  return `${base.replace(/\/+$/, "")}/sessions/from-call?${q}`;
}

/**
 * The Meet code in a Meet address, or null for Meet's home page, the landing
 * page and everything else that is not a meeting.
 *
 * @param {string} pathname
 */
export function meetCode(pathname) {
  const m = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/.exec(pathname);
  return m ? m[1] : null;
}
