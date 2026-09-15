import { cn } from "@/lib/cn";

/**
 * A note, shown as its own first line and unfolded by tapping that line.
 *
 * What it replaces is `▸ note` — a disclosure whose summary was the WORD
 * "note" over a hidden copy of the text. That tells the reader a note exists
 * and nothing about whether it is worth opening, so every row in a ledger of
 * forty sessions had to be opened to find the one that said "missed an hour,
 * not excused". The first line answers that without costing a row its height.
 *
 * Native `<details>`, and the summary IS the text: no second copy in the DOM
 * for a screen reader to read twice, keyboard and screen-reader behaviour
 * arrive free, it works before hydration, and find-in-page opens it. The clamp
 * lifts on `[open]`, which is one CSS rule rather than a state hook — so this
 * is a server component and costs the page nothing.
 *
 * NOT `ExpandableText`, and the difference is which question is being asked.
 * That one clamps text that is part of the row — a task's own name — and grows
 * a "Show more" only when the clamp actually cut something off, which it has to
 * measure in the browser to know. This is a note ABOUT the row: always one
 * line, always openable, and the triangle says so whether or not there is more.
 */
export function ExpandableNote({
  text,
  className,
}: {
  text: string;
  /** The tone the note carries in its own row. */
  className?: string;
}) {
  return (
    <details className="group/note">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-start gap-1.5 text-xs text-muted-fg transition-colors hover:text-ink [&::-webkit-details-marker]:hidden",
          className
        )}
      >
        <span
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-[0.5625rem] transition-transform group-open/note:rotate-90"
        >
          ▸
        </span>
        <span className="line-clamp-1 min-w-0 whitespace-pre-line group-open/note:line-clamp-none">
          {text}
        </span>
      </summary>
    </details>
  );
}
