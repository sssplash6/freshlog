"use client";

import { cn } from "@/lib/cn";

const ORDER = ["compact", "standard", "comfortable"] as const;
type Density = (typeof ORDER)[number];

/**
 * How tightly rows and text pack, remembered per browser: compact for the admin
 * who scans a forty-row roster all day, comfortable for somebody who would
 * rather read. Comfortable is the default (October 2026); standard is the 94%
 * the app used before it.
 *
 * NO REACT STATE, for the reasons `ThemeToggle` records: the choice lives in
 * `data-density` on <html>, set by the root layout's inline script before the
 * first paint, and the label is three spans of which CSS shows one
 * (`.density-*-only` in globals.css). Correct in the first frame, on the server
 * as much as the client.
 *
 * A cycle rather than a three-way control because it sits in the account menu
 * beside Theme, as the same shape of row — one tap, the word changes. It only
 * matters from `sm` up; a phone keeps full-size targets whatever this says.
 */
export function DensityToggle({
  className,
  inline = false,
}: {
  className?: string;
  /**
   * On a settings row, where the row's own label already says "Density": the
   * word inside the button goes screen-reader-only and the button takes the
   * field fill, so it reads as a control rather than a second label.
   */
  inline?: boolean;
}) {
  const cycle = () => {
    const root = document.documentElement;
    const current = (root.dataset.density as Density | undefined) ?? "comfortable";
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
    if (next === "comfortable") delete root.dataset.density;
    else root.dataset.density = next;
    try {
      if (next === "comfortable") localStorage.removeItem("density");
      else localStorage.setItem("density", next);
    } catch {
      // Blocked site data: the choice holds for this page and is not kept.
    }
  };

  return (
    <button
      type="button"
      onClick={cycle}
      className={cn(
        "hidden min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-left text-body transition-colors sm:flex",
        inline
          ? "bg-fill font-medium text-ink ring-1 ring-inset ring-ink/15 hover:bg-fill-strong"
          : "text-ink hover:bg-fill",
        className
      )}
    >
      <span className={cn(inline && "sr-only")}>Density</span>
      <span className={cn("density-compact-only text-xs", inline ? "text-ink" : "text-muted-fg")}>Compact</span>
      <span className={cn("density-standard-only text-xs", inline ? "text-ink" : "text-muted-fg")}>Standard</span>
      <span className={cn("density-comfortable-only text-xs", inline ? "text-ink" : "text-muted-fg")}>Comfortable</span>
    </button>
  );
}
