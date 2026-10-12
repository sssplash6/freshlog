"use client";

import { applyTheme } from "@/components/theme-toggle";
import { cn } from "@/lib/cn";

/**
 * The theme as a choice you can SEE, for the Settings page.
 *
 * The account menu's toggle cycles on every press and shows only the current
 * value — right for a menu, where the row is a shortcut, and unclear on a page
 * whose whole job is to show what the settings are: "Light" on a button does
 * not say there is a "Dark", or that pressing will change anything.
 *
 * NO REACT STATE, for the reason `ThemeToggle` gives: the choice already lives
 * in `data-theme` on <html>, set before first paint. Which
 * option is lit is therefore CSS keyed off that attribute (`in-data-*`), so
 * it is right in the first frame on the server and the client alike. A screen
 * reader is told by a "(current)" that CSS reveals on the same condition.
 */
const TRACK = "flex w-fit max-w-full gap-0.5 rounded-lg bg-fill p-0.5";
const BUTTON =
  "inline-flex min-h-9 max-sm:min-h-11 cursor-pointer items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted-fg transition-[background-color,color,box-shadow] hover:text-ink";
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
        Light
        <Current when="not-in-data-[theme=dark]:block" />
      </button>
      <button
        type="button"
        onClick={() => applyTheme("dark")}
        className={cn(BUTTON, "in-data-[theme=dark]:bg-surface in-data-[theme=dark]:text-ink in-data-[theme=dark]:shadow-sm")}
      >
        Dark
        <Current when="in-data-[theme=dark]:block" />
      </button>
    </div>
  );
}
