/**
 * The service worker: storage, timers, the notification and the badge.
 *
 * Chrome stops a service worker after half a minute of quiet and starts it
 * again on the next message, so nothing lives in a variable — the live calls
 * are in `chrome.storage.session` and the finished ones in
 * `chrome.storage.local`, and every change goes through `update()` one at a
 * time so two tabs reporting together cannot overwrite each other.
 */
import { settings } from "./settings.js";
import { emptyState, logUrl, onTabGone, onTick, remember, sweep } from "./tracker.js";

const SWEEP_ALARM = "sweep";

// Safari gives extensions no notifications, so there is nobody to ask "Log
// it?" and the form opens by itself when a call ends. Chrome asks first unless
// the mentor turned that off in the popup.
const CAN_NOTIFY = typeof chrome.notifications?.create === "function";

let queue = Promise.resolve();

/**
 * Read the tracker, apply one change, write it back, and deal with any call
 * the change ended. Serialised: see the note at the top.
 *
 * @param {(state: import("./tracker.js").TrackerState, now: number) =>
 *   { state: import("./tracker.js").TrackerState, ended: import("./tracker.js").EndedCall[] }} change
 */
function update(change) {
  queue = queue.then(async () => {
    const now = Date.now();
    const { tracker } = await chrome.storage.session.get({ tracker: emptyState() });
    const { state, ended } = change(tracker, now);
    await chrome.storage.session.set({ tracker: state });
    if (ended.length > 0) await finished(ended, now);
  }).catch((error) => console.error("Freshlog call logger:", error));
  return queue;
}

/** @param {import("./tracker.js").EndedCall[]} ended */
async function finished(ended, now) {
  const { appUrl, autoOpen: chosen } = await settings();
  const autoOpen = chosen || !CAN_NOTIFY;
  const { calls = [] } = await chrome.storage.local.get("calls");
  const marked = ended.map((c) => ({ ...c, status: autoOpen ? "opened" : "new" }));
  await chrome.storage.local.set({ calls: remember(calls, marked, now) });

  for (const call of marked) {
    if (autoOpen) {
      await chrome.tabs.create({ url: logUrl(appUrl, call) });
      continue;
    }
    const minutes = Math.round((call.end - call.start) / 60000);
    chrome.notifications.create(call.id, {
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: `Call ended · ${minutes} min`,
      message: "Log it as a session in Freshlog?",
      buttons: [{ title: "Log it" }, { title: "Not a lesson" }],
      requireInteraction: true,
      priority: 2,
    });
  }
  await badge();
}

/** The number of calls nobody has logged or dismissed, on the toolbar icon. */
async function badge() {
  const { calls = [] } = await chrome.storage.local.get("calls");
  const waiting = calls.filter((c) => c.status === "new").length;
  await chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
  await chrome.action.setBadgeText({ text: waiting ? String(waiting) : "" });
}

/**
 * Mark a call opened or dismissed, and open the log form for it when asked.
 *
 * @param {string} id
 * @param {"opened" | "dismissed"} status
 */
async function resolve(id, status) {
  const { calls = [] } = await chrome.storage.local.get("calls");
  const call = calls.find((c) => c.id === id);
  if (!call) return;
  await chrome.storage.local.set({
    calls: calls.map((c) => (c.id === id ? { ...c, status } : c)),
  });
  if (status === "opened") {
    const { appUrl } = await settings();
    await chrome.tabs.create({ url: logUrl(appUrl, call) });
  }
  if (CAN_NOTIFY) chrome.notifications.clear(id);
  await badge();
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === "tick" && sender.tab?.id != null) {
    const tabId = String(sender.tab.id);
    update((state, now) => onTick(state, tabId, message.tick, now));
    health(message.tick);
    return false;
  }
  if (message?.type === "resolve") {
    resolve(message.id, message.status).then(() => reply({ ok: true }));
    return true;
  }
  return false;
});

/**
 * Whether Meet's page still reads the way `content.js` expects. A call timed
 * off the WebRTC fallback says it does not; one timed off the Leave call
 * button says it does again. The popup shows the warning.
 *
 * @param {import("./tracker.js").Tick} tick
 */
async function health(tick) {
  if (!tick?.inCall) return;
  const { degradedAt } = await chrome.storage.local.get("degradedAt");
  if (tick.degraded && !degradedAt) await chrome.storage.local.set({ degradedAt: Date.now() });
  if (!tick.degraded && degradedAt) await chrome.storage.local.remove("degradedAt");
}

chrome.tabs.onRemoved.addListener((tabId) => {
  update((state) => onTabGone(state, String(tabId)));
});

if (CAN_NOTIFY) {
  chrome.notifications.onButtonClicked.addListener((id, index) => {
    resolve(id, index === 0 ? "opened" : "dismissed");
  });
  chrome.notifications.onClicked.addListener((id) => {
    resolve(id, "opened");
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SWEEP_ALARM) update((state, now) => sweep(state, now));
});

function start() {
  chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 1 });
  badge();
}
chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
