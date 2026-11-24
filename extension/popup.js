import { DEFAULT_APP_URL } from "./settings.js";

const $ = (id) => document.getElementById(id);

function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function day(ms) {
  const d = new Date(ms);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? "Today"
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

async function showLive() {
  const { tracker } = await chrome.storage.session.get("tracker");
  const calls = Object.values(tracker?.live ?? {});
  const el = $("live");
  if (calls.length === 0) {
    el.textContent = "Not in a Meet call.";
    el.classList.remove("on");
    return;
  }
  const call = calls[0];
  const minutes = Math.max(0, Math.round((Date.now() - call.start) / 60000));
  el.textContent = `In a call since ${clock(call.start)} · ${minutes} min so far`;
  el.classList.add("on");
}

async function showHealth() {
  const { degradedAt } = await chrome.storage.local.get("degradedAt");
  $("degraded").hidden = !degradedAt;
}

async function showCalls() {
  const { calls = [] } = await chrome.storage.local.get("calls");
  const list = $("calls");
  list.replaceChildren();
  $("empty").hidden = calls.length > 0;

  for (const call of calls) {
    const li = document.createElement("li");
    const what = document.createElement("div");
    what.className = "what";
    const minutes = Math.round((call.end - call.start) / 60000);
    what.textContent = `${day(call.start)}, ${clock(call.start)}–${clock(call.end)} · ${minutes} min`;
    const who = document.createElement("small");
    who.textContent = call.people.length
      ? call.people.map((p) => p.name).join(", ")
      : "No names read";
    what.append(who);
    li.append(what);

    if (call.status === "new") {
      const log = document.createElement("button");
      log.textContent = "Log";
      log.addEventListener("click", () => resolve(call.id, "opened"));
      const skip = document.createElement("button");
      skip.className = "quiet";
      skip.textContent = "Skip";
      skip.title = "Not a lesson";
      skip.addEventListener("click", () => resolve(call.id, "dismissed"));
      li.append(log, skip);
    } else {
      const again = document.createElement("button");
      again.className = "quiet";
      again.textContent = call.status === "opened" ? "Opened" : "Skipped";
      again.title = "Open the log form for this call again";
      again.addEventListener("click", () => resolve(call.id, "opened"));
      li.classList.add("done");
      li.append(again);
    }
    list.append(li);
  }
}

async function resolve(id, status) {
  await chrome.runtime.sendMessage({ type: "resolve", id, status });
  await showCalls();
}

async function showSettings() {
  const s = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL, autoOpen: false });
  $("appUrl").value = s.appUrl;
  $("autoOpen").checked = Boolean(s.autoOpen);

  const saved = (text) => {
    $("saved").textContent = text;
    setTimeout(() => ($("saved").textContent = ""), 1500);
  };
  $("appUrl").addEventListener("change", async (e) => {
    let value = e.target.value.trim().replace(/\/+$/, "");
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error();
      value = url.origin;
    } catch {
      e.target.value = (await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL })).appUrl;
      saved("That is not a web address. Kept the old one.");
      return;
    }
    e.target.value = value;
    await chrome.storage.sync.set({ appUrl: value });
    saved("Saved.");
  });
  $("autoOpen").addEventListener("change", async (e) => {
    await chrome.storage.sync.set({ autoOpen: e.target.checked });
    saved("Saved.");
  });
}

showLive();
showHealth();
showCalls();
showSettings();
setInterval(showLive, 15000);
