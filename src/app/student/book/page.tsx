import Link from "next/link";
import { redirect } from "next/navigation";

import { PersonCell } from "@/components/person-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { ExternalLink } from "@/components/ui/link";
import {
  AllocationBalance,
  AllocationMeter,
} from "@/components/allocation-row";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { ROLES, USER_STATUS, canActAsMentor } from "@/lib/constants";
import { requireRole } from "@/lib/dal";

import { allocationSummary, type AllocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { assignmentsForStudentWhere } from "@/lib/queries";
import {
  rollUp,
  status,
  type Status,
  type ViewerContext,
} from "@/lib/status";

type MentorHours = AllocationSummary["perMentor"][number];
type Mentor = NonNullable<MentorHours["mentor"]>;

/**
 * One mentor: the time held with them, and the way to reach them.
 *
 * `hours` and `bookingUrl` are independently optional because the two facts
 * come from two different tables that do not have to agree — which is the bug
 * this page was rebuilt around. See the union below.
 */
type BookRow = {
  mentor: Mentor;
  hours: MentorHours | null;
  bookingUrl: string | null;
  /** A calendar this student may actually open. See `offersBooking`. */
  bookable: boolean;
};

/**
 * Whether a mentor can be offered as bookable at all — before any question of
 * balances.
 *
 * Two guards, both from real rows in the live data: the platform's own admin
 * account is paired into every program and was being offered to students as
 * somebody to book, and a mentor who has never set a name renders as an email
 * address in a "Book with…" button.
 */
function offersBooking(mentor: Mentor, bookingUrl: string | null): boolean {
  return (
    Boolean(bookingUrl) && canActAsMentor(mentor) && Boolean(mentor.name?.trim())
  );
}

/** Soonest use-by first; a mentor with no allocation has no clock and goes last. */
function byUseBy(a: BookRow, b: BookRow): number {
  return (
    (a.hours?.deadline?.getTime() ?? Infinity) -
    (b.hours?.deadline?.getTime() ?? Infinity)
  );
}

export default async function StudentBookPage() {
  const user = await requireRole(ROLES.STUDENT);
  const now = new Date();
  const viewer: ViewerContext = { audience: "student", userId: user.id, now };

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      enrollments: { select: { programId: true, cohortId: true } },
    },
  });

  // Not onboarded / not approved yet — the home page explains what's next.
  if (!profile || user.status !== USER_STATUS.ACTIVE) redirect("/student");

  const [assignments, hours] = await Promise.all([
    prisma.mentorAssignment.findMany({
      where: assignmentsForStudentWhere(profile),
      include: { mentor: true },
      orderBy: { createdAt: "asc" },
    }),
    allocationSummary(profile.id),
  ]);

  // A mentor can be paired twice — once program-wide, once for the cohort — so
  // what matters is whether they have a link ANYWHERE, not whether the pairing
  // this student's cohort happened to match carries one.
  const pairings = new Map<string, { mentor: Mentor; bookingUrl: string | null }>();
  for (const a of assignments) {
    const seen = pairings.get(a.mentorId);
    if (!seen?.bookingUrl) {
      pairings.set(a.mentorId, { mentor: a.mentor, bookingUrl: a.calendlyUrl });
    }
  }

  // THE UNION, and the reason this page was rebuilt: it is keyed on the mentor,
  // and a mentor qualifies by holding this student's time OR by having a
  // calendar to open. Keying it on `MentorAssignment` alone — the pairing — put
  // hours a student still holds with a mentor whose pairing was later removed
  // inside the ring total on /student and on no page at all: they could see the
  // balance and not whose it was.
  const rows = new Map<string, BookRow>();
  for (const h of hours.perMentor) {
    // Pooled time has no mentor to book with; the state row above names it.
    if (!h.mentor) continue;
    const bookingUrl = pairings.get(h.mentor.id)?.bookingUrl ?? null;
    rows.set(h.mentor.id, {
      mentor: h.mentor,
      hours: h,
      bookingUrl,
      bookable:
        offersBooking(h.mentor, bookingUrl) && !h.expired && h.remaining >= 0,
    });
  }
  for (const [mentorId, { mentor, bookingUrl }] of pairings) {
    if (rows.has(mentorId)) continue;
    // No time and no calendar is nothing to offer. This is what emptied the
    // page of its eight dashed placeholders.
    if (!offersBooking(mentor, bookingUrl)) continue;
    rows.set(mentorId, { mentor, hours: null, bookingUrl, bookable: true });
  }

  const all = [...rows.values()].sort(byUseBy);
  // Settled: nothing left to spend and nothing to book. Folded rather than cut —
  // the count keeps the magnitude on screen, and expired or overdrawn time is
  // still time the student needs to be able to name.
  const settled = all.filter((r) => !r.bookable && (r.hours?.remaining ?? 0) <= 0);
  const live = all.filter((r) => !settled.includes(r));
  // A fold that hides everything is just a hidden page.
  const open = live.length > 0 ? live : settled;
  const folded = live.length > 0 ? settled : [];

  const states: Status[] = [];
  // Time granted before a mentor was chosen: it is inside the balance on the
  // home page and belongs to no row here, so the difference has to be stated.
  const pooled = hours.perMentor
    .filter((m) => !m.mentor)
    .reduce((sum, m) => sum + Math.max(0, m.remaining), 0);
  if (pooled > 0) {
    const s = status("POOL_UNASSIGNED", viewer, { minutes: pooled });
    if (s) states.push(s);
  }
  // Said once, at the top, only when NOTHING here can be booked — otherwise
  // each row says it for itself, beside the email that answers it.
  const nothingBookable = all.length > 0 && all.every((r) => !r.bookable);
  if (nothingBookable) {
    const linkless = all.flatMap((r) => {
      const s = r.bookingUrl ? null : status("BOOKING_LINK_MISSING", viewer);
      return s ? [s] : [];
    });
    // Threshold 1: one mentor keeps their own wording, several collapse into
    // the count. Either way the sentence comes from the model, not from here.
    states.push(...rollUp(linkless, viewer, { threshold: 1 }));
  }

  const nothingToShow =
    all.length === 0
      ? status(hours.allotted === 0 ? "BALANCE_NONE" : "NO_MENTOR", viewer)
      : null;

  return (
    <div className="space-y-6">
      <PageTitle backHref="/student" backLabel="Home" title="Book a session" />

      {states.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {states.map((s) => (
            <StatusChip key={s.type} status={s} />
          ))}
        </div>
      )}

      <Section title="Your mentors" count={all.length || undefined}>
        {nothingToShow ? (
          <EmptyState framed={false} variant="blocked" title={nothingToShow.label}>
            {nothingToShow.explanation}
          </EmptyState>
        ) : (
          // Two up. A mentor's card is a name, a balance, a bar and a link —
          // it never fills a row, and one per line turned five mentors into a
          // page of scrolling with the right half empty the whole way down.
          <ul className="grid border-t border-line sm:grid-cols-2">
            {open.map((row) => (
              <MentorRow
                key={row.mentor.id}
                row={row}
                viewer={viewer}
                sayLinkState={!nothingBookable}
              />
            ))}
          </ul>
        )}

        {folded.length > 0 && (
          <Disclosure
            label="Mentors with no time remaining"
            count={folded.length}
            className="border-t border-line px-4 sm:px-5"
          >
            <ul className="-mx-4 grid border-t border-line sm:-mx-5 sm:grid-cols-2">
              {folded.map((row) => (
                <MentorRow
                  key={row.mentor.id}
                  row={row}
                  viewer={viewer}
                  sayLinkState={!nothingBookable}
                />
              ))}
            </ul>
          </Disclosure>
        )}
      </Section>
    </div>
  );
}

