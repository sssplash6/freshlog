import { formatFullDate, formatMinutes } from "@/lib/format";

/**
 * What a correction changed, in words, for the notice that tells people.
 *
 * It used to say "now 30 min on September 24 (was 30 min on October 24)" for
 * every correction, whatever had been corrected: the minutes that had not moved
 * were stated twice, the year was left off two dates a reader has to compare,
 * and a fix to the date alone read as if the length had changed too. Said as
 * what moved — and only that — the same fix reads "moved to September 24, 2026
 * (was October 24, 2026)", with the years, since the notice outlives the day it
 * was written.
 *
 * When neither figure moved (the note, the attendance or the task was
 * corrected) it states where the session now stands, so the sentence still
 * says which session it is.
 */
export function describeSessionChange(
  before: { minutes: number; date: Date },
  after: { minutes: number; date: Date }
): string {
  const parts: string[] = [];
  if (before.minutes !== after.minutes) {
    parts.push(
      `now ${formatMinutes(after.minutes)} (was ${formatMinutes(before.minutes)})`
    );
  }
  if (before.date.getTime() !== after.date.getTime()) {
    parts.push(
      `moved to ${formatFullDate(after.date)} (was ${formatFullDate(before.date)})`
    );
  }
  return parts.length > 0
    ? parts.join(", ")
    : `${formatMinutes(after.minutes)} on ${formatFullDate(after.date)}`;
}
