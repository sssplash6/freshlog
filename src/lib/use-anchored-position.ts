"use client";

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

export type Anchored = {
  /** Fixed-position styles for the floating element. */
  style: CSSProperties;
  /** True when the panel flipped above its trigger for want of room below. */
  up: boolean;
};

type Options = {
  /** Which edge lines up with the trigger's: "start" = left, "end" = right. */
  align?: "start" | "end";
  /** Space between trigger and panel. */
  gap?: number;
  /** Make the panel at least as wide as its trigger — what a select wants. */
  matchTriggerWidth?: boolean;
  /**
   * Cap the height so a long panel scrolls instead of running off screen.
   * Only pass it for panels that can actually scroll (`overflow-auto`).
   */
  maxHeight?: number;
};

/**
 * Pin a floating panel to its trigger in VIEWPORT coordinates, so the panel can
 * be portaled to <body> and escape every ancestor that would otherwise crop it.
 *
 * Cropping is the whole reason this exists. Panels here sit inside `Panel`
 * (`overflow-hidden`, masking its rounded corners) and `Table`
 * (`overflow-x-auto`, to scroll wide columns — which makes the vertical axis
 * clip too). An absolutely-positioned dropdown inside either is cut off at the
 * container's edge, and no amount of z-index helps: clipping happens before
 * stacking is ever considered. Positioning `fixed` from <body> is the only
 * thing that reliably gets a panel out.
 *
 * Flips above the trigger when there is more room there, clamps to the viewport
 * so an edge-of-screen panel stays fully visible, and re-measures on scroll,
 * resize, and whenever the panel's own size changes (a menu that reveals an
 * edit form has to be re-placed, or it hangs off the bottom).
 */
export function useAnchoredPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  { align = "start", gap = 6, matchTriggerWidth = false, maxHeight }: Options = {},
): Anchored | null {
  const [anchored, setAnchored] = useState<Anchored | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const panel = panelRef.current;
      // scrollHeight, not just offsetHeight: once the panel is capped to the
      // room available, its box is the cap and only scrollHeight still says how
      // tall it wants to be. Deciding to flip on the capped box lets a panel
      // that was sent above "fit" below again and bounce between the two.
      const panelH = panel
        ? Math.max(panel.offsetHeight, panel.scrollHeight)
        : 0;
      const panelW = panel?.offsetWidth ?? rect.width;

      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      // Only flip once we've measured: an unmeasured panel would always look
      // like it fits and never flip.
      const up = panelH > 0 && below < panelH + gap && above > below;
      const room = (up ? above : below) - gap - 8;

      setAnchored({
        up,
        style: {
          position: "fixed",
          ...(up
            ? { bottom: window.innerHeight - rect.top + gap }
            : { top: rect.bottom + gap }),
          // Both edges are clamped, on both alignments. `end` used to clamp
          // only the RIGHT edge — which keeps a panel off the right of the
          // screen and does nothing about the left, so a right-aligned panel
          // wider than the space to the left of its trigger simply hung off
          // that side. The account menu in the 220px sidebar is exactly that
          // case: its trigger's right edge is at 211px and the panel is 240
          // wide, so it opened 29px past the edge of the window with its own
          // left border and padding cut off.
          ...(align === "end"
            ? {
                right: Math.min(
                  Math.max(8, window.innerWidth - rect.right),
                  Math.max(8, window.innerWidth - panelW - 8),
                ),
              }
            : {
                left: Math.max(
                  8,
                  Math.min(rect.left, window.innerWidth - panelW - 8),
                ),
              }),
          ...(matchTriggerWidth ? { minWidth: rect.width } : {}),
          ...(maxHeight
            ? { maxHeight: Math.max(120, Math.min(maxHeight, room)) }
            : {}),
        },
      });
    };

    place();
    // capture:true so the panel also tracks scrolling *containers*, not just
    // the page — a menu opened inside the tables here scrolls with them.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    const observer = new ResizeObserver(place);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      observer.disconnect();
    };
  }, [open, align, gap, matchTriggerWidth, maxHeight, triggerRef, panelRef]);

  return anchored;
}
