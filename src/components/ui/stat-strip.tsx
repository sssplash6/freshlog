import { cn } from "@/lib/cn";

/**
 * A page's headline figures as one panel: ONE lead and up to three supporting
 * figures, divided by hairlines inside a single card.
 *
 * The lead is the number the page exists to show — hours remaining, on a page
 * about a balance — and is drawn at the lead size over a soft pool of the hours
 * orange, so it is the first thing read. The rest are quieter, each with the
 * small tinted glyph that tells them apart at a glance. `Figure`'s rule stands:
 * one lead per page, and a strip where every number is the same size has no
 * hierarchy.
 *
 * Stacked below `sm` (a phone is one column of figures, hairlines between);
 * side by side above it, the lead taking the extra width.
 */
export function StatStrip({
  lead,
  items,
  className,
}: {
  lead: { label: string; value: string; tone: "hours" | "danger" | "muted"; hint?: string };
  items: { label: string; value: string; icon: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-sm sm:divide-x sm:divide-y-0",
        items.length === 3 ? "sm:grid-cols-[1.5fr_1fr_1fr_1fr]" : items.length === 2 ? "sm:grid-cols-[1.5fr_1fr_1fr]" : "sm:grid-cols-[1.5fr_1fr]",
        className
      )}
    >
      {/* The pool is the tone's own soft wash, fading to the card: orange for
          hours, red when the balance is negative. It is behind the figure and
          never under body text, so contrast is the figure's alone. */}
      <div
        className={cn(
          "min-w-0 px-4 py-4 sm:px-5 sm:py-5",
          lead.tone === "danger" &&
            "bg-[radial-gradient(22rem_9rem_at_0%_0%,var(--color-danger-soft),transparent_75%)]",
          lead.tone === "hours" &&
            "bg-[radial-gradient(22rem_9rem_at_0%_0%,var(--color-accent-soft),transparent_75%)]"
        )}
      >
        <dt className="text-xs font-medium text-muted-fg">{lead.label}</dt>
        <dd
          className={cn(
            "mt-1.5 text-[2.625rem] font-semibold leading-none tracking-tight tabular-nums",
            lead.tone === "danger" ? "text-danger-ink" : lead.tone === "hours" ? "text-accent-ink" : "text-muted-fg"
          )}
        >
          {lead.value}
        </dd>
        {lead.hint && <p className="mt-2 text-xs text-muted-fg">{lead.hint}</p>}
      </div>
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 items-center gap-3 px-4 py-4 sm:gap-2.5 sm:px-4 sm:py-5 lg:gap-3 lg:px-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
            {item.icon}
          </span>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted-fg">{item.label}</dt>
            <dd className="mt-0.5 whitespace-nowrap text-[1.25rem] font-semibold leading-none tabular-nums text-ink lg:text-[1.5rem]">
              {item.value}
            </dd>
          </div>
        </div>
      ))}
    </dl>
  );
}
