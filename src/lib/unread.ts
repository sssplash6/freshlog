import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
} from "@/lib/constants";

/**
 * What the bell's number is made of.
 *
 * "157 unread" was one figure for a feed where 142 of them are session logs
 * somebody can read next week and three are deadlines closing this one. A bare
 * total teaches a reader the badge is always loud, which is how the three get
 * missed. So the total stays — it is what the badge draws — and the panel and
 * the accessible name say what it is made of, the time-boxed kind first.
 */
export type UnreadSummary = {
  total: number;
  /** Unread notices that a clock is running on — deadlines. */
  urgent: number;
  /** Per category with something unread: urgent first, then largest first. */
  parts: { category: NotificationCategory; label: string; count: number }[];
};

export const NO_UNREAD: UnreadSummary = { total: 0, urgent: 0, parts: [] };

const URGENT: NotificationCategory = NOTIFICATION_CATEGORY.DEADLINES;

export function summarizeUnread(
  rows: { category: string; count: number }[]
): UnreadSummary {
  const parts = rows
    .filter(
      (r): r is { category: NotificationCategory; count: number } =>
        r.count > 0 && r.category in NOTIFICATION_CATEGORY_LABELS
    )
    .map((r) => ({
      category: r.category,
      label: NOTIFICATION_CATEGORY_LABELS[r.category],
      count: r.count,
    }))
    .sort(
      (a, b) =>
        Number(b.category === URGENT) - Number(a.category === URGENT) ||
        b.count - a.count
    );
  // Summed from every row, known category or not: a category this build does
  // not know is still unread, and a total that quietly skipped it would
  // disagree with the feed.
  const total = rows.reduce((sum, r) => sum + Math.max(0, r.count), 0);
  const urgent = parts.find((p) => p.category === URGENT)?.count ?? 0;
  return { total, urgent, parts };
}

/** The bell's accessible name: "Notifications: 157 unread, 3 of them deadlines". */
export function unreadLabel(unread: UnreadSummary): string {
  if (unread.total === 0) return "Notifications: none unread";
  const base = `Notifications: ${unread.total} unread`;
  return unread.urgent > 0
    ? `${base}, ${unread.urgent} of them ${unread.urgent === 1 ? "a deadline" : "deadlines"}`
    : base;
}
