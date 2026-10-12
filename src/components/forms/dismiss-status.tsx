"use client";

import { useTransition } from "react";

import { XIcon } from "@/components/icons";
import { toast } from "@/components/toaster";
import { dismissStatus, restoreStatus } from "@/lib/actions/dismissals";

/**
 * "Don't show me this again", on one attention row.
 *
 * One tap, then Undo. It used to be two steps — arm, then confirm — because
 * once the row was gone there was nothing left to click to bring it back. The
 * toast is that something: the row folds away at once and "Hidden · Undo"
 * appears at the bottom of the screen, running `restoreStatus` if tapped. A
 * reversible action earns a toast after, not a question before; confirms are
 * kept for the things that cannot be taken back.
 *
 * Shown at rest as a quiet muted cross: a control that appeared only on hover
 * was one nobody found.
 */
export function DismissStatus({
  type,
  subjectId,
  label,
}: {
  type: string;
  subjectId?: string;
  /** What the row says, so the control and the toast name the thing silenced. */
  label: string;
}) {
  const [, startDismiss] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        // The row leaves before the server answers — opacity + slide read as
        // "dismissing" while the write lands. If it fails, the class comes off
        // and the row stands back up; a row that pretended to be gone is a lie
        // the toaster would have to explain.
        e.preventDefault();
        const li = e.currentTarget.closest("li");
        const reset = () => {
          if (!li) return;
          li.classList.remove("dismissing");
          li.style.maxHeight = "";
          li.style.overflow = "";
          li.style.paddingTop = "";
          li.style.paddingBottom = "";
        };
        if (li) {
          li.classList.add("dismissing");
          // iOS's row-delete shape: fade + slide, then the height folds so the
          // rows beneath travel up to meet it. Height is a layout property —
          // fine here, it is one row once, not a loop.
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
            reset();
            throw err; // the global toaster reports it
          }
          toast({
            message: `Hidden “${label}”`,
            action: {
              label: "Undo",
              run: async () => {
                await restoreStatus(formData);
                // The server re-renders the list with the row back in it; the
                // inline styles would otherwise keep the old node folded if
                // React reuses it.
                reset();
              },
            },
          });
        });
      }}
    >
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="subjectId" value={subjectId ?? ""} />
      <button
        type="submit"
        title="Hide"
        aria-label={`Hide “${label}”`}
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-fg transition-colors hover:bg-canvas hover:text-ink"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </form>
  );
}
