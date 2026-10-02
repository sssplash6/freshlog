/**
 * Bug reports: the rules both sides of the form agree on.
 *
 * No `server-only` import on purpose — the report form needs the limits, the
 * same reason `lib/avatar.ts` has none. Nothing here touches the database.
 */

export const BUG_STATUS = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  FIXED: "FIXED",
  CLOSED: "CLOSED",
} as const;

export type BugStatus = (typeof BUG_STATUS)[keyof typeof BUG_STATUS];

export const BUG_STATUSES = Object.values(BUG_STATUS) as BugStatus[];

export const BUG_STATUS_LABELS: Record<BugStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  FIXED: "Fixed",
  CLOSED: "Closed",
};

/** Which `StatusChip` severity each status wears. Amber means "being worked on". */
export const BUG_STATUS_SEVERITY: Record<
  BugStatus,
  "neutral" | "ok" | "attention" | "problem"
> = {
  PENDING: "neutral",
  IN_PROGRESS: "attention",
  FIXED: "ok",
  CLOSED: "neutral",
};

export function isBugStatus(value: unknown): value is BugStatus {
  return typeof value === "string" && (BUG_STATUSES as string[]).includes(value);
}

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

export type TriageFilter = "open" | "all" | BugStatus;

/** `?status=` on the triage page. Anything unreadable opens on the work to do. */
export function readTriageFilter(raw: string): TriageFilter {
  if (raw === "all" || isBugStatus(raw)) return raw;
  return "open";
}
