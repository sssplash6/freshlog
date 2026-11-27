// The contract between Freshlog and FreshWeek's payroll, version 1.
//
// FreshWeek (github.com/sssplash6/Weak-Lee) pays mentors for the hours they log
// here. It asks this app, server to server, for a mentor's payable sessions
// when the mentor files a pay request, freezes a copy on the request, and asks
// again before the request is paid. Freshlog owns hours and rates; FreshWeek
// owns what has been billed and paid. Nothing here records payment.
//
// THIS FILE IS COPIED BYTE FOR BYTE into FreshWeek at src/lib/freshlog/contract.ts,
// with hours.sample.json beside it. Both repos test against the sample: this
// one proves it produces it, FreshWeek proves it reads it. Change one copy and
// you must change the other in the same breath.
//
// Auth: `Authorization: Bearer <secret>`, the secret being PAYROLL_API_SECRET
// here and FRESHLOG_API_SECRET there. Unset here → every call answers 503.
//
//   GET /api/payroll/v1/hours?email=<email>    one mentor (HoursResponse)
//   GET /api/payroll/v1/mentors                every mentor with a rate (MentorsResponse)
//
// Dates are calendar days, "YYYY-MM-DD" — the day a session was held, exactly
// as Freshlog stores it (Session.date, UTC midnight of the typed day).

export const PAYROLL_API_VERSION = 1;

/** One rate row. Rates are only ever added; the one in force on a day is the
 * row with the latest `effectiveFrom` on or before it (ties: the newest row,
 * which is how a typo is corrected). Already resolved for each session below,
 * so FreshWeek never applies this rule itself. */
export type PayRate = {
  effectiveFrom: string; // YYYY-MM-DD
  centsPerHour: number; // integer, ≥ 0, USD
};

/**
 * One payable session. Payable = status ACTIVE (no-shows and extra/out-of-plan
 * time included), dated on or after the mentor's FIRST rate's effectiveFrom.
 * Voided, rescheduled and deleted sessions are simply absent: FreshWeek reads
 * "absent" as "0 payable minutes now", which is how a correction after
 * payment becomes a negative line on the next request.
 */
export type PayableSession = {
  id: string; // Freshlog Session.id — stable, FreshWeek keys billing on it
  date: string; // YYYY-MM-DD, the day it was held
  loggedAt: string; // ISO instant it was first logged (Session.createdAt)
  minutes: number; // integer > 0
  centsPerHour: number; // the rate in force on `date`
  student: string; // the student's name, or their email when they have none
  program: string; // the program's name
  noShow: boolean; // the student did not attend (still paid)
  extra: boolean; // out-of-plan time (still paid)
  disputed: boolean; // the student disputed it (still paid; FreshWeek flags it)
};

export type HoursMentor = {
  email: string; // lowercase
  name: string | null;
  rates: PayRate[]; // ascending by effectiveFrom; empty = not paid by the hour
  sessions: PayableSession[]; // ascending by date, then id; empty when rates is
};

export type HoursResponse = {
  version: 1;
  generatedAt: string; // ISO instant
  /** null = no Freshlog account with this email (case-insensitive). */
  mentor: HoursMentor | null;
};

export type MentorSummary = {
  email: string; // lowercase
  name: string | null;
  centsPerHour: number; // the rate in force today
  paidFrom: string; // YYYY-MM-DD, the first rate's effectiveFrom
  payableMinutes: number; // all payable minutes since paidFrom
};

export type MentorsResponse = {
  version: 1;
  generatedAt: string;
  mentors: MentorSummary[]; // every mentor with at least one rate, by email
};
