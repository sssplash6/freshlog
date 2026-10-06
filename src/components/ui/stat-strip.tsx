import { cn } from "@/lib/cn";

/**
 * A page's headline figures as one panel: ONE lead and up to three supporting
 * figures, divided by hairlines inside a single card.
 *
 * The lead is the number the page exists to show — hours remaining, on a page
 * about a balance — and is drawn at the lead size in the hours ink, so it is
 * the first thing read. The rest are quieter, each with a small grey glyph
 * that tells them apart at a glance.
 *
 * October 2026: no pool of colour behind the lead, and grey discs rather than
 * brand-blue ones. DESIGN.md bans a banner wash, and keeps brand blue for
 * things you can press — a blue disc beside a figure that does nothing taught
 * the reader that blue might not mean "tap". The lead's own colour and size
 * already carry the emphasis; a gradient under it was saying it twice. `Figure`'s rule stands:
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
  // The strip chooses side-by-side from the width of ITS box, in rem, not from
  // the viewport: at 200% text on a wide monitor the viewport said "room for
  // four columns" and the figures ran out of the card, cut off at its edge.
  return (
    <div className={cn("@container", className)}>
      <dl
        className={cn(
          "grid divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-sm @3xl:divide-x @3xl:divide-y-0",
          items.length === 3 ? "@3xl:grid-cols-[1.5fr_1fr_1fr_1fr]" : items.length === 2 ? "@3xl:grid-cols-[1.5fr_1fr_1fr]" : "@3xl:grid-cols-[1.5fr_1fr]"
        )}
      >
        <div className="min-w-0 px-4 py-4 @3xl:px-5 @3xl:py-5">
          <dt className="text-xs font-medium text-muted-fg">{lead.label}</dt>
          <dd
            className={cn(
              "mt-1.5 text-lead font-semibold tabular-nums",
              lead.tone === "danger" ? "text-danger-ink" : lead.tone === "hours" ? "text-accent-ink" : "text-muted-fg"
            )}
          >
            {lead.value}
          </dd>
          {lead.hint && <p className="mt-2 text-xs text-muted-fg">{lead.hint}</p>}
        </div>
        {items.map((item) => (
          <div key={item.label} className="flex min-w-0 items-center gap-3 px-4 py-4 @3xl:gap-2.5 @3xl:py-5 @5xl:gap-3 @5xl:px-5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-fill text-muted-fg">
              {item.icon}
            </span>
            <div className="min-w-0">
              <dt className="text-xs font-medium text-muted-fg">{item.label}</dt>
              <dd className="mt-0.5 whitespace-nowrap text-figure-md font-semibold tabular-nums text-ink">
                {item.value}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  );
}
