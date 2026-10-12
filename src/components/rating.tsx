import { StarIcon } from "@/components/icons";

/**
 * Read-only star rating out of 5, in the picker's own star — filled in ink,
 * empty in the picker's muted grey. Orange is hours, never a rating.
 * Sized in `em`, so it follows the line it sits in.
 */
export function Rating({ value }: { value: number }) {
  return (
    <span
      role="img"
      className="inline-flex shrink-0 items-center gap-px leading-none"
      aria-label={`${value} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon
          key={n}
          className={n <= value ? "h-[1em] w-[1em] text-ink" : "h-[1em] w-[1em] text-muted-fg/70"}
        />
      ))}
    </span>
  );
}

/** Average helper for feedback lists. */
export function average(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
}
