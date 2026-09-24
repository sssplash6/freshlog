"use client";

import { useState } from "react";

import { ChevronDownIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * The unfold control for a stacked table row — the figure the row is scanned
 * by, beside a chevron; one tap opens the labelled fields underneath.
 *
 * Below `sm` a table row is a stack of labelled lines, one per column, and a
 * roster of twenty is three screens of scrolling. Folding the detail columns
 * leaves the name, the address and the one figure worth scanning, and this
 * button is the way to the rest. At `sm` and up the real table renders every
 * column and there is nothing to unfold, so the button removes itself.
 *
 * The state lives on the ROW, not in React: `data-open` on the <tr> is what
 * the stylesheet reads to reveal the folded cells, so a server-rendered list
 * opens without a client re-render of every field it hides. This button only
 * mirrors the attribute into `aria-expanded`.
 */
export function RowFold({
  children,
  label,
}: {
  /** The collapsed headline — the one figure the row is scanned by. */
  children?: React.ReactNode;
  /** Who the row is about, so the control names more than "Details". */
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} details for ${label}`}
      onClick={(e) => {
        const tr = e.currentTarget.closest("tr");
        if (!tr) return;
        tr.toggleAttribute("data-open");
        setOpen(tr.hasAttribute("data-open"));
      }}
      className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-end gap-1.5 rounded-lg px-1.5 transition-colors active:bg-canvas sm:hidden"
    >
      {children}
      <ChevronDownIcon
        className={cn(
          "h-4 w-4 shrink-0 text-muted-fg transition-transform duration-200",
          open && "rotate-180"
        )}
      />
    </button>
  );
}
