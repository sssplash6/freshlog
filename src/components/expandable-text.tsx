"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

/** Only the clamps the callers use; Tailwind can't see a computed class name. */
const CLAMP: Record<number, string> = {
  1: "line-clamp-1",
  2: "line-clamp-2",
  3: "line-clamp-3",
};

/**
 * Free text clamped to a few lines: notes run to paragraphs, and so does the
 * occasional task whose name was written as a description. Either one turning a
 * row forty lines tall costs every other row its scanability. A "Show more"
 * toggle unfolds the full text in place, and only appears when the clamp
 * actually cut something off.
 *
 * At `lines={1}` the toggle goes INLINE, after the text rather than under it.
 * A one-line clamp exists to keep a row one line tall, and a block-level
 * "Show more" beneath it would spend the line it just saved.
 */
export function ExpandableText({
  text,
  lines = 3,
  className = "text-ink",
}: {
  text: string;
  /** How many lines survive the clamp — 2 in a narrow column, 3 in prose. */
  lines?: 1 | 2 | 3;
  /** The tone the text carries in its own column. */
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  // Measured while clamped — an open text never overflows its own height.
  useLayoutEffect(() => {
    if (!open && ref.current) {
      setClipped(ref.current.scrollHeight > ref.current.clientHeight + 1);
    }
  }, [open, text]);

  const tight = lines === 1 && !open;

  return (
    <div className={tight ? "flex min-w-0 items-baseline gap-1.5" : undefined}>
      <div
        ref={ref}
        id={id}
        className={cn(
          "whitespace-pre-line",
          className,
          open ? "" : CLAMP[lines],
          tight && "min-w-0 flex-1"
        )}
      >
        {text}
      </div>
      {(clipped || open) && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={id}
          className={cn(
            "shrink-0 text-xs font-medium text-brand hover:underline",
            tight ? "" : "mt-1"
          )}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
