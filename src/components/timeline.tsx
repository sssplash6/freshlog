import Link from "next/link";

import { ArrowRightIcon, LinkIcon } from "@/components/icons";
import { ExpandableText } from "@/components/expandable-text";
import { PersonChip } from "@/components/person-chip";
import { Eyebrow, Section } from "@/components/ui/section";
import { ExternalLink } from "@/components/ui/link";
import { StatusChip } from "@/components/ui/status-chip";
import type { Status } from "@/lib/status";
import { formatUntil } from "@/lib/format";
import {
  BUCKET_LABEL,
  bucketOf,
  daysAway,
  formatDay,
  formatTimeOfDay,
  PROGRAM_ZONE,
  programWallClock,
  type Bucket,
} from "@/lib/when";

/**
 * Everything with a date on it, in one list.
 *
 * It was called "Up next" and it opened three pages — the admin inbox, a
 * student's home and a program's overview — each with a week's diary above
 * the thing the page was actually for. The owner asked for it gone, so the
 * default title went with it: what survives is a diary a page asks for BY
 * NAME, and there are two of those — "Coming up" on a student's meetings and
 * "Scheduled" on the sessions log. `title` is required now, so nothing can
 * quietly grow a fourth unnamed one.
 *
 * Three separate lists used to answer one question. Meetings were in
 * `ScheduledMeetings` with a 56px violet calendar leaf per row; use-by dates
 * were a column in a table on another page; task due dates were a chip inside
 * a panel. A mentor asking "what is happening this week" had to visit three
 * places and merge them mentally.
 *
 * The rows are heterogeneous on purpose. What a reader wants from this section
 * is chronology, and a deadline three days out matters more than a meeting next
 * month regardless of which of the two is a "meeting".
 *
 * The `DateLeaf` is gone with the three lists. A torn calendar page per row is
 * 56px of decoration repeating the group header directly above it, and on a
 * phone it took a third of the row's width.
 */
export type TimelineEntry = {
  id: string;
  /** The program's wall clock, as `Interview.scheduledAt` stores it. */
  at: Date;
    /** False for a whole-day thing — a use-by date, a task due date. */
  hasTime: boolean;
  /**
   * A time is expected here and has not been set yet.
   *
   * Not the same as having no time. A use-by date genuinely has none; a
   * meeting booked for "September 8, time to follow" is waiting on somebody.
   * Rendering both as "All day" told a student their interview was a whole-day
   * event, which is what the section this replaced got right and this got
   * wrong.
   */
  timePending?: boolean;
    /**
   * What it is, in two or three words: "Meeting", "Time expires".
   *
   * Optional, because a row with a person chip on it in a section called "Up
   * next" is already a meeting, and "Meeting" beside the mentor's name is a
   * word spent saying what the chip says. A dated row with no person — a
   * use-by date, a task — needs one.
   */
  title?: string;
  /** Already in this reader's voice, from `lib/status.ts`. */
  status?: Status | null;
  /** Whoever the reader is NOT: a student sees the mentor, a mentor the student. */
  person?: { id: string; name: string | null; email: string } | null;
  /**
   * The other party, when the reader is neither.
   *
   * Staff watch meetings they are not in, so a row naming only one side leaves
   * them to guess which. Two chips, not a name folded into the title: a title
   * that says "Meeting with Malika" cannot be scanned down a column the way a
   * chip can.
   */
  counterpart?: { id: string; name: string | null; email: string } | null;
  /** Where the row goes when tapped. */
  href?: string;
  /** A call link — the one thing on this page a reader needs mid-meeting. */
  joinUrl?: string | null;
  note?: string | null;
  /** Move · Cancel · Log · an RSVP. Only for rows this viewer owns. */
  action?: React.ReactNode;
};

const ORDER: Bucket[] = ["overdue", "today", "week", "later"];

