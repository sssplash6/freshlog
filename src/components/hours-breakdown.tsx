import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * Where a student's time actually went, as one bar and its key.
 *
 * FOUR VALUES, AND THERE IS NO FIFTH: the total that was granted, the part of
 * it that was delivered, the part charged for meetings nobody turned up to, and
 * — when it happens — what was drawn BEYOND the total. It carried six, and the
 * two that went were the two nobody could place: "Expired unused" and
 * "Overdrawn" were both red, sat beside each other, and are different enough
 * that a reader had to stop and work out which was which. An expiry is a fact
 * about ONE grant and its deadline, so it belongs on that grant's row and in
 * the bell, not in a sum over every grant a student holds.
 *
 * THE TRACK IS THE TOTAL. Completed and missed fill it; whatever is left of it
 * is simply unfilled, and the bar makes no claim about that remainder — the
 * ring beside the student's own name is the figure for what is still theirs.
 *
 * AN OVERDRAW IS DRAWN PAST THE TRACK, after a gap, as a block of its own. It
 * is not a slice of the total — it is the amount by which the total was
 * exceeded — so drawing it inside would be the bar contradicting its own
 * arithmetic. The gap is what says "past the end"; the red is what says this
 * one is not like the others.
 */

/** One filled slice of the track. */
type Segment = {
  key: string;
  label: string;
  minutes: number;
  /** Bar fill, as a class. Empty when the fill is an inline `style`. */
  fill: string;
  /** For the striped fill, which a Tailwind class cannot express. */
  style?: React.CSSProperties;
  /** The figure's colour in the key. */
  ink: string;
  /**
   * The key's swatch SHAPE, so the legend survives without colour: a filled
   * dot for completed, a striped square for charged-but-missed.
   */
  swatch?: "striped";
};

export function HoursBreakdown({
  allotted,
  completed,
  missed,
  remaining,
  className,
}: {
  allotted: number;
  completed: number;
  missed: number;
  /** Negative when the student has been charged past what they hold. */
  remaining: number;
  className?: string;
}) {
  const over = remaining < 0 ? -remaining : 0;

  // Charged time is charged time: completed and missed are the SAME hue, told
  // apart by a stripe rather than by a second warm colour nine degrees away.
  const stripedAccent = {
    backgroundImage:
      // Mixed toward the SURFACE, not toward white: on a dark card the light
      // half of the stripe has to be the card's own ground, or the bar keeps a
      // pale band that belongs to a theme it is no longer in.
      "repeating-linear-gradient(135deg, var(--color-accent) 0 4px, color-mix(in srgb, var(--color-accent) 40%, var(--color-surface)) 4px 8px)",
  };

  const segments: Segment[] = [
    {
      key: "completed",
      label: "Completed",
      minutes: completed,
      fill: "bg-accent",
      ink: "text-accent-ink",
    },
    {
      key: "missed",
      label: "Missed, charged",
      minutes: missed,
      fill: "",
      style: stripedAccent,
      ink: "text-ink",
      swatch: "striped",
    },
  ];
  const shown = segments.filter((s) => s.minutes > 0.001);

  // The track holds the total; the overdraw sits beside it. One denominator for
  // both, or the two blocks do not add up to the width of the bar.
  const track = Math.max(allotted, 0.01);
  const span = track + over;
  // Each slice takes what is left of the track, in order. Charged time cannot
  // fill more of the total than the total holds — the excess IS the block past
  // the end — so a segment is clipped rather than allowed to run over.
  let filled = 0;
  const widths = shown.map((s) => {
    const w = Math.max(0, Math.min(s.minutes, track - filled));
    filled += w;
    return (w / track) * 100;
  });

  return (
    <div className={className}>
      <div className="flex h-2.5 w-full items-stretch gap-1">
        <div
          className="flex overflow-hidden rounded-full bg-line"
          style={{ width: `${(track / span) * 100}%` }}
        >
          {shown.map((s, i) => (
            <div
              key={s.key}
              className={cn("h-full", s.fill)}
              style={{ width: `${widths[i]}%`, ...s.style }}
            />
          ))}
        </div>
        {over > 0 && (
          <div
            className="rounded-full bg-danger"
            style={{ width: `${(over / span) * 100}%` }}
          />
        )}
      </div>

      {/* The key is also the readout: a swatch is only useful next to the
          figure it stands for. */}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2.5">
        <div>
          <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-muted-fg">
            Total
          </dt>
          <dd className="mt-0.5 text-[0.9375rem] font-bold tabular-nums text-ink">
            {formatDuration(allotted)}
          </dd>
        </div>
        {shown.map((s) => (
          <div key={s.key}>
            <dt className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-muted-fg">
              <span
                aria-hidden="true"
                style={s.style}
                className={cn(
                  "h-2 w-2 shrink-0",
                  s.swatch === "striped"
                    ? "rounded-[0.125rem]"
                    : cn("rounded-full", s.fill)
                )}
              />
              {s.label}
            </dt>
            <dd className={cn("mt-0.5 text-[0.9375rem] font-bold tabular-nums", s.ink)}>
              {formatDuration(s.minutes)}
            </dd>
          </div>
        ))}
        {over > 0 && (
          <div>
            <dt className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-muted-fg">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-danger" />
              Overdrawn
            </dt>
            <dd className="mt-0.5 text-[0.9375rem] font-bold tabular-nums text-danger-ink">
              {formatDuration(over)}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
