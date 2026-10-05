"use client";

import { MoonIcon, SunIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * Set the theme, as a crossfade where the browser can do one. Shared by the
 * account menu's toggle and the Settings page's Light / Dark choice, so both
 * remember the choice the same way.
 */
export function applyTheme(next: "light" | "dark") {
  const root = document.documentElement;
  const apply = () => {
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // A browser blocking site data still gets the theme for this page; it
      // just will not remember it. Losing the preference beats throwing.
    }
  };
  // Where supported, the swap is a crossfade — the whole interface morphs
  // into the other theme rather than snapping. The "theme" type lets the
  // chrome captures join the fade (globals.css) instead of holding still
  // the way they do on page pushes. Browsers without the API (Safari <
  // 18.4) get the same instant flip they always had.
  const doc = document as Document & {
    startViewTransition?: (opts: {
      update: () => void;
      types: string[];
    }) => unknown;
  };
  if (doc.startViewTransition)
    doc.startViewTransition({ update: apply, types: ["theme"] });
  else apply();
}

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
export function ThemeToggle({
  className,
  inline = false,
}: {
  className?: string;
  /**
   * On a settings row, where the row's own label already says "Theme": the
   * word inside the button goes screen-reader-only and the button takes the
   * field fill, so it reads as a control rather than a second label.
   */
  inline?: boolean;
}) {
  const flip = () =>
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

  return (
    <button
      type="button"
      onClick={flip}
      className={cn(
        "flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-left text-body transition-colors",
        inline
          ? "bg-fill font-medium text-ink ring-1 ring-inset ring-ink/15 hover:bg-fill-strong"
          : "text-ink hover:bg-fill",
        className
      )}
    >
      <span className={cn(inline && "sr-only")}>Theme</span>
      {/* The state, and what pressing this does to it, in the one word each.
          Only one is ever in the accessibility tree: the other is `display:
          none`, not `opacity: 0`. */}
      <span className={cn("theme-light-only flex items-center gap-1.5 text-xs", inline ? "text-ink" : "text-muted-fg")}>
        <SunIcon className="h-4 w-4" />
        Light
      </span>
      <span className={cn("theme-dark-only flex items-center gap-1.5 text-xs", inline ? "text-ink" : "text-muted-fg")}>
        <MoonIcon className="h-4 w-4" />
        Dark
      </span>
    </button>
  );
}