export function Timeline({
  entries,
  now,
  title,
  /** Which buckets to render. `later` is usually a link, not a list. */
  buckets = ["overdue", "today", "week"],
  limit,
  moreHref,
  moreLabel = "All scheduled",
  empty = "Nothing scheduled.",
  className,
}: {
  entries: TimelineEntry[];
  /** One instant for the whole list, so two rows cannot disagree about today. */
  now: Date;
  /** Required: see the note above about the section this used to default to. */
  title: string;
  buckets?: Bucket[];
  limit?: number;
  moreHref?: string;
  moreLabel?: string;
  empty?: React.ReactNode;
  className?: string;
}) {
  const shown = ORDER.filter((b) => buckets.includes(b));
  const grouped = new Map<Bucket, TimelineEntry[]>();
  for (const entry of entries) {
    const bucket = bucketOf(entry.at, now);
    if (!shown.includes(bucket)) continue;
    const group = grouped.get(bucket);
    if (group) group.push(entry);
    else grouped.set(bucket, [entry]);
  }

    let remaining = limit ?? Infinity;
  const total = [...grouped.values()].reduce((n, g) => n + g.length, 0);
  const hidden = limit != null ? Math.max(0, total - limit) : 0;
  // The zone belongs to the LIST, not to each row. Every meeting in this app
  // is Tashkent time, so printing it on every line spent twenty characters a
  // row saying one thing — and on a phone that was the line that wrapped and
  // made each meeting two lines taller than it needed to be. Said once, and
  // only when something here actually carries a time.
  const anyTimed = entries.some((e) => e.hasTime);

  return (
    <Section
      title={title}
      className={className}
            action={
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
          {anyTimed && (
            <span className="text-muted-fg">Times in {PROGRAM_ZONE}</span>
          )}
          {moreHref ? (
            <Link href={moreHref} className="font-medium text-brand hover:underline">
              {hidden > 0 ? `${hidden} more · ${moreLabel}` : moreLabel}
            </Link>
          ) : hidden > 0 ? (
            // A cap that hides rows must say so even with nowhere to send the
            // reader. Before this, an eleventh meeting simply was not there,
            // and a list that silently truncates reads as a complete list.
            <span className="text-muted-fg">{hidden} more not shown</span>
          ) : null}
        </span>
      }
    >
      {total === 0 ? (
        <p className="px-4 py-2 text-sm text-muted-fg sm:px-5">{empty}</p>
      ) : (
        shown.map((bucket) => {
          const group = grouped.get(bucket);
          if (!group || remaining <= 0) return null;
          // Overdue and today come first, so a cap can only ever cut the tail.
          const rows = group.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, remaining);
          remaining -= rows.length;
          return (
            <div key={bucket}>
              <div className="border-b border-line bg-canvas/60 px-4 py-1.5 sm:px-5">
                <Eyebrow>{BUCKET_LABEL[bucket]}</Eyebrow>
              </div>
              <ul className="divide-y divide-line">
                {rows.map((entry) => (
                  <TimelineItem key={entry.id} entry={entry} now={now} bucket={bucket} />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </Section>
  );
}

/**
 * One dated row: when · what · who · state · what to do.
 *
 * The day is repeated on the row even under a "Today" header, because a
 * "Next 7 days" group needs it and a reader should not have to notice which
 * group they are in to read a row.
 */
export function TimelineItem({
  entry,
  now,
  bucket,
}: {
  entry: TimelineEntry;
  now: Date;
  bucket?: Bucket;
}) {
    const {
    title,
    status,
    person,
    counterpart,
    href,
    joinUrl,
    note,
    action,
    at,
    hasTime,
    timePending,
  } = entry;
  const day = formatDay(at, now);
  const time = formatTimeOfDay(at, hasTime);
  const inferred = bucket ?? bucketOf(at, now);
  // How far off, for anything beyond tomorrow. "Sep 8" is a fact a reader has
  // to place against today's date; "in 5 days" is the answer they wanted.
  const away = daysAway(at, now);
  const distance = away > 1 ? formatUntil(at, programWallClock(now)) : null;

      // Two lines, not three. The day and the clock are one fact and belong on one
  // line; how far off it is is the footnote. The zone is said once in the
  // section header — see `anyTimed` — because it is the same for every row.
  // The row this replaced ran to five lines a meeting, which is what made ten
  // of them a page rather than a list.
  const clock = time?.split(" ")[0] ?? null;

      const when = (
    <span className="w-[6.5rem] shrink-0 text-[0.8125rem] leading-tight sm:w-32">
            <span className="block font-semibold text-ink">
        {day}
        {clock && <> {clock}</>}
      </span>
      {/* No fake 00:00 on a whole-day row, and the zone is named: a student who
          moved abroad reads the same digits as the mentor who typed them, and
          only one of them is right about local noon. */}
            <span className="mt-0.5 block text-xs text-muted-fg">
        {distance ?? (timePending ? "Time to follow" : null)}
      </span>
    </span>
  );

  const body = (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {title && <span className="text-sm font-medium text-ink">{title}</span>}
        {person && <PersonChip person={person} size="sm" />}
        {counterpart && <PersonChip person={counterpart} size="sm" />}
        {status && <StatusChip status={status} />}
                {/* Inline and as a chip, not the `quiet` variant: quiet is 44px tall
            by design, which is right on its own line and wrong here, where it
            would set the height of every row including the ones with no link.
            A 36px pill beside the status chip stays tappable and scans as the
            control it is. */}
        {joinUrl && (
          <ExternalLink
            variant="chip"
            href={joinUrl}
            icon={<LinkIcon className="h-3.5 w-3.5" />}
            title="Open the meeting link"
          >
            Join
          </ExternalLink>
        )}
      </span>
      {note && (
        <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted-fg">
          <ExpandableText text={note} lines={2} />
        </span>
      )}
    </span>
  );

  return (
    <li
      className={
                "flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-2.5 sm:px-5" +
        // An overdue row is the only one that is not simply information. It
        // gets a left edge, not a tinted panel: the status chip already carries
        // the colour, and a whole amber row for every stale meeting was the
        // wall of warning this section replaces.
        (inferred === "overdue" ? " border-l-2 border-l-warn-line" : "")
      }
    >
      {href && !action ? (
                                <Link href={href} className="group flex min-w-0 flex-1 items-start gap-3">
          {when}
          {body}
          <ArrowRightIcon className="mt-1 h-4 w-4 shrink-0 text-muted-fg transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
        </Link>
      ) : (
        <>
          {when}
          {body}
        </>
      )}
      {action && <span className="flex shrink-0 items-center gap-2">{action}</span>}
    </li>
  );
}
