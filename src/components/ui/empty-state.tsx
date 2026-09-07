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
 * There is deliberately no `action` slot. Every empty state that carried a
 * button was a page teaching its own layout — "log a session at the bottom of
 * this page and it appears here" — and pointing at a form that is either
 * already on screen or belongs somewhere else entirely. An empty state
 * explains; the page's own primary action acts.
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
  className,
}: {
  icon?: React.ReactNode;
  /** What is absent. A noun phrase, not a sentence. */
  title?: React.ReactNode;
  /** Why, in one clause of twelve words or fewer. */
  children?: React.ReactNode;
  variant?: EmptyVariant;
  framed?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 px-6 py-10 text-center",
        framed && "rounded-xl border border-line bg-surface shadow-sm",
        className
      )}
    >
      {icon && (
        <div className="mb-1 text-muted-fg/40 [&_svg]:h-8 [&_svg]:w-8">{icon}</div>
      )}
      {title && (
        <p
          className={cn(
            "text-[15px] font-medium",
            // A blocked empty state is the only one that is not fine. It still
            // does not get a red box: the words carry it, and a whole tinted
            // panel for "nothing here" is the noise this replaces.
            variant === "blocked" ? "text-warn-ink" : "text-ink"
          )}
        >
          {title}
        </p>
      )}
      {children && <div className="max-w-sm text-sm text-muted-fg">{children}</div>}
    </div>
  );
}
