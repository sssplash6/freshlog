/**
 * The rules of students practising interviews on each other, as pure functions
 * so they can be tested without a database. The actions in
 * lib/actions/interviews.ts and the pages under /student/interviews both ask
 * these, so a time the page offers is a time the action accepts.
 *
 * TIMES are the program's wall clock in a UTC field (see lib/when.ts): a
 * student types "15:00" meaning 15:00 Tashkent, it is stored as 15:00Z, and
 * `now` has to be moved onto the same clock before the two are compared.
 */
import { studiesIn } from "@/lib/enrollments";
import { formatDate } from "@/lib/format";
import type { InterviewTemplate } from "@/lib/interview-templates";
import type { StatusType } from "@/lib/status";
import { formatTimeOfDay, programWallClock } from "@/lib/when";

/** The lengths a student may offer. A practice round, not an afternoon. */
export const SLOT_LENGTHS = [30, 45, 60] as const;

/** How far ahead a time may be offered. Past this nobody is planning yet. */
export const MAX_DAYS_AHEAD = 60;

/** Longer than any honest set of notes, short enough to stay a note. */
export const NOTES_MAX = 5000;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

type Timed = { startsAt: Date; minutes: number };

/**
 * Read the date and time fields of the "offer a time" form into a wall-clock
 * start, refusing a time that has passed or is too far off.
 */
export function parseSlotStart(
  rawDate: FormDataEntryValue | null,
  rawTime: FormDataEntryValue | null,
  now: Date
): { value: Date } | { error: string } {
  const date = String(rawDate ?? "").trim();
  const time = String(rawTime ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick a date." };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: "Pick a start time." };

  const startsAt = new Date(`${date}T${time}:00.000Z`);
  if (Number.isNaN(startsAt.getTime())) return { error: "Pick a valid date." };

  const wallNow = programWallClock(now).getTime();
  if (startsAt.getTime() <= wallNow) {
    return { error: "That time has already passed. Pick a later one." };
  }
  if (startsAt.getTime() > wallNow + MAX_DAYS_AHEAD * DAY) {
    return { error: `Offer times within the next ${MAX_DAYS_AHEAD} days.` };
  }
  return { value: startsAt };
}

/** Read the length field; only the lengths the form offers are accepted. */
export function parseSlotLength(raw: FormDataEntryValue | null): number | null {
  const n = Number(String(raw ?? ""));
  return (SLOT_LENGTHS as readonly number[]).includes(n) ? n : null;
}

/** Two times that share any minute. Back to back is not an overlap. */
export function overlaps(a: Timed, b: Timed): boolean {
  const aEnd = a.startsAt.getTime() + a.minutes * MINUTE;
  const bEnd = b.startsAt.getTime() + b.minutes * MINUTE;
  return a.startsAt.getTime() < bEnd && b.startsAt.getTime() < aEnd;
}

/** Whether a time has begun, on the program's clock. */
export function hasStarted(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() <= programWallClock(now).getTime();
}

/** "Sep 30, 15:00 Tashkent" — the zone is named, as lib/when.ts asks. */
export function formatSlotWhen(startsAt: Date): string {
  return `${formatDate(startsAt)}, ${formatTimeOfDay(startsAt, true)}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Tue, Sep 30" — the heading over a day's times. */
export function formatSlotDay(startsAt: Date): string {
  return `${WEEKDAYS[startsAt.getUTCDay()]}, ${formatDate(startsAt)}`;
}

/** "15:00–15:45", for a row whose day is already its heading. */
export function formatSlotSpan({ startsAt, minutes }: Timed): string {
  const end = new Date(startsAt.getTime() + minutes * MINUTE);
  const hhmm = (d: Date) =>
    `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return `${hhmm(startsAt)}–${hhmm(end)}`;
}

/**
 * Whether two students may see each other's times and book them: they share
 * at least one of their OWN programs.
 *
 * Own, not visiting: a student lent to another program for seven hours of
 * help is there for the help, and is not a classmate of that program's
 * students (AGENTS.md, "A visit is not an enrollment").
 */
export function areClassmates(
  a: readonly { programId: string; exchangeId?: string | null }[],
  b: readonly { programId: string; exchangeId?: string | null }[]
): boolean {
  const mine = new Set(studiesIn(a).map((e) => e.programId));
  return studiesIn(b).some((e) => mine.has(e.programId));
}

/** Which side of an interview a student is on, or null if neither. */
export function sideOf(
  interview: { hostId: string; guestId: string },
  studentId: string
): "host" | "guest" | null {
  if (interview.hostId === studentId) return "host";
  if (interview.guestId === studentId) return "guest";
  return null;
}

export type InterviewPhase = "booked" | "to-mark" | "completed";

/** Where an interview stands, for the chip and for which controls it offers. */
export function interviewPhase(
  interview: { completedAt: Date | null; slot: Timed },
  now: Date
): InterviewPhase {
  if (interview.completedAt) return "completed";
  return hasStarted(interview.slot.startsAt, now) ? "to-mark" : "booked";
}

/** The state each phase is shown as, from lib/status.ts. */
export const PHASE_STATUS: Record<InterviewPhase, StatusType> = {
  booked: "INTERVIEW_BOOKED",
  "to-mark": "INTERVIEW_TO_MARK",
  completed: "INTERVIEW_COMPLETED",
};

/** Long enough for any meeting link with its query string. */
export const MEETING_URL_MAX = 500;

/**
 * The optional "where we meet" link on an offered time. https only: the link
 * is rendered as an href another student clicks, so `javascript:` and plain
 * http are refused here, not trusted to the browser.
 */
export function parseMeetingUrl(
  raw: FormDataEntryValue | null
): { value: string | null } | { error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { value: null };
  const invalid = { error: "Paste a meeting link that starts with https://." };
  if (text.length > MEETING_URL_MAX) return invalid;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return invalid;
  }
  return url.protocol === "https:" ? { value: text } : invalid;
}

/** The question at `index` in a template, or null if it has no such question. */
export function questionAt(template: InterviewTemplate | null, index: number): string | null {
  if (!template || !Number.isInteger(index)) return null;
  return template.questions[index] ?? null;
}

/**
 * Feedback is its author's until they submit it; after that, the partner it is
 * about reads it too. A half-written judgement is never shown.
 */
export function feedbackVisibleTo(
  feedback: { fromId: string; submittedAt: Date | null },
  studentId: string
): boolean {
  return feedback.fromId === studentId || feedback.submittedAt !== null;
}

/**
 * Whether this student may still use the guide: from the start time until
 * they submit their own feedback. NOT until the interview is completed — the
 * partner who submits first completes it, and must not lock the other out.
 */
export function guideOpen(
  slot: { startsAt: Date },
  mySubmittedAt: Date | null,
  now: Date
): boolean {
  return mySubmittedAt === null && hasStarted(slot.startsAt, now);
}
