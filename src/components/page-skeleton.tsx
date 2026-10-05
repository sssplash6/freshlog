import { cn } from "@/lib/cn";

/**
 * A page's shape while the real one loads.
 *
 * It has to look like the page that is coming, not like "a page": a skeleton
 * whose title sits where no title will be, and whose cards are not the cards
 * that arrive, makes the arrival a jump — and a jump is what the reader reads
 * as slow. So there are four shapes, one per kind of page this app has, drawn
 * in the grouped-list grammar every real page uses (large title, section title
 * on the ground, white card of rows):
 *
 *   home        a dashboard home: title, the stat card, a section of rows
 *   list        a roster or a log: title, a search field, one card of rows
 *   detail      a person or program: avatar + title, the stat card, two groups
 *   form        a form in a card
 *   dashboard   a stat card and a chart card
 *
 * October 2026: the blocks are STILL. They pulsed forever, against DESIGN.md's
 * "nothing loops", and a pulse says "working" in a way that makes the wait feel
 * longer than a calm outline of what is coming. Their corners are the 8px
 * minimum every real element has, not Tailwind's bare 4px; the section title no
 * longer sits 4px in from the edge, since `Section` lost that indent; and
 * "home" exists because the three home dashboards were drawing the roster
 * skeleton — a search field and a list — over a page that is a stat card and a
 * table.
 *
 * It fades in only after 150ms (`skeleton-in`, globals.css), so a navigation
 * the prefetch already paid for never flashes it.
 *
 * Two consumers: `app/loading.tsx` for the shell-less routes, and the section
 * `loading.tsx` files, which render it INSIDE AppShell's `<main>` so the chrome
 * holds still and only the page swaps. The blocks are decoration and hidden
 * from assistive tech; the status line says, once, what they say visually.
 */
export function PageSkeleton({
  variant = "list",
}: {
  variant?: "home" | "list" | "detail" | "form" | "dashboard";
}) {
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        Loading…
      </p>
      <div className="skeleton-in space-y-4" aria-hidden="true">
        {variant === "detail" ? (
          <div className="flex items-center gap-4">
            <Block className="h-16 w-16 rounded-full" />
            <div className="space-y-2">
              <Block className="h-3.5 w-32" />
              <Block className="h-8 w-64 max-w-full rounded-lg" />
            </div>
          </div>
        ) : (
          <Block className="h-8 w-52 rounded-lg" />
        )}

        {variant === "home" && (
          <>
            <StatCard />
            <Group rows={6} />
          </>
        )}

        {variant === "list" && (
          <>
            <Block className="h-11 w-full rounded-lg" />
            <Group rows={7} />
          </>
        )}

        {variant === "detail" && (
          <>
            <StatCard />
            <Group rows={3} />
            <Group rows={4} />
          </>
        )}

        {variant === "form" && (
          <div className="rounded-xl bg-surface p-5 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="space-y-2">
                  <Block className="h-3 w-20" />
                  <Block className="h-11 w-full rounded-lg" />
                </div>
              ))}
            </div>
            <Block className="mt-5 ml-auto h-11 w-36 rounded-lg" />
          </div>
        )}

        {variant === "dashboard" && (
          <>
            <div className="rounded-xl bg-surface p-5 shadow-sm">
              <Block className="h-10 w-40 rounded-lg" />
              <div className="mt-5 grid grid-cols-3 gap-4 sm:grid-cols-6">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="space-y-2">
                    <Block className="h-3 w-16" />
                    <Block className="h-6 w-12 rounded-md" />
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl bg-surface p-5 shadow-sm">
              <div className="flex h-48 items-end gap-3">
                {[30, 55, 40, 70, 45, 85, 60, 35, 50, 65, 40, 55].map((h, i) => (
                  <Block key={i} className="flex-1 rounded-md" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Block({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={cn("rounded-md bg-fill", className)} style={style} />;
}

/** `StatStrip`'s shape: one lead figure and two quieter ones in one card. */
function StatCard() {
  return (
    <div className="grid divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-sm sm:grid-cols-[1.5fr_1fr_1fr] sm:divide-x sm:divide-y-0">
      <div className="space-y-2.5 px-4 py-4 sm:px-5 sm:py-5">
        <Block className="h-3 w-20" />
        <Block className="h-10 w-44 rounded-lg" />
      </div>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-4 sm:px-5 sm:py-5">
          <Block className="h-9 w-9 shrink-0 rounded-full" />
          <div className="space-y-2">
            <Block className="h-3 w-16" />
            <Block className="h-6 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A section title on the ground and a card of rows under it. */
function Group({ rows }: { rows: number }) {
  return (
    <div className="space-y-2 pt-2">
      <Block className="h-5 w-32" />
      <div className="divide-y divide-line overflow-clip rounded-xl bg-surface shadow-sm">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <Block className="h-8 w-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Block className="h-3.5 w-2/5" />
              <Block className="h-3 w-1/4" />
            </div>
            <Block className="h-4 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
