/** Client-safe formatting helpers. */

/**
 * One duration, in the unit the team speaks: 90 → "90 min".
 *
 * For a single meeting or one task's budget, the raw minute count is the most
 * useful thing on the page — it is what the mentor typed in, it sorts and
 * compares at a glance, and there is no arithmetic between what is stored and
 * what is read. Roll-up totals get `formatDuration` instead, where a
 * four-figure minute count stops meaning anything.
 */
export function formatMinutes(n: number): string {
  return `${Math.round(n)} min`;
}

/**
 * A roll-up total, where minutes alone stop being readable: 45 → "45 min",
 * 60 → "1h", 1100 → "18h 20m".
 *
 * Nobody reads "1100 minutes remaining" as an amount of time, so anything past
 * an hour splits — but under an hour it stays in the same words as everything
 * else on the page rather than becoming "0h 45m".
 */
export function formatDuration(n: number): string {
  const total = Math.round(n);
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  if (abs < 60) return `${sign}${abs} min`;
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return minutes === 0 ? `${sign}${hours}h` : `${sign}${hours}h ${minutes}m`;
}

/**
 * A total to get your bearings by: 7,807 → "130+ hours".
 *
 * The owner's words: "very много цифр and I got a bit lost in them" — a page
 * of four-part durations is a page nobody reads. So a figure a reader ORIENTS
 * by is rounded and takes a "+", while a figure that IS the record — one
 * allocation, one logged session, a balance a mentor is about to spend
 * against, anything beside money — stays exact through `formatDuration`.
 * `PRODUCT.md` promises these numbers are trusted; that promise lives on the
 * exact side of the line, and this side exists so the exact side is legible
 * when you get to it.
 *
 * It always rounds DOWN, because that is what the "+" claims. Rounding 130h 07m
 * up to "135+ hours" would say the program has time it does not have, and a
 * figure that overstates is worse than a figure that is long.
 *
 * Under an hour there is nothing to round — "45 min" is already the shortest
 * true thing — and under ten hours the hour is precise enough on its own, so
 * the five-hour step only starts where the digits actually stop meaning
 * anything.
 */
export function formatRough(n: number): string {
  const total = Math.round(n);
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);

  if (abs < 60) return `${sign}${abs} min`;

  const hours = abs / 60;
  if (abs < 600) {
    const whole = Math.floor(hours);
    // "3 hours" when it is exactly three; "3+ hours" when there is more.
    return `${sign}${whole}${abs % 60 === 0 ? "" : "+"} ${whole === 1 && abs % 60 === 0 ? "hour" : "hours"}`;
  }

  const step = Math.floor(hours / 5) * 5;
  const exact = step * 60 === abs;
  return `${sign}${step.toLocaleString("en-US")}${exact ? "" : "+"} hours`;
}

/** Money in US dollars: 1200 → "$1,200", 1200.5 → "$1,200.50". */
export function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

// Spelled out in full, everywhere: a date should never need working out, and
// "8/3" means two different days on two sides of the world.
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Calendar dates (stored at UTC midnight) read the way the team says them out
 * loud: "August 3", "October 7". The year is only spelled out when it isn't the
 * current one, so a log spanning new year stays unambiguous without repeating
 * "2026" down every row.
 */
export function formatDate(d: Date): string {
  const short = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const year = d.getUTCFullYear();
  return year === new Date().getUTCFullYear() ? short : `${short}, ${year}`;
}

/**
 * The machine form, for `<input type="date">` values only — that control only
 * accepts YYYY-MM-DD, so it can never take formatDate's human output.
 */
export function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * How long ago, for a feed where "2h ago" beats a timestamp you have to
 * subtract in your head. Falls back to the calendar date past a week, since
 * "23 days ago" is harder to place than "Jul 7".
 */
export function formatAgo(d: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return formatDate(d);
}

/** Timestamps (notifications, audit entries): "8 July 2026, 14:32 UTC". */
export function formatDateTime(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}



