"use client";

import { useEffect, useState } from "react";

import { ChevronDownIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * A list that shows its first few rows and folds the rest behind one row that
 * says how many there are — iOS's "Show all", in place of a scroll box.
 *
 * The student board used to give each of its three lists a fixed-height pane
 * with its own scrollbar. That kept the board a screen tall, but it put a
 * scrolling region inside a scrolling page, three times over, and a phone
 * reader's thumb caught in whichever one it landed on. A count and a tap is
 * the same reach with none of the trapping.
 *
 * The rows arrive already rendered (`<li>` elements from the row components);
 * this only decides how many of them are on the page. A link to a row that is
 * folded away — `#task-…` — opens the fold, so an anchor never lands on
 * nothing.
 */
export function ShowMoreList({
  rows,
  limit = 5,
  noun,
  className,
}: {
  rows: React.ReactNode[];
  /** How many show before the fold. */
  limit?: number;
  /** Plural, for the toggle: "Show all 14 meetings". */
  noun: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const folds = rows.length > limit + 1;

  useEffect(() => {
    if (!folds) return;
    const hash = window.location.hash.slice(1);
    // Read once on arrival, not synchronised with anything: an anchor that
    // points into the fold is the one reason to open it unasked.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hash && !document.getElementById(hash)) setOpen(true);
  }, [folds]);

  const shown = folds && !open ? rows.slice(0, limit) : rows;

  return (
    <>
      <ul className={cn("divide-y divide-line", className)}>{shown}</ul>
      {folds && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-h-11 w-full items-center gap-1.5 border-t border-line px-4 py-3 text-left text-body font-medium text-brand transition-colors hover:bg-fill focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:px-5"
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")}
          />
          {open ? "Show fewer" : `Show all ${rows.length} ${noun}`}
        </button>
      )}
    </>
  );
}
