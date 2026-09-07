"use client";

import { MoonIcon, SunIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * Light or dark, remembered per browser.
 *
 * NO REACT STATE, deliberately. The theme already lives in one place — the
 * `data-theme` attribute the inline script in the root layout sets before the
 * first paint — and mirroring it into a `useState` buys nothing and costs
 * three things: the server cannot know which theme a browser is in, so the
 * first render is a guess; correcting the guess in an effect is a cascading
 * render (and a lint error); and the label flickers from one word to the other
 * on every page load.
 *
 * So both labels are rendered and CSS shows the right one — `.theme-dark-only`
 * and `.theme-light-only` in `globals.css`, keyed off the same attribute. It is
 * correct in the very first frame, on the server as much as the client, and
 * the click handler reads the DOM rather than a copy of it.
 *
 * A two-state toggle, not a three-way with "system". The system preference is
 * still the DEFAULT — it decides for everyone who has never touched this — but
 * offering "system" as a third option makes a reader think about a setting
 * they came here to stop thinking about.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const flip = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // A browser blocking site data still gets the theme for this page; it
      // just will not remember it. Losing the preference beats throwing.
    }
  };

  return (
    <button
      type="button"
      onClick={flip}
      className={cn(
        "flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-medium text-muted-fg transition-colors hover:bg-canvas hover:text-ink",
        className
      )}
    >
      <span>Theme</span>
      {/* The state, and what pressing this does to it, in the one word each.
          Only one is ever in the accessibility tree: the other is `display:
          none`, not `opacity: 0`. */}
      <span className="theme-light-only flex items-center gap-1.5 text-xs">
        <SunIcon className="h-4 w-4" />
        Light
      </span>
      <span className="theme-dark-only flex items-center gap-1.5 text-xs">
        <MoonIcon className="h-4 w-4" />
        Dark
      </span>
    </button>
  );
}
