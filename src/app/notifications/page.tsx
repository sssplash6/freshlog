import { AttentionList } from "@/components/attention-list";
import { ApproveStudentButtons } from "@/components/forms/approve-student-buttons";
import { NotificationList } from "@/components/notification-list";
import { markAllNotificationsRead } from "@/lib/actions/notifications";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
} from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/section";
import { Section } from "@/components/ui/section";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { attentionFor } from "@/lib/attention";
import { requireUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { profileOf } from "@/lib/profile";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Notifications" };

/**
 * The bell, and the only place either half of it lives.
 *
 * It was two ideas at two addresses that nobody could tell apart. "Needs you"
 * — what is waiting on the reader right now — opened all three home pages,
 * derived three separate times; "Notifications" — what has already happened —
 * was this page, which the bell did not even point at. The owner asked for one
 * button: everything about the reader is behind it, and no page carries either
 * list any more.
 *
 * So the order is the question and then the record. Needs you, then a
 * rule, then what has happened, paged and filterable. `lib/attention.ts`
 * derives the first half for whichever of the three readers is looking; this
 * page renders it and asks nothing about who they are, except for the two
 * controls a row can carry — approving a student, answering a meeting — which
 * only ever appear for the one reader who can act on them.
 */

/** A page of the feed. Deliberately generous — it is read by scrolling. */
const PER_PAGE = 50;

/** The order the chips read in: what changes most often, first. */
const CATEGORY_ORDER: NotificationCategory[] = [
  NOTIFICATION_CATEGORY.SESSIONS,
  NOTIFICATION_CATEGORY.HOURS,
  NOTIFICATION_CATEGORY.TASKS,
  NOTIFICATION_CATEGORY.DEADLINES,
  NOTIFICATION_CATEGORY.ACCOUNTS,
];

function isCategory(value: unknown): value is NotificationCategory {
  return (
    typeof value === "string" && (CATEGORY_ORDER as string[]).includes(value)
  );
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string }>;
}) {
  const user = await requireUser();
  const profile = await profileOf(user);
  const params = await searchParams;
  const page = parsePage(params.page);

  // A filter of six, not of seventeen types. Anything else in the URL narrows
  // to nothing rather than widening the read — the params never decide reach.
  const wanted = params.category;
  const category = isCategory(wanted) ? wanted : undefined;
  const where = { userId: user.id, ...(category ? { category } : {}) };

  // The feed used to stop dead at the hundredth notification with nothing to
  // say so: older history simply did not exist as far as the page was
  // concerned. It is paged now, and the unread badge counts every unread one
  // rather than the unread ones that happened to be on screen.
  const [attention, notifications, total, unread, byCategory] =
    await Promise.all([
      attentionFor(user, profile),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PER_PAGE,
        take: PER_PAGE,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: user.id, read: false } }),
      // Counted across the whole feed, not the filtered slice: a chip reading
      // zero is what tells a reader the category exists and is empty.
      prisma.notification.groupBy({
        by: ["category"],
        where: { userId: user.id },
        _count: true,
      }),
    ]);
  const countOf = new Map(byCategory.map((c) => [c.category, c._count]));
  const present = CATEGORY_ORDER.filter((c) => countOf.has(c));

  // ORDER (October 2026): what is new, then what to act on, then the history
  // with its filter directly above it. The one unread notice used to sit
  // under a five-row copy of the home page's checklist, below the fold on a
  // phone.
  const unreadRows = notifications.filter((n) => !n.read);
  const readRows = notifications.filter((n) => n.read);
  // A pager only when there is more than one page: on one page its "12
  // notifications" just repeated the count above it.
  const pager =
    total > PER_PAGE ? (
      <Pagination
        basePath="/notifications"
        params={category ? { category } : {}}
        page={page}
        pageSize={PER_PAGE}
        total={total}
        unit="notifications"
        className="border-t border-line px-4 py-2 sm:px-5"
      />
    ) : undefined;
  const markAll =
    unread > 0 ? (
      <form action={markAllNotificationsRead}>
        <Button type="submit" variant="ghost" size="sm" className="sm:-mr-3">
          Mark all read
        </Button>
      </form>
    ) : undefined;

  return (
    <div className="max-w-3xl space-y-4">
      <PageTitle title="Notifications" />

      {unreadRows.length > 0 && (
        <NotificationList
          notifications={unreadRows}
          newAction={markAll}
          footer={readRows.length === 0 ? pager : undefined}
        />
      )}

      <AttentionList
        statuses={attention.statuses}
        dismissible={attention.dismissible}
        renderAction={(s) => {
          // The one row that can discharge itself where it is read: an admin
          // approving a signup. It is the reader's own act, and a trip to
          // another page to perform it is not the same request.
          if (s.type === "STUDENT_PENDING_APPROVAL" && s.subject) {
            return <ApproveStudentButtons studentProfileId={s.subject.id} />;
          }
          return null;
        }}
        {...(attention.spilled > 0
          ? {
              moreLabel: `${attention.spilled} more`,
              ...(attention.moreHref ? { moreHref: attention.moreHref } : {}),
            }
          : {})}
      />

      {/* The category chips sit on the page ground above the feed, the way a
          filter strip sits under a large title — not in a bordered band inside
          the card it narrows, which was a card inside a card.

          Only when there is something to narrow. No "All" chip: a chip that
          is on clears itself when clicked, and the bar's own Reset is the way
          back from any of them. Categories a reader has nothing in are dropped
          rather than offered empty — and if that leaves ONE, the whole row
          goes: a filter that can only select everything is a button whose job
          nobody can guess. */}
      {present.length > 1 && (
        <FilterBar
          basePath="/notifications"
          params={params}
          framed={false}
          presets={present.map((c) => ({
            label: NOTIFICATION_CATEGORY_LABELS[c],
            params: { category: c },
          }))}
        />
      )}

      {notifications.length === 0 ? (
        <Section title="Earlier">
          <EmptyState framed={false} title="Nothing has happened yet" />
        </Section>
      ) : (
        readRows.length > 0 && (
          <NotificationList notifications={readRows} footer={pager} />
        )
      )}

    </div>
  );
}
