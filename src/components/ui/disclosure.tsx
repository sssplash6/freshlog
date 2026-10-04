import { ChevronDownIcon, PlusIcon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * A section folded away until it is asked for.
 *
 * Built on native `<details>`, which is the one place this app prefers a
 * platform control without argument: keyboard and screen-reader behaviour
 * arrive free, it works before hydration, and browsers expand a closed
 * `<details>` to reveal a find-in-page hit — which every `useState` version
 * silently breaks. Six hand-rolled idioms existed before this: two styled
 * `<details>`, a "Show ▾ / Hide ▴" pair of text glyphs, a "New program" toggle
 * and a "+ Add a cohort" link in the same file, and an inline Edit row.
 *
 * WHAT MAY BE FOLDED is the harder half, and it is not "anything that makes the
 * page shorter" — collapsing is the easiest way to make a page look calm while
 * leaving its mess in place. In order, stopping at the first yes:
 *
 *   Is it what the page is FOR?          Show it.
 *   Does it answer a different question? Give it an address, not a fold.
 *   Is it free text past its clamp?      That is ExpandableText.
 *   Is it a menu of row actions?         That is RowActionMenu.
 *   An occasional action on this page's
 *     subject, or a settled subset?      Now it has earned a fold.
 *   Anything else                        It is noise. Delete it.
 *
 * Two rules worth stating out loud:
 *
 * `count` shows BEFORE the fold is opened. Collapsing may hide the rows; it may
 * never hide the magnitude. A count of zero renders nothing at all — an empty
 * disclosure is a control that lies about having contents.
 *
 * Height is never animated. Reflowing a table under the reader's cursor is
 * worse than an instant open, and the chevron's rotation is enough to say what
 * happened.
 */
export function Disclosure({
  label,
  count,
  hint,
  defaultOpen = false,
  variant = "link",
  aside,
  children,
  className,
}: {
  /** Names what is inside, as a noun or an imperative. Never "More" or "Show". */
  label: React.ReactNode;
  /** Shown in the summary when the fold hides countable rows. */
  count?: number;
  /** One line under the summary, ≤ 12 words. */
  hint?: React.ReactNode;
  defaultOpen?: boolean;
  /**
   * How the trigger reads.
   *
   *   link    a quiet brand line with a chevron. The default, and right for a
   *           fold that sits beside content the reader came for.
   *   button  a full-width button. For the ONE thing a page exists to let you
   *           do next to reading it — adding students to a program — where a
   *           text link above a table is not an action anybody finds.
   *
   *   create  the link's line with a plus in place of the chevron, for a fold
           that holds a form making something new — "New program", "Add a
           cohort", "Register a mentor". A chevron says "there is more to
           read here"; these say "make one", and they now say it the way
           "Set a task" and "Add students" do. The plus turns to a cross
           while open, so the same control reads as the way back out.
   *
   * It is still a `<details>`: the target grows, the semantics do not change.
   */
  variant?: "link" | "button" | "create";
  /**
   * Rendered on the summary's own line, after the label.
   *
   * For controls that belong beside the fold rather than inside it — filter
   * chips next to the selects they narrow. A row of its own for three pills
   * made the bar taller than the table it filters.
   */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  // Nothing to open.
  if (count === 0) return null;

  const button = variant === "button";

  const fold = (
    <details open={defaultOpen} className={cn("group", !aside && className)}>
      <summary
        className={cn(
          button
            ? buttonClasses("secondary", "md", "w-full cursor-pointer list-none")
            : "flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 text-[0.9375rem] font-medium text-brand hover:text-brand-dark",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
          // Safari still paints its own triangle without this.
          "[&::-webkit-details-marker]:hidden"
        )}
      >
        {variant === "create" ? (
          <PlusIcon
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-45"
            aria-hidden="true"
          />
        ) : (
          <ChevronDownIcon
            className="h-4 w-4 shrink-0 -rotate-90 transition-transform group-open:rotate-0"
            aria-hidden="true"
          />
        )}
        <span>{label}</span>
        {count != null && (
          <span className="tabular-nums text-muted-fg">· {count}</span>
        )}
      </summary>
      {hint && (
        <p
          className={cn(
            "text-[0.8125rem] text-muted-fg",
            button ? "mt-2 text-center" : "mb-2 ml-5.5"
          )}
        >
          {hint}
        </p>
      )}
      <div className={button ? "mt-3" : undefined}>{children}</div>
    </details>
  );

  if (!aside) return fold;

  // The fold keeps its own full-width line so its contents open underneath,
  // and the aside rides the summary's row beside it.
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      {fold}
      {aside}
    </div>
  );
}
