/**
 * Bug reports: the rules both sides of the form agree on.
 *
 * No `server-only` import on purpose — the report form needs the limits, the
 * same reason `lib/avatar.ts` has none. Nothing here touches the database.
 */

/**
 * The stored values predate feature requests, so they keep their old names and
 * only the labels moved: FIXED reads "Done" because a feature is not fixed, and
 * CLOSED reads "Won't do". Renaming the values would have meant rewriting every
 * report already filed for no change anybody could see.
 */
export const BUG_STATUS = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  IN_REVIEW: "IN_REVIEW",
  FIXED: "FIXED",
  CLOSED: "CLOSED",
} as const;

export type BugStatus = (typeof BUG_STATUS)[keyof typeof BUG_STATUS];

export const BUG_STATUSES = Object.values(BUG_STATUS) as BugStatus[];

export const BUG_STATUS_LABELS: Record<BugStatus, string> = {
  PENDING: "New",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  FIXED: "Done",
  CLOSED: "Won't do",
};

/** Which `StatusChip` severity each status wears. Amber means "being worked on". */
export const BUG_STATUS_SEVERITY: Record<
  BugStatus,
  "neutral" | "ok" | "attention" | "problem"
> = {
  PENDING: "neutral",
  IN_PROGRESS: "attention",
  IN_REVIEW: "attention",
  FIXED: "ok",
  CLOSED: "neutral",
};

/** Still on somebody's plate: the board's columns, in order. */
export const OPEN_BUG_STATUSES: BugStatus[] = [
  BUG_STATUS.PENDING,
  BUG_STATUS.IN_PROGRESS,
  BUG_STATUS.IN_REVIEW,
];

export function isBugStatus(value: unknown): value is BugStatus {
  return typeof value === "string" && (BUG_STATUSES as string[]).includes(value);
}

/** Fixed and Closed both need words, because both end up in front of somebody. */
export function isClosingStatus(status: BugStatus): boolean {
  return status === BUG_STATUS.FIXED || status === BUG_STATUS.CLOSED;
}

export const BUG_KIND = {
  BUG: "BUG",
  FEATURE: "FEATURE",
} as const;

export type BugKind = (typeof BUG_KIND)[keyof typeof BUG_KIND];

export const BUG_KINDS = Object.values(BUG_KIND) as BugKind[];

export const BUG_KIND_LABELS: Record<BugKind, string> = {
  BUG: "Bug",
  FEATURE: "Feature request",
};

export function isBugKind(value: unknown): value is BugKind {
  return typeof value === "string" && (BUG_KINDS as string[]).includes(value);
}

export const BUG_SOURCE = {
  APP: "APP",
  TELEGRAM: "TELEGRAM",
} as const;

export const BUG_TITLE_MAX = 120;
export const BUG_DESCRIPTION_MAX = 2000;
/** The public fix line when Fixed; the private note to the reporter when Closed. */
export const BUG_RESOLUTION_MAX = 300;
export const BUG_PAGE_MAX = 300;

/** Server-side ceiling on stored screenshot bytes, after the browser's resize. */
export const BUG_SHOT_MAX_BYTES = 600 * 1024;
/** Longest edge the browser scales a screenshot to. */
export const BUG_SHOT_MAX_EDGE = 1600;
export const BUG_SHOT_MIME_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
/** What the file picker offers, including formats the browser re-encodes away. */
export const BUG_SHOT_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";

/** Per person, per rolling hour. Counted in the database, never in the browser. */
export const BUG_REPORTS_PER_HOUR = 5;

/**
 * The page somebody was on, as a path — or null.
 *
 * It arrives in a query string, so it is whatever anybody typed. Only our own
 * paths survive: one leading slash, no `//` (a scheme-relative URL), no
 * backslash (browsers read `/\host` as `//host`), no control characters. The
 * query string and fragment are cut: they can carry tokens and ids, and the
 * path is what a developer needs.
 */
export function sanitizePagePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim().split(/[?#]/)[0];
  if (!path.startsWith("/") || path.length > BUG_PAGE_MAX) return null;
  if (path.includes("//") || path.includes("\\")) return null;
  if (/\p{Cc}/u.test(path)) return null;
  return path;
}

/**
 * What the triage form's "Fix line" / "Note" box opens with.
 *
 * `resolution` means two different things — the public fix line when FIXED, a
 * note private to the reporter when CLOSED — so a stored line is only offered
 * back to the status it was written for. Without this, an admin switching a
 * Closed report to Fixed would see the private note sitting in the box labelled
 * "Everybody reads this", and saving without a word would publish it. A report
 * that was reopened has no current kind, so it starts empty.
 */
export function resolutionPrefill(
  target: BugStatus,
  current: BugStatus,
  resolution: string | null
): string {
  return isClosingStatus(target) && target === current ? (resolution ?? "") : "";
}

export type TriageFilter = "all" | BugKind;

/** `?kind=` on the board. Anything unreadable shows both kinds. */
export function readTriageFilter(raw: string): TriageFilter {
  return isBugKind(raw) ? raw : "all";
}
