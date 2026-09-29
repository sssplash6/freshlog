"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
// The enum is internal, but it is the only way to ask router.prefetch for the
// page AND its data rather than the partial default (see "Prefetch on intent").
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

import { ArrowLeftIcon, CheckIcon } from "@/components/icons";

/**
 * The gestures a phone user makes without thinking — all missing from a web
 * page, all expected of an app.
 *
 *   Swipe from the left edge  A drag past ~28% of the screen (or a fast flick)
 *                           pops the page, the way every iOS app does. The
 *                           arrow bubble follows the thumb — the predictive-
 *                           back shape Android made standard — and the real
 *                           `vt-back` slide plays on release. Fully grabbing
 *                           the page is not available to us: React's gesture
 *                           transitions need a timeline the bundled react-dom
 *                           does not export, and faking the previous page with
 *                           a transform fights the view-transition captures.
 *
 *   Pull down at the top    Rubber-bands the page and, past 72px, runs
 *                           `router.refresh()` — the one thing a standalone
 *                           PWA has no browser chrome left to offer.
 *
 *   Tap the status strip    The safe-area zone under the clock scrolls to
 *                           the top, exactly like tapping the iOS status bar.
 *
 *   Touch a link            `router.prefetch` fires on pointer-down, so the
 *                           ~200ms a finger spends on the glass is spent
 *                           warming the route instead of waiting for the tap.
 *
 * One component, mounted once per shell: everything here is a window-level
 * listener plus a few fixed-position overlays, so there is nothing to place.
 */

/** How far into the screen a back-swipe has to reach to commit. */
const BACK_EDGE = 28;
const BACK_COMMIT_RATIO = 0.28;
const BACK_FLICK_VX = 0.45; // px per ms — a fast short swipe counts too
/** Pull-to-refresh: travel needed, and the resistance applied to the finger. */
const PULL_COMMIT = 72;
const PULL_RESISTANCE = 0.45;

/**
 * How deep into our own history stack we are. `router.back()` on an empty
 * stack does nothing, and swiping back out of the app to wherever the user
 * came from is the browser's business — the gesture only exists once there
 * is a page of ours underneath. Tracked off pushState/popstate rather than
 * `window.navigation`, which Safari does not implement.
 */
let navDepth = 0;
let historyPatched = false;
function trackHistoryDepth() {
  if (historyPatched) return;
  historyPatched = true;
  const push = history.pushState.bind(history);
  history.pushState = (...args) => {
    navDepth++;
    return push(...args);
  };
  window.addEventListener("popstate", () => {
    navDepth = Math.max(0, navDepth - 1);
  });
}

/** An overlay is up — a menu, a sheet, a listbox — so page gestures stand down. */
function overlayOpen() {
  return Boolean(
    document.querySelector('[role="menu"], [role="dialog"], [role="listbox"]'),
  );
}

/** Touches that belong to something else: fields, open layers, the tab bar. */
function gestureExcluded(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input, textarea, select, [contenteditable], [data-no-pull], [role="menu"], [role="dialog"], [role="listbox"], .vt-tabbar, .scroll-x',
      ),
    )
  );
}

