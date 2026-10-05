/** Read-only star rating: filled stars in ink out of 5 — orange is hours. */
export function Rating({ value }: { value: number }) {
  return (
    <span
      className="whitespace-nowrap text-body leading-none tabular-nums text-ink"
      aria-label={`${value} out of 5 stars`}
    >
      {"★".repeat(value)}
      <span className="text-muted-fg/40">{"★".repeat(5 - value)}</span>
    </span>
  );
}

/** Average helper for feedback lists. */
export function average(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
}
