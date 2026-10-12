import { InboxIcon, SearchIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * Nothing here — and why.
 *
 * Structured rather than free-form, because the free-form version produced the
 * same non-answer fourteen times: an empty state that ends "…and it appears
 * here once it's booked" tells the reader where a thing WILL be, which they can
 * see, instead of why it is not there yet, which they cannot.
 *
 * So: `title` names what is absent, `children` says why in one clause, and the
 * `variant` decides whether that absence is normal.
 *
 * `action` is ONE way out, and only when it goes somewhere the page does not
 * already show. The empty states that carried buttons before were pages
 * teaching their own layout — "log a session at the bottom of this page and it
 * appears here" — pointing at a form already on screen. That is still wrong.
 * What is right is the iOS shape: one sentence, and the one link that fills
 * the list when the thing that fills it lives on another page.
 */
export type EmptyVariant =
  /** Nothing is wrong; this is simply what "not yet" looks like. */
  | "healthy"
  /** A filter or a search hid everything. The data exists. */
  | "no-results"
  /** Something must happen elsewhere before this can fill. */
  | "blocked";

export function EmptyState({
  icon,
  title,
  children,
  variant = "healthy",
  framed = true,
  action,
  className,
}: {
  icon?: React.ReactNode;
  /** What is absent. A noun phrase, not a sentence. */
  title?: React.ReactNode;
  /** Why, in one clause of twelve words or fewer. */
  children?: React.ReactNode;
  variant?: EmptyVariant;
  framed?: boolean;
  /** One link or button, to where this list gets filled. Never a second. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rise-in flex flex-col items-center gap-1 px-6 py-10 text-center",
        framed && "rounded-xl bg-surface shadow-sm",
        className
      )}
    >
      {/* A glyph in a soft disc, so an empty card has a shape to look at and
          not just a sentence in white. Only in a card of its own: inside a
          list that already has a frame it would be a second thing to read. */}
      {(icon ?? framed) && (
        <div className="furniture-in mb-2 grid h-11 w-11 place-items-center rounded-full bg-fill text-muted-fg [&_svg]:h-5 [&_svg]:w-5">
          {icon ?? (variant === "no-results" ? <SearchIcon /> : <InboxIcon />)}
        </div>
      )}
      {title && (
        <p
          className={cn(
            "text-body font-medium",
            // A blocked empty state is the only one that is not fine. It still
            // does not get a red box: the words carry it, and a whole tinted
            // panel for "nothing here" is the noise this replaces.
            variant === "blocked" ? "text-warn-ink" : "text-ink"
          )}
        >
          {title}
        </p>
      )}
      {children && (
        <div className="max-w-sm text-xs text-muted-fg">{children}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