/**
 * The balance leads, the meter shows the proportion, and the foot of the row is
 * either a calendar or a way to reach the person — never a dashed placeholder
 * where a button should be.
 */
function MentorRow({
  row,
  viewer,
  /** False while the state row above has already said it for every mentor. */
  sayLinkState,
}: {
  row: BookRow;
  viewer: ViewerContext;
  sayLinkState: boolean;
}) {
  const { mentor, hours, bookingUrl, bookable } = row;
  const name = mentor.name ?? mentor.email;

  // A pairing with a calendar but no grant behind it yet: bookable, and honest
  // about the fact that nothing has been allocated.
  const noTime = hours ? null : status("BALANCE_NONE", viewer);

  // One chip, for the one thing standing between this row and a booking.
  // Overdrawn is deliberately absent: the balance beside the name already says
  // "over", in red, and saying it twice on one row is the habit this page was
  // rebuilt to drop.
  const blocked =
    hours?.expired && hours.forfeited > 0
      ? status("ALLOCATION_EXPIRED", viewer, { minutes: hours.forfeited })
      : !bookingUrl && sayLinkState
        ? status("BOOKING_LINK_MISSING", viewer)
        : null;

  return (
    <li className="border-b border-line bg-surface px-4 py-3.5 sm:px-5 sm:[&:nth-child(odd)]:border-r">
      {/* Name and balance hold one line: the name truncates, the figure never
          does. As tinted pills the long names wrapped and pushed the balance
          onto a second row, so two cards side by side disagreed about where
          their own numbers live — which is exactly the shape `PersonCell` is,
          and this card had been building its own copy of it out of a badge and
          a span. The mentor IS this card, so they are a cell. */}
      <div className="flex items-center justify-between gap-x-3">
        <PersonCell
          person={mentor}
          href={`/mentors/${mentor.id}`}
          secondary={false}
          className="min-w-0 flex-1"
        />
        <span className="shrink-0">
          {hours ? (
            <AllocationBalance entry={hours} />
          ) : (
            noTime && <StatusChip status={noTime} />
          )}
        </span>
      </div>

      {hours && (
        <AllocationMeter
          entry={hours}
          viewer={viewer}
          label={`Time with ${name}`}
          className="mt-2"
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        {bookable && bookingUrl ? (
          <ExternalLink
            variant="action"
            href={bookingUrl}
            title={`Book with ${name}`}
          >
            Book
          </ExternalLink>
        ) : (
          <>
            {blocked && <StatusChip status={blocked} />}
            {/* The fallback that makes this page an answer rather than a dead
                end: no calendar, but a person, and a way to write to them. */}
            <ExternalLink
              variant="quiet"
              href={`mailto:${mentor.email}`}
              title={`Email ${name}`}
              className="max-w-full break-all"
            >
              {mentor.email}
            </ExternalLink>
          </>
        )}
      </div>
    </li>
  );
}
