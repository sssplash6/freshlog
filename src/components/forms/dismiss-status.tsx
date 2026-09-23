"use client";

import { useState, useTransition } from "react";

import { XIcon } from "@/components/icons";
import { dismissStatus } from "@/lib/actions/dismissals";

/**
 * "Don't show me this again", on one attention row.
 *
 * Two steps, because it is not undoable from the row it removes — once the row
 * is gone there is nothing left to click to bring it back. One tap arms it and
 * names what will happen; the second does it. The same shape as every other
 * destructive control here, at a size that suits a row's right edge.
 *
 * Hidden until the row is hovered or something inside it has focus, so a list
 * of things needing attention does not read as a list of dismiss buttons —
 * except on touch, where there is no hover and it stays visible.
 */
export function DismissStatus({
  type,
  subjectId,
  label,
}: {
  type: string;
  subjectId?: string;
  /** What the row says, so the confirm names the thing being silenced. */
  label: string;
}) {
  const [armed, setArmed] = useState(false);
  const [, startDismiss] = useTransition();

  if (armed) {
    return (
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          // The row leaves before the server answers — opacity + slide read
          // as "dismissing" while the write lands. If it fails, the class
          // comes off and the row stands back up; a row that pretended to be
          // gone is a lie the toaster would have to explain.
          e.preventDefault();
          const li = e.currentTarget.closest("li");
          if (li) {
            li.classList.add("dismissing");
            // iOS's row-delete shape: fade + slide, then the height folds so
            // the rows beneath travel up to meet it. Height is a layout
            // property — fine here, it is one row once, not a loop.
            li.style.maxHeight = `${li.offsetHeight}px`;
            li.style.overflow = "hidden";
            requestAnimationFrame(() => {
              li.style.maxHeight = "0px";
              li.style.paddingTop = "0px";
              li.style.paddingBottom = "0px";
            });
          }
          const formData = new FormData(e.currentTarget);
          startDismiss(async () => {
            try {
              await dismissStatus(formData);
            } catch (err) {
              if (li) {
                li.classList.remove("dismissing");
                li.style.maxHeight = "";
                li.style.overflow = "";
                li.style.paddingTop = "";
                li.style.paddingBottom = "";
              }
              throw err; // the global toaster reports it
            }
          });
        }}
      >
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="subjectId" value={subjectId ?? ""} />
        <span className="text-xs text-muted-fg">Hide for good?</span>
        <button
          type="submit"
          className="min-h-9 cursor-pointer rounded-lg border border-danger px-2.5 text-xs font-semibold text-danger-ink transition-colors hover:bg-danger-soft"
        >
          Hide
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="min-h-9 cursor-pointer rounded-lg px-2 text-xs font-medium text-muted-fg transition-colors hover:text-ink"
        >
          Keep
        </button>
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setArmed(true)}
      title={`Stop showing "${label}"`}
      aria-label={`Stop showing "${label}"`}
      className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-fg opacity-0 transition-opacity hover:bg-canvas hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100"
    >
      <XIcon className="h-4 w-4" />
    </button>
  );
}
