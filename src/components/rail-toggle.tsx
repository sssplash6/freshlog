"use client";

import { PanelIcon } from "@/components/icons";

/**
 * Open the rail, or shut it.
 *
 * NO REACT STATE, for the three reasons `ThemeToggle` records: the state lives
 * in one place — `data-rail` on `<html>`, set by the inline script in the root
 * layout before the first paint — the server cannot know which way a browser
 * left it, and correcting a guess in an effect is both a cascading render and a
 * visible jump on every page load.
 *
 * Only rendered inside the rail, which only exists at `lg`. Below that a phone
 * has the tab bar and there is nothing here to collapse.
 */
export function RailToggle() {
  const flip = (event: React.MouseEvent<HTMLButtonElement>) => {
    const root = document.documentElement;
    const next = root.dataset.rail === "collapsed" ? "open" : "collapsed";
    delete root.dataset.railHold;
    if (next === "collapsed") {
      root.dataset.rail = "collapsed";
      // Shut under the cursor that clicked, the rail would peek straight back
      // open (`rail-peek:` in globals.css). Hold the peek off until the cursor
      // leaves; coming back to the rail opens it as it always has.
      const rail = event.currentTarget.closest("aside");
      if (rail?.matches(":hover")) {
        root.dataset.railHold = "";
        rail.addEventListener("pointerleave", () => delete root.dataset.railHold, {
          once: true,
        });
      }
    } else {
      delete root.dataset.rail;
    }
    try {
      localStorage.setItem("rail", next);
    } catch {
      // A browser blocking site data still gets the rail it asked for on this
      // page; it just will not remember it.
    }
  };

  return (
    <button
      type="button"
      onClick={flip}
      aria-label="Show or hide the sidebar"
      title="Show or hide the sidebar"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-fg transition hover:bg-canvas hover:text-ink"
    >
      <PanelIcon className="h-4 w-4" />
    </button>
  );
}
