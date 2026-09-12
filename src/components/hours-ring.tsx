import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";

/**
 * The student's balance as a ring that draws itself once on load: the time
 * that is gone sweeps round, the number in the middle is what is remaining. A
 * student opens this app
 * to answer one question, so that answer gets a shape rather than a row in a
 * table of five other numbers.
 *
 * Server-rendered, animated in pure CSS (see `ring-draw`), so it works with no
 * client JS and reduced-motion simply skips the sweep.
 */
export function HoursRing({
  used,
  allotted,
    forfeited = 0,
  remaining,
  size = 132,
  className,
}: {
  used: number;
  allotted: number;
  /** Minutes lost to a passed deadline. Part of the sweep; never spendable. */
  forfeited?: number;
  /**
   * What is actually left, from `allocationSummary`.
   *
   * Passed in rather than derived here, because deriving it was a bug: this
   * component used `allotted - used` and the ledger uses
   * `allotted - used - forfeited`, so any student with an expired allocation
   * read a bigger number inside the ring than in the sentence beside it.
   */
    remaining: number;
  /**
   * Diameter in pixels.
   *
   * A prop because the student's home wants 96 beside an `h1` while a detail
   * page wants the full 132, and the alternative was a caller wrapping it in a
   * `scale-[0.727]` transform to hit 96 — which works, and leaves the stroke
   * and the centre figure scaled to sizes nobody chose.
   */
  size?: number;
  className?: string;
}) {
  const stroke = Math.max(6, Math.round(size / 12));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  // Time that is gone is time that is gone, whether it was spent or forfeited:
  // the sweep shows what the student can no longer book.
  const gone = used + forfeited;
  const pct = allotted > 0 ? Math.min(1, Math.max(0, gone / allotted)) : 0;
  const overdrawn = remaining < 0;
  // A full sweep when overdrawn: the ring can't show more than all of it, and
  // the red number below carries the rest of the message.
  const sweep = overdrawn ? 1 : pct;
  const offset = circumference * (1 - sweep);

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-line"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ ["--ring-circumference" as string]: `${circumference}` }}
          className={cn(
            "ring-draw",
            overdrawn ? "stroke-danger" : "stroke-accent",
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
                    className={cn(
            "font-bold leading-none tracking-tight tabular-nums",
            overdrawn ? "text-danger-ink" : "text-ink",
          )}
          // Scaled with the ring rather than fixed, so a 96px ring does not
          // wear a 30px figure that overflows it once the duration reaches
          // "13h 10m".
          style={{ fontSize: Math.round(size * 0.2) }}
        >
          {formatDuration(overdrawn ? -remaining : remaining)}
        </div>
        <div className="mt-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted-fg">
          {overdrawn ? "over" : "remaining"}
        </div>
      </div>
      {/* The ring is decorative; the numbers it encodes are stated for readers
          who never see it. */}
      <span className="sr-only">of {formatDuration(allotted)} total.</span>
    </div>
  );
}
