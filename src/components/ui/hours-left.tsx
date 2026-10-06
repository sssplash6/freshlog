import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import { formatBalance } from "@/lib/format";

/**
 * A balance with its burn under it: the figure, and a short meter of how much
 * of the time has been used. For the key column of a table (October 2026,
 * second pass).
 *
 * A column of bare figures — "4h 48m", "11h", "28h" — said how much was left
 * and nothing about whether that was a lot. "4h 48m" of 5h and "4h 48m" of
 * 40h are different students, and only the second number made them so, two
 * columns away. The meter puts the proportion where the eye already is, and a
 * column of them is a chart of the roster that is read without reading.
 *
 * Right-aligned, like every figure: the meter's right edge is the figure's.
 */
export function HoursLeft({
  remaining,
  used,
  className,
}: {
  /** Minutes left; negative when overdrawn. */
  remaining: number;
  /** Minutes delivered against the same grants. */
  used: number;
  className?: string;
}) {
  const overdrawn = remaining < 0;
  const total = used + Math.max(remaining, 0);
  const pct = overdrawn ? 100 : total > 0 ? (used / total) * 100 : 0;

  return (
    <span className={cn("inline-flex flex-col items-end gap-1.5", className)}>
      <span
        className={cn(
          "font-semibold",
          overdrawn ? "text-danger-ink" : "text-ink",
        )}
      >
        {formatBalance(remaining)}
      </span>
      {total > 0 && (
        // The width is on a box around the meter: the meter's own `w-full`
        // wins over a `w-20` passed beside it.
        <span className="block w-20">
          <Meter
            pct={pct}
            size="sm"
            tone={overdrawn ? "danger" : "accent"}
            ariaLabel={`${Math.round(pct)}% used`}
            ariaValueNow={Math.round(pct)}
            ariaValueMax={100}
          />
        </span>
      )}
    </span>
  );
}
