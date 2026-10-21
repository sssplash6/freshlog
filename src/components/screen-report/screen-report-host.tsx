"use client";

import { useEffect, useRef, useState } from "react";

import { ScreenReportOverlay, type CaptureContext } from "@/components/screen-report/screen-report-overlay";
import { reportPagePath } from "@/lib/bugs";
import { captureViewport } from "@/lib/capture-screen";

const EVENT = "app-screen-report";

/**
 * Start a report drawn on the screen, from anywhere on the client.
 *
 * A window event rather than a context, for the reason `toast()` is one: the
 * caller is a menu row deep inside a server-rendered popover, and the host is
 * mounted once, in the app shell.
 */
export function openScreenReport(): void {
  window.dispatchEvent(new Event(EVENT));
}

type State =
  | { phase: "idle" }
  | { phase: "capturing" }
  | { phase: "open"; image: HTMLCanvasElement | null; context: CaptureContext };

/**
 * Two frames — one for React to unmount the menu, one for the browser to
 * paint without it — or 150ms, whichever is first. A tab that is not painting
 * fires no frames at all, and a press must never wait on one forever: the
 * host would stay busy and ignore every press after it.
 */
const afterPaint = () =>
  Promise.race([
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    new Promise<void>((resolve) => setTimeout(resolve, 150)),
  ]);

/**
 * Listens for `openScreenReport`, captures what is on screen, and shows the
 * overlay. A second press while a capture is running is ignored.
 *
 * What the page looked like — its path, the window, the theme — is read at the
 * moment of capture and travels with the picture, so resizing the window
 * while drawing does not change what the report says about where it was drawn.
 */
export function ScreenReportHost() {
  const [state, setState] = useState<State>({ phase: "idle" });
  const busy = useRef(false);

  useEffect(() => {
    async function open() {
      if (busy.current) return;
      busy.current = true;
      setState({ phase: "capturing" });
      await afterPaint();
      const context: CaptureContext = {
        pagePath: reportPagePath(window.location.pathname),
        width: window.innerWidth,
        height: window.innerHeight,
        ratio: window.devicePixelRatio || 1,
        theme: document.documentElement.dataset.theme ?? "",
      };
      let image: HTMLCanvasElement | null = null;
      try {
        image = await captureViewport();
      } catch {
        // The overlay offers "Choose a screenshot instead".
      }
      setState({ phase: "open", image, context });
    }
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);

  if (state.phase === "capturing") {
    return (
      <p role="status" className="sr-only" data-capture-skip>
        Capturing the page…
      </p>
    );
  }
  if (state.phase !== "open") return null;
  return (
    <ScreenReportOverlay
      image={state.image}
      context={state.context}
      onClose={() => {
        busy.current = false;
        setState({ phase: "idle" });
      }}
    />
  );
}
