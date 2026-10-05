import { cn } from "@/lib/cn";

/**
 * A thin progress meter whose fill grows in from zero once, on mount. Orange
 * is hours/progress; red marks an overdrawn balance. The grow is a one-time
 * explanatory beat that draws the eye to the proportion, not a celebration.
 * Reduced-motion collapses it to an instant set (globals kills the duration).
 *
 * October 2026: the grow is `bar-grow` — a transform from the fill's own left
 * edge — instead of a 700ms transition on `width`, which re-laid-out the row on
 * every frame and needed a client component and a mount effect to start. The
 * fill is now drawn at its real width from the server's first byte. The track
 * is `line-strong`: on `fill` it was 1.15:1 against the card, so an empty meter
 * was barely there and a short fill had no visible end to measure against.
 */
const SIZE = { sm: "h-1", md: "h-1.5" } as const;

export function Meter({
  pct,
  tone = "accent",
  size = "md",
  className,
  ariaLabel,
  ariaValueNow,
  ariaValueMax,
}: {
  pct: number;
  tone?: "accent" | "danger";
  size?: keyof typeof SIZE;
  className?: string;
  ariaLabel?: string;
  ariaValueNow?: number;
  ariaValueMax?: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));

  return (
    <div
      className={cn(
        SIZE[size],
        "w-full overflow-hidden rounded-full bg-line-strong",
        className,
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={ariaValueMax}
      aria-valuenow={ariaValueNow}
      aria-label={ariaLabel}
    >
      <div
        className={cn(
          "bar-grow h-full rounded-full",
          tone === "danger" ? "bg-danger" : "bg-accent",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
