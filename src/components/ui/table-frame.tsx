"use client";

import { useEffect, useRef } from "react";

/**
 * The box a table sits in, and the one thing that keeps it honest: when the
 * table is wider than the box, the box scrolls sideways instead of cutting
 * the right-hand columns off.
 *
 * The frame is `overflow-clip` so a sticky header keeps sticking to the page
 * (a scroll container would take the stickiness for itself), which is the
 * right trade for a table that fits — and for years every table fit. Then a
 * browser set to larger text, a 1,024px laptop, a 200% zoom or one long
 * program name made a table a few hundred pixels too wide, and the columns
 * that did not fit — remaining time, last session, how to reach the student —
 * were simply gone, with nothing to scroll and nothing to say so (October 2026
 * audit). A table that does NOT fit now trades its page-sticky header for
 * being readable; one that fits is untouched.
 *
 * It is measured, not guessed: a ResizeObserver on the box and the table sets
 * `data-scrolls` when `scrollWidth` exceeds the width, and globals.css turns
 * that into `overflow-x: auto`. A phone's stacked rows are display: block and
 * never overflow, so they never get it.
 */
export function TableFrame({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const table = box.querySelector("table");
    const measure = () => {
      // Drop the attribute first: once the box scrolls, `scrollWidth` is
      // still the table's width, but `clientWidth` can lose a scrollbar's
      // worth, and the check must not flip back and forth.
      const overflows = box.scrollWidth > box.clientWidth + 1;
      if (overflows) box.setAttribute("data-scrolls", "");
      else box.removeAttribute("data-scrolls");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
