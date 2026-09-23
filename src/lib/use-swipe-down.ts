"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Drag a bottom sheet down to dismiss it — the companion gesture to
 * `sheet-up`. Arms from the grab zone at the top of the panel, or from
 * anywhere once the panel's own scroll has reached its top (the iOS hand-off:
 * a list that cannot scroll further passes the pull to its sheet). The panel
 * follows the finger with no resistance — a sheet that lags its own dismissal
 * reads as broken, not springy. Past ~72px, or on a downward flick, it slides
 * the rest of the way off and `onDismiss` fires.
 */
export function useSwipeDownToDismiss(
  panelRef: RefObject<HTMLElement | null>,
  /** Only while open AND in sheet mode — a desktop popover does not drag. */
  active: boolean,
  onDismiss: () => void,
) {
  // Read through a ref so an inline `() => close(false)` does not re-arm the
  // listeners on every render of the parent.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !active) return;

    let mode: "none" | "watch" | "drag" = "none";
    let startY = 0;
    let dy = 0;
    let lastDy = 0;
    let lastT = 0;
    let vx = 0;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const grab = t.clientY - panel.getBoundingClientRect().top < 48;
      // Mid-list touches arm only if the list is already at its top — the
      // scroll container gets first claim on its own drags.
      if (!grab && panel.scrollTop > 0) return;
      mode = "watch";
      startY = t.clientY;
      dy = 0;
      lastDy = 0;
      vx = 0;
      lastT = e.timeStamp;
    };

    const onMove = (e: TouchEvent) => {
      if (mode === "none" || e.touches.length !== 1) return;
      const ndy = e.touches[0].clientY - startY;
      if (mode === "watch") {
        if (ndy > 8 && panel.scrollTop <= 0) mode = "drag";
        else if (Math.abs(ndy) > 8) mode = "none"; // it was the list scrolling
        else return;
      }
      if (mode !== "drag") return;
      if (ndy <= 0) {
        // Pulled back up past the start — hand the list its scroll back.
        mode = "none";
        panel.style.transform = "";
        return;
      }
      e.preventDefault(); // the list must not scroll while the sheet moves
      e.stopPropagation();
      dy = ndy;
      const dt = e.timeStamp - lastT;
      if (dt > 0) vx = (dy - lastDy) / dt;
      lastDy = dy;
      lastT = e.timeStamp;
      panel.style.transition = "none";
      panel.style.transform = `translateY(${dy}px)`;
    };

    const onEnd = () => {
      if (mode !== "drag") {
        mode = "none";
        return;
      }
      mode = "none";
      if (dy > 72 || vx > 0.4) {
        panel.style.transition = "transform 190ms var(--ease-out-strong)";
        panel.style.transform = "translateY(100%)";
        // Unmount lands after the slide-off, so the sheet visibly leaves
        // rather than blinking out.
        setTimeout(() => dismissRef.current(), 180);
      } else {
        panel.style.transition = "transform 200ms var(--ease-out-strong)";
        panel.style.transform = "";
      }
      dy = 0;
      vx = 0;
    };

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", onEnd);
    panel.addEventListener("touchcancel", onEnd);
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onEnd);
      panel.style.transform = "";
      panel.style.transition = "";
    };
  }, [panelRef, active]);
}
