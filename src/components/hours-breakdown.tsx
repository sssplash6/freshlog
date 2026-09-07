import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * Where a student's time actually went, as one bar and its key.
 *
 * The ring answers "how much is remaining?"; this answers the question
 * underneath it, which the numbers alone made people do arithmetic for: a
 * total splits into completed, hours charged for meetings missed, hours lost
 * to a deadline, and hours still there. Reading those four out of a strip of
 * stat cards meant holding four figures at once and subtracting; as segments
 * of one bar the proportions are the answer.
 *
 * Extra hours sit OUTSIDE the bar on purpose. They were completed but charged
 * to nobody, so putting them inside a total they were never part of would make
 * the bar lie about what was bought.
 */

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
   * dot for completed, a striped square for charged-but-missed, a hollow ring
   * for what is still the student's.
   */
  swatch?: "striped" | "ring";
};

export function HoursBreakdown({
  allotted,
  completed,
  missed,
  forfeited,
    remaining,
  extra = 0,
  statesRemaining = true,
  className,
}: {
  allotted: number;
  completed: number;
  missed: number;
  forfeited: number;
  remaining: number;
  extra?: number;
  /**
   * Whether the key names what is still left.
   *
   * False on the student's home, where the ring beside the `h1` already is
   * that number and §6.3's rule is that remaining is never stated twice. The
   * SEGMENT stays either way: dropping the bar's tail would leave a bar that
   * cannot show an overdraw, and a chart that hides the worst case is worse
   * than a repeated figure.
   */
  statesRemaining?: boolean;
  className?: string;
}) {
  const overdrawn = remaining < 0;
  // Charged time is charged time: completed and missed are the SAME hue, told
  // apart by a stripe rather than by a second warm colour nine degrees away.
  const stripedAccent = {
    backgroundImage:
      "repeating-linear-gradient(135deg, var(--color-accent) 0 4px, color-mix(in srgb, var(--color-accent) 40%, white) 4px 8px)",
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
    {
      key: "forfeited",
      label: "Expired unused",
      minutes: forfeited,
      fill: "bg-danger",
      ink: "text-danger-ink",
    },
    {
      key: "remaining",
      label: overdrawn ? "Overdrawn" : "Remaining",
      minutes: overdrawn ? -remaining : remaining,
      fill: overdrawn ? "bg-danger" : "bg-line",
      ink: overdrawn ? "text-danger-ink" : "text-ink",
      swatch: overdrawn ? undefined : "ring",
    },
  ];

  // The bar is drawn over whichever is larger — the total, or what has
  // actually been drawn against it. Without that an overdrawn student's bar
  // would be a full accent block with the overdraw invisible past its end.
  const drawn = completed + missed + forfeited;
  const span = Math.max(allotted, drawn + (overdrawn ? -remaining : 0), 0.01);

    const shown = segments.filter((s) => s.minutes > 0.001);
  // An overdraw is always named, whatever the caller said: it is not the
  // reassuring half of "remaining", and a page that suppressed it would be
  // hiding the one figure a student most needs to see.
  const keyed = shown.filter(
    (s) => s.key !== "remaining" || statesRemaining || overdrawn
  );

  return (
    <div className={className}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line">
        {shown.map((s) => (
          <div
            key={s.key}
            className={cn("h-full", s.fill)}
            style={{ width: `${(s.minutes / span) * 100}%`, ...s.style }}
          />
        ))}
      </div>

      {/* The key is also the readout: a swatch is only useful next to the
          figure it stands for. */}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2.5">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-fg">
            Total
          </dt>
          <dd className="mt-0.5 text-[15px] font-bold tabular-nums text-ink">
            {formatDuration(allotted)}
          </dd>
        </div>
                {keyed.map((s) => (
          <div key={s.key}>
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-fg">
              <span
                aria-hidden="true"
                style={s.style}
                className={cn(
                  "h-2 w-2 shrink-0",
                  s.swatch === "striped"
                    ? "rounded-[2px]"
                    : s.swatch === "ring"
                      ? "rounded-full border border-muted-fg/50"
                      : cn("rounded-full", s.fill)
                )}
              />
              {s.label}
            </dt>
            <dd
              className={cn(
                "mt-0.5 text-[15px] font-bold tabular-nums",
                s.ink,
              )}
            >
              {formatDuration(s.minutes)}
            </dd>
          </div>
        ))}
        {extra > 0 && (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-fg">
              Extra, beyond plan
            </dt>
            <dd className="mt-0.5 text-[15px] font-bold tabular-nums text-ink">
              {formatDuration(extra)}
            </dd>
          </div>
        )}
      </dl>

      {extra > 0 && (
        <p className="mt-2.5 text-xs text-muted-fg">
          {formatDuration(extra)} was given on top of the total and drew none
          of it down, so it sits outside the bar.
        </p>
      )}
    </div>
  );
}
