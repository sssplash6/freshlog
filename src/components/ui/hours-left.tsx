import { cn } from "@/lib/cn";
import { formatBalance, formatDuration } from "@/lib/format";

/**
 * A balance with its burn under it: the figure, and a short meter of where
 * the granted time went. For the key column of a table (October 2026).
 *
 * A column of bare figures — "4h 48m", "11h", "28h" — said how much was left
 * and nothing about whether that was a lot. "4h 48m" of 5h and "4h 48m" of 40h
 * are different students, and only the second number made them so, two
 * columns away. The meter puts the proportion where the eye already is, and a
 * column of them is a chart of the roster that is read without reading.
 *
 * THREE parts, not two: orange for time that was used, RED for time that
 * expired unused, and the empty track for what is left. Expired time is not
 * used time — everywhere else in the app it is drawn in red, and a meter that
 * painted a forfeited four hours as "all used" in orange said the opposite of
 * the row's own "expired unused" note.
 *
 * Right-aligned, like every figure: the meter's right edge is the figure's.
 */
export function HoursLeft({
  remaining,
  used,
  expired = 0,
  className,
}: {
  /** Minutes left; negative when overdrawn. */
  remaining: number;
  /** Minutes delivered (or charged) against the same grants. */
  used: number;
  /** Minutes that lapsed unused on their use-by date. */
  expired?: number;
  className?: string;
}) {
  const overdrawn = remaining < 0;
  return (
    <span className={cn("inline-flex flex-col items-end gap-1.5", className)}>
      <span className={cn("font-semibold", overdrawn ? "text-danger-ink" : "text-ink")}>
        {formatBalance(remaining)}
      </span>
      <HoursBar remaining={remaining} used={used} expired={expired} className="w-20" />
    </span>
  );
}

/**
 * The bare meter: used (orange), expired unused (red), what is left (the
 * track). Nothing renders when there was nothing to measure. `HoursLeft` puts
 * the balance over it; the Programs list puts it beside a percentage.
 */
export function HoursBar({
  remaining,
  used,
  expired = 0,
  className,
}: {
  remaining: number;
  used: number;
  expired?: number;
  className?: string;
}) {
  const overdrawn = remaining < 0;
  const spent = Math.max(used, 0);
  const lapsed = Math.max(expired, 0);
  const total = spent + lapsed + Math.max(remaining, 0);
  if (total <= 0) return null;
  const usedPct = overdrawn ? 100 : (spent / total) * 100;
  const lapsedPct = overdrawn ? 0 : (lapsed / total) * 100;
  const label = overdrawn
    ? "Overdrawn"
    : `${Math.round(usedPct)}% used${lapsed > 0 ? `, ${formatDuration(lapsed)} expired unused` : ""}`;

  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(overdrawn ? 100 : usedPct + lapsedPct)}
      className={cn("flex h-1 overflow-hidden rounded-full bg-line-strong", className)}
    >
      <span
        className={cn("bar-grow h-full", overdrawn ? "bg-danger" : "bg-accent")}
        style={{ width: `${usedPct}%` }}
      />
      {lapsedPct > 0 && (
        <span className="bar-grow h-full bg-danger" style={{ width: `${lapsedPct}%` }} />
      )}
    </span>
  );
}
