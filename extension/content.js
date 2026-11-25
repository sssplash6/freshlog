/**
 * Runs inside every Meet tab. Every few seconds it tells the service worker
 * three things: which meeting this tab is on, whether it is IN the call (not in
 * the lobby, not on the "you left" screen), and the names on the tiles.
 *
 * Meet has no API for this, so it is read off the page. Google renames its
 * class names freely, so nothing below uses one; it leans on attributes Meet
 * has kept for years (`jsname`, `data-participant-id`, ARIA labels) and on
 * several of them at once. If Meet changes under it, this is the one file to
 * fix — and the call's LENGTH survives a broken name reader, because "in a
 * call" and "who is on the tiles" are read separately.
 *
 * It sends nothing anywhere but the extension's own service worker.
 */
(() => {
  const EVERY_MS = 5000;
  const CODE = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/;

  // The red Leave call button exists only in a call: not in the lobby, not on
  // the screen after it. Its `jsname` has been stable for years; the labels
  // are the fallback, in the languages our mentors run Meet in.
  const LEAVE = [
    '[jsname="CQylAd"]',
    'button[aria-label*="Leave call" i]',
    'button[aria-label*="Покинуть" i]',
    'button[aria-label*="Выйти из" i]',
    'button[aria-label*="chiqish" i]',
  ].join(",");

  // Words on a tile that are not anybody's name.
  const NOT_NAMES = /^(you|вы|siz|me|presentation|презентация|taqdimot|pin|more options|ещё|.*\bis presenting\b.*)$/i;

  // Has this page ever shown the Leave call button? If it has, the selectors
  // above still work and the button alone decides. If a live WebRTC call has
  // run for a while without the button ever appearing, Google has renamed it:
  // the call is timed off the connection instead (`rtc-probe.js`), and the
  // popup says the extension needs updating.
  let leaveSeen = false;
  let rtcSince = 0;
  const DEGRADED_AFTER_MS = 60 * 1000;

  function rtcUp() {
    return Number(document.documentElement.getAttribute("data-freshlog-rtc") || 0) > 0;
  }

  /** @returns {{ inCall: boolean, degraded: boolean }} */
  function callState() {
    const leave = Boolean(document.querySelector(LEAVE));
    if (leave) leaveSeen = true;
    const rtc = rtcUp();
    rtcSince = rtc ? rtcSince || Date.now() : 0;
    if (leave || leaveSeen) return { inCall: leave, degraded: false };
    const degraded = rtc && Date.now() - rtcSince > DEGRADED_AFTER_MS;
    return { inCall: degraded, degraded, since: degraded ? rtcSince : undefined };
  }

  /** An email in a Meet name: students put the one they use in Freshlog there. */
  const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

  /** A line of tile text that could be a person's name, with any email in it. */
  function plausible(line) {
    const text = line.trim();
    if (text.length < 2 || text.length > 100) return null;
    // The rest of the line has to read as a name on its own: digits and colons
    // are a clock or a meeting code, not a person. The email is allowed them.
    const rest = text.replace(EMAIL, " ").trim();
    const hasEmail = rest !== text;
    if (!hasEmail && !/\p{L}/u.test(rest)) return null;
    if (/[0-9:@/]/.test(rest)) return null;
    if (!hasEmail && NOT_NAMES.test(rest)) return null;
    // "Aziz Karimov (You)", "Aziz (Presenting)": the name is before the bracket,
    // unless the bracket is the email: "Aziz Karimov (aziz@gmail.com)".
    return text.replace(/\s*\(([^()]*)\)\s*$/, (all, inside) => (inside.includes("@") ? all : "")) || null;
  }

  function people() {
    const names = new Set();

    // The video tiles. The name is the first short line of a tile's text.
    for (const tile of document.querySelectorAll("[data-participant-id], [data-requested-participant-id]")) {
      const lines = (tile.innerText || "").split("\n");
      for (const line of lines) {
        const name = plausible(line);
        if (name) {
          names.add(name);
          break;
        }
      }
    }

    // The People panel, when it is open: each row is labelled with the name.
    for (const row of document.querySelectorAll('[role="listitem"][aria-label]')) {
      const list = row.closest('[role="list"]');
      const label = list?.getAttribute("aria-label") ?? "";
      if (!/participant|участник|ishtirokchi|people|люди/i.test(label)) continue;
      const name = plausible(row.getAttribute("aria-label") ?? "");
      if (name) names.add(name);
    }

    return [...names].slice(0, 15);
  }

  function report() {
    const m = CODE.exec(location.pathname);
    const state = m ? callState() : { inCall: false, degraded: false };
    const tick = {
      code: m ? m[1] : null,
      inCall: state.inCall,
      degraded: state.degraded,
      // In the fallback, the call is only believed a minute after the
      // connection came up; that minute was still the lesson.
      since: state.since,
      people: [],
    };
    if (tick.inCall) {
      try {
        tick.people = people();
      } catch {
        // A broken name reader must not stop the clock.
      }
    }
    try {
      chrome.runtime.sendMessage({ type: "tick", tick });
    } catch {
      // The extension was reloaded or updated under a live tab; this copy of
      // the script is orphaned and the new one will take over on next load.
      clearInterval(timer);
    }
  }

  const timer = setInterval(report, EVERY_MS);
  report();
  // Leaving the page is the end of the call. One last report says so, rather
  // than waiting for the service worker to notice the silence.
  addEventListener("pagehide", () => {
    try {
      chrome.runtime.sendMessage({ type: "tick", tick: { code: null, inCall: false, people: [] } });
    } catch {
      // As above.
    }
  });
})();