export function NativeGestures() {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  // Rendered overlays get state only for show/hide and phase — per-frame
  // values (pull distance, bubble position) are written straight to the DOM,
  // or every touchmove would be a render.
  const [pullLive, setPullLive] = useState(false);
  const [pullDone, setPullDone] = useState(false);
  const [swipeLive, setSwipeLive] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const pullDotRef = useRef<HTMLDivElement>(null);
  const swipeDotRef = useRef<HTMLDivElement>(null);
  const armedRef = useRef(false);

  useEffect(() => {
    trackHistoryDepth();
    mainRef.current = document.querySelector("main");

    // For the curious: the one message anyone who opens devtools deserves.
    console.info(
      "freshlog — the mentoring-hours ledger. Found a rough edge? tech@freshman.academy",
    );

    /* ---- Prefetch on intent ---------------------------------------- *
     * A tap is ~200ms of contact and a hover ~300ms before the click. Spend
     * both warming the route — FULLY, page and data, not the default partial
     * prefetch that stops at the loading skeleton. The partial one is why a
     * click used to show a skeleton React then holds for its minimum ~300ms
     * even when the page was ready in 10: with the whole page in the cache
     * there is no fallback to show. Hover waits 80ms so a cursor crossing a
     * table does not fetch every row it passes. Capture phase: an inner
     * handler's stopPropagation must not cost the warm-up. */
    const warmable = (target: EventTarget | null): string | null => {
      const a = (target as HTMLElement | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return null;
      if (a.dataset.noPrefetch !== undefined || a.target === "_blank") return null;
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("/") || href.startsWith("//")) return null;
      if (href.startsWith("/n/")) return null; // marks-read side effect — never warm
      if (href.startsWith("/api/")) return null;
      return href;
    };
    const warm = (href: string) => router.prefetch(href, { kind: PrefetchKind.FULL });
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    const onPointerDown = (e: PointerEvent) => {
      const href = warmable(e.target);
      if (href) warm(href);
    };
    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const href = warmable(e.target);
      if (hoverTimer) clearTimeout(hoverTimer);
      if (href) hoverTimer = setTimeout(() => warm(href), 80);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerover", onPointerOver, true);

    /* ---- Keyboard lift --------------------------------------------- *
     * iOS overlays the keyboard; `position: fixed; bottom: 0` sits UNDER it.
     * Sheets anchor to `--kb` — the keyboard's height while it is open — so a
     * sheet with a search box slides up with the keyboard instead of being
     * buried by it. (Android resizes the layout viewport already, so the
     * value stays ~0 there.) */
    const vv = window.visualViewport;
    const root = document.documentElement;
    const onVv = vv
      ? () => {
          // scale !== 1 is pinch-zoom, not the keyboard — same shrink shape.
          const kb =
            vv.scale !== 1
              ? 0
              : Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
          root.style.setProperty("--kb", `${Math.round(kb)}px`);
        }
      : null;
    if (vv && onVv) {
      vv.addEventListener("resize", onVv);
      vv.addEventListener("scroll", onVv);
    }

    /* ---- Shared gesture state -------------------------------------- */
    let mode: "none" | "watch" | "back" | "pull" = "none";
    let startX = 0;
    let startY = 0;
    let pull = 0;
    let swipeDx = 0;
    let swipeVx = 0;
    let lastT = 0;

    const setMainOffset = (px: number, animate: boolean) => {
      const main = mainRef.current;
      if (!main) return;
      main.style.transition = animate
        ? "transform 220ms var(--ease-out-strong)"
        : "none";
      main.style.transform = px > 0 ? `translateY(${px}px)` : "";
    };

    const renderPull = () => {
      const dot = pullDotRef.current;
      if (!dot) return;
      const progress = Math.min(1, pull / PULL_COMMIT);
      dot.style.transform = `translateY(${pull * 0.5}px) rotate(${progress * 270}deg)`;
      dot.style.opacity = String(Math.min(1, progress * 1.5));
      const arc = dot.querySelector<SVGCircleElement>("[data-arc]");
      if (arc) arc.style.strokeDashoffset = String(44 - 44 * progress);
    };

    const renderSwipe = (y: number, progress: number) => {
      const dot = swipeDotRef.current;
      if (!dot) return;
      dot.style.top = `${y - 24}px`;
      dot.style.transform = `scale(${0.55 + 0.45 * progress})`;
      dot.style.opacity = String(Math.min(1, 0.4 + progress));
      const armed = progress >= 1;
      dot.dataset.armed = armed ? "true" : "false";
      if (armed && !armedRef.current) navigator.vibrate?.(8);
      armedRef.current = armed;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || overlayOpen()) return;
      const t = e.touches[0];
      if (gestureExcluded(e.target)) return;
      const canBack = t.clientX <= BACK_EDGE && navDepth > 0;
      const canPull = window.scrollY <= 1;
      if (!canBack && !canPull) return;
      mode = "watch";
      startX = t.clientX;
      startY = t.clientY;
      pull = 0;
      swipeDx = 0;
      swipeVx = 0;
      lastT = e.timeStamp;
      armedRef.current = false;
      // A back-swipe is only possible from the edge; a pull only has meaning
      // at scroll top. Both may be armed at once — intent decides on move.
      if (!canBack) startX = -1; // marks "edge swipe impossible here"
    };

    const onTouchMove = (e: TouchEvent) => {
      if (mode === "none" || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = startX < 0 ? 0 : t.clientX - startX;
      const dy = t.clientY - startY;

      if (mode === "watch") {
        // Claim on intent: clearly horizontal from the edge, or clearly
        // downward. A diagonal smudge belongs to the scroller, not to us.
        if (dx > 10 && dx > Math.abs(dy) * 1.4) {
          mode = "back";
          setSwipeLive(true);
        } else if (dy > 10 && dy > Math.abs(dx) * 1.6) {
          mode = "pull";
          setPullLive(true);
        } else if (Math.abs(dy) > 10 || Math.abs(dx) > 14) {
          mode = "none"; // it was a scroll
          return;
        } else {
          return;
        }
      }

      if (mode === "back") {
        e.preventDefault();
        const progress = Math.min(
          1.15,
          dx / (window.innerWidth * BACK_COMMIT_RATIO),
        );
        const dt = e.timeStamp - lastT;
        if (dt > 0) swipeVx = (dx - swipeDx) / dt;
        swipeDx = dx;
        lastT = e.timeStamp;
        renderSwipe(t.clientY, progress);
      } else if (mode === "pull") {
        if (window.scrollY > 1) {
          cancel();
          return;
        }
        e.preventDefault();
        pull = Math.max(0, dy) * PULL_RESISTANCE;
        setMainOffset(pull, false);
        renderPull();
      }
    };

    const finish = () => {
      if (mode === "back") {
        // Past the line, or a fast flick that never reached it — iOS pops on
        // either.
        const commit = armedRef.current || (swipeVx > BACK_FLICK_VX && swipeDx > 36);
        mode = "none";
        setSwipeLive(false);
        if (commit) router.back();
      } else if (mode === "pull") {
        mode = "none";
        if (pull >= PULL_COMMIT) {
          // Hold at a fixed reveal while the refresh runs; the effect below
          // springs the page back when the transition commits.
          setMainOffset(56, true);
          const dot = pullDotRef.current;
          if (dot) {
            dot.style.transition = "transform 220ms var(--ease-out-strong)";
            dot.style.transform = "translateY(20px)";
          }
          navigator.vibrate?.(8); // the release tick — Android only, iOS ignores
          startRefresh(() => router.refresh());
        } else {
          setMainOffset(0, true);
          setPullLive(false);
        }
      } else {
        mode = "none";
      }
      pull = 0;
    };

    const cancel = () => {
      if (mode === "pull") setMainOffset(0, true);
      mode = "none";
      pull = 0;
      setPullLive(false);
      setSwipeLive(false);
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", finish);
    document.addEventListener("touchcancel", cancel);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerover", onPointerOver, true);
      if (hoverTimer) clearTimeout(hoverTimer);
      if (vv && onVv) {
        vv.removeEventListener("resize", onVv);
        vv.removeEventListener("scroll", onVv);
      }
      root.style.removeProperty("--kb");
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", finish);
      document.removeEventListener("touchcancel", cancel);
      setMainOffset(0, false);
    };
  }, [router]);

  // When the refresh transition finishes, the spinner resolves into a drawn
  // check — the pull's "done" — and only then does the page spring home.
  const wasRefreshing = useRef(false);
  useEffect(() => {
    if (wasRefreshing.current && !refreshing) {
      wasRefreshing.current = false;
      setPullDone(true);
      let hide: ReturnType<typeof setTimeout> | undefined;
      const retract = setTimeout(() => {
        const main = mainRef.current;
        if (main) {
          main.style.transition = "transform 260ms var(--ease-nav)";
          main.style.transform = "";
        }
        hide = setTimeout(() => {
          setPullLive(false);
          setPullDone(false);
        }, 280);
      }, 480);
      return () => {
        clearTimeout(retract);
        clearTimeout(hide);
      };
    }
    wasRefreshing.current = refreshing;
  }, [refreshing]);

  return (
    <>
      {/* Status-bar tap → scroll to top. Zero height outside standalone mode,
          where the safe-area inset is 0 — in an installed app it is the strip
          under the clock, which is exactly where iOS users tap. */}
      <button
        aria-label="Scroll to top"
        tabIndex={-1}
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)]"
      />

      {pullLive &&
        createPortal(
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 72px)" }}
          >
            <div
              ref={pullDotRef}
              style={{ opacity: 0 }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-surface shadow-lg"
            >
              {refreshing ? (
                <svg
                  className="h-5 w-5 animate-spin text-brand"
                  viewBox="0 0 20 20"
                  fill="none"
                >
                  <circle
                    cx="10"
                    cy="10"
                    r="8"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray="38"
                    strokeDashoffset="14"
                  />
                </svg>
              ) : pullDone ? (
                // The refresh answered: the spinner resolves into a tick
                // before the page springs home.
                <CheckIcon className="check-draw h-5 w-5 text-brand" />
              ) : (
                <svg
                  className="h-5 w-5 text-brand"
                  viewBox="0 0 20 20"
                  fill="none"
                >
                  <circle
                    data-arc
                    cx="10"
                    cy="10"
                    r="7"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray="44"
                    strokeDashoffset="44"
                    transform="rotate(-90 10 10)"
                  />
                </svg>
              )}
            </div>
          </div>,
          document.body,
        )}

      {swipeLive &&
        createPortal(
          <div
            aria-hidden="true"
            ref={swipeDotRef}
            data-armed="false"
            className="pointer-events-none fixed left-3 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-muted-fg shadow-lg transition-colors data-[armed=true]:border-brand data-[armed=true]:bg-brand data-[armed=true]:text-on-brand"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </div>,
          document.body,
        )}
    </>
  );
}
