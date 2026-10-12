import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * Where a student's time actually went, as one bar and its key.
 *
 * THE TRACK IS THE TOTAL, and every part of it is named: delivered, charged
 * for a meeting nobody turned up to, expired unused, and what remains. Beyond
 * the total, when it happens, sits what was overdrawn.
 *
 * Expired came back in October 2026. It had been dropped as "a fact about ONE
 * grant", but dropping it from the key did not drop it from the track: its
 * share stayed the same unfilled grey as time still to use, and a reader took
 * expired hours for available ones. Expired and overdrawn are both red but
 * never sit side by side in one bar — expiry is inside the track, an
 * overdraw past its end — so the old confusion between them cannot recur.
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
  expired = 0,
  remaining,
  showTotal = true,
  className,
}: {
  allotted: number;
  completed: number;
  missed: number;
  /**
   * Minutes a passed deadline took (`forfeited` in `hours.ts`).
   *
   * Drawn, in red, after the charged slices (October 2026). Leaving it out
   * of the bar did not leave it out of the TRACK: the expired part was the
   * same unfilled grey as time still to use, so a mentor read four expired
   * hours as four hours the student could still book.
   */
  expired?: number;
  /**
   * Negative when the student has been charged past what they hold. When it
   * is positive it gets its own entry in the key, so the unfilled tail of the
   * bar says what it is.
   */
  remaining: number;
  /** Off where the page's title already carries the balance. */
  showTotal?: boolean;
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
      // Ink, not orange. The swatch carries the colour; a figure in the key
      // is read, and orange text beside ink text made the key two voices.
      ink: "text-ink",
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
    {
      key: "expired",
      label: "Expired unused",
      minutes: expired,
      fill: "bg-danger",
      ink: "text-danger-ink",
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
      <div className="flex h-2 w-full items-stretch gap-1">
        <div
          className="flex overflow-hidden rounded-full bg-fill"
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
      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2.5">
        {shown.map((s) => (
          <div key={s.key}>
            <dt className="flex items-center gap-1.5 text-xs text-muted-fg">
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
            <dd className={cn("mt-0.5 text-title font-semibold tabular-nums", s.ink)}>
              {formatDuration(s.minutes)}
            </dd>
          </div>
        ))}
        {remaining > 0 && (
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-muted-fg">
              {/* Hollow: the unfilled tail of the track, drawn as what it is. */}
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-fill ring-1 ring-inset ring-line-strong"
              />
              Remaining
            </dt>
            <dd className="mt-0.5 text-title font-semibold tabular-nums text-ink">
              {formatDuration(remaining)}
            </dd>
          </div>
        )}
        {over > 0 && (
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-muted-fg">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-danger" />
              Overdrawn
            </dt>
            <dd className="mt-0.5 text-title font-semibold tabular-nums text-danger-ink">
              {formatDuration(over)}
            </dd>
          </div>
        )}
        {showTotal && (
          <div>
            <dt className="text-xs text-muted-fg">Total</dt>
            <dd className="mt-0.5 text-title font-semibold tabular-nums text-ink">
              {formatDuration(allotted)}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
