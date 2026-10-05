"use client";

import { MoonIcon, SunIcon } from "@/components/icons";
import { applyTheme } from "@/components/theme-toggle";
import { cn } from "@/lib/cn";

/**
 * Theme and density as choices you can SEE, for the Settings page.
 *
 * The account menu's toggles cycle on every press and show only the current
 * value — right for a menu, where the row is a shortcut, and unclear on a page
 * whose whole job is to show what the settings are: "Light" on a button does
 * not say there is a "Dark", or that pressing will change anything.
 *
 * NO REACT STATE, for the reason `ThemeToggle` gives: the choice already lives
 * in `data-theme` / `data-density` on <html>, set before first paint. Which
 * option is lit is therefore CSS keyed off those attributes (`in-data-*`), so
 * it is right in the first frame on the server and the client alike. A screen
 * reader is told by a "(current)" that CSS reveals on the same condition.
 */
const TRACK = "flex w-fit max-w-full gap-0.5 rounded-lg bg-fill p-0.5";
const BUTTON =
  "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-3 text-[0.8125rem] font-medium text-muted-fg transition-[background-color,color,box-shadow] hover:text-ink";
function Current({ when }: { when: string }) {
  return <span className={cn("sr-only hidden", when)}> (current)</span>;
}

export function ThemeChoice({ className }: { className?: string }) {
  return (
    <div role="group" aria-label="Theme" className={cn(TRACK, className)}>
      <button
        type="button"
        onClick={() => applyTheme("light")}
        className={cn(BUTTON, "not-in-data-[theme=dark]:bg-surface not-in-data-[theme=dark]:text-ink not-in-data-[theme=dark]:shadow-sm")}
      >
        <SunIcon className="h-4 w-4" />
        Light
        <Current when="not-in-data-[theme=dark]:block" />
      </button>
      <button
        type="button"
        onClick={() => applyTheme("dark")}
        className={cn(BUTTON, "in-data-[theme=dark]:bg-surface in-data-[theme=dark]:text-ink in-data-[theme=dark]:shadow-sm")}
      >
        <MoonIcon className="h-4 w-4" />
        Dark
        <Current when="in-data-[theme=dark]:block" />
      </button>
    </div>
  );
}

function setDensity(next: "compact" | "default" | "comfortable") {
  const root = document.documentElement;
  if (next === "default") delete root.dataset.density;
  else root.dataset.density = next;
  try {
    if (next === "default") localStorage.removeItem("density");
    else localStorage.setItem("density", next);
  } catch {
    // Blocked site data: the choice holds for this page and is not kept.
  }
}

export function DensityChoice({ className }: { className?: string }) {
  // Written out in full rather than assembled: Tailwind finds a class by
  // reading it in the source, and a string built at runtime is never seen.
  return (
    <div role="group" aria-label="Density" className={cn(TRACK, className)}>
      <button
        type="button"
        onClick={() => setDensity("compact")}
        className={cn(BUTTON, "in-data-[density=compact]:bg-surface in-data-[density=compact]:text-ink in-data-[density=compact]:shadow-sm")}
      >
        Compact
        <Current when="in-data-[density=compact]:block" />
      </button>
      <button
        type="button"
        onClick={() => setDensity("default")}
        className={cn(BUTTON, "in-[html:not([data-density])]:bg-surface in-[html:not([data-density])]:text-ink in-[html:not([data-density])]:shadow-sm")}
      >
        Default
        <Current when="in-[html:not([data-density])]:block" />
      </button>
      <button
        type="button"
        onClick={() => setDensity("comfortable")}
        className={cn(BUTTON, "in-data-[density=comfortable]:bg-surface in-data-[density=comfortable]:text-ink in-data-[density=comfortable]:shadow-sm")}
      >
        Comfortable
        <Current when="in-data-[density=comfortable]:block" />
      </button>
    </div>
  );
}
