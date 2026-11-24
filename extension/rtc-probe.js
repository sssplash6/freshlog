/**
 * The backstop for "is this tab in a call?" that does not read Meet's page.
 *
 * Runs in the PAGE's own JavaScript world (manifest: "world": "MAIN"), before
 * Meet's scripts, and counts the WebRTC connections that are up. A Meet call
 * is media flowing over WebRTC, whatever Google's buttons are called this
 * month — so when the Leave call button `content.js` looks for has been
 * renamed, the call is still timed.
 *
 * It reads one thing, connection state, and publishes one number on <html>
 * (`data-freshlog-rtc`) for `content.js` to read. It sees no audio, video,
 * messages or names, and changes nothing about how a connection behaves: the
 * constructor is wrapped, not replaced, and every call goes straight through.
 */
(() => {
  const Native = window.RTCPeerConnection;
  if (typeof Native !== "function") return;

  const live = new Set();
  const publish = () => {
    // `close()` fires no connectionstatechange, so the set is re-read rather
    // than trusted.
    for (const pc of live) if (pc.connectionState !== "connected") live.delete(pc);
    document.documentElement?.setAttribute("data-freshlog-rtc", String(live.size));
  };

  function track(pc) {
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "connected") live.add(pc);
      publish();
    });
  }

  window.RTCPeerConnection = new Proxy(Native, {
    construct(target, args, newTarget) {
      const pc = Reflect.construct(target, args, newTarget);
      try {
        track(pc);
      } catch {
        // Never let the probe break a call.
      }
      return pc;
    },
  });

  setInterval(publish, 5000);
})();
