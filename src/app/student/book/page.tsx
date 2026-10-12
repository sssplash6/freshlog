import { redirect } from "next/navigation";

import { PersonCell } from "@/components/person-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/link";
import {
  AllocationBalance,
  AllocationMeter,
} from "@/components/allocation-row";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { ROLES, USER_STATUS, canActAsMentor } from "@/lib/constants";
import { requireRole } from "@/lib/dal";

import {
  allocationSummary,
  canBookOn,
  type AllocationSummary,
} from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { assignmentsForStudentWhere } from "@/lib/queries";
import {
  rollUp,
  status,
  type Status,
  type ViewerContext,
} from "@/lib/status";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Book a meeting" };

type MentorHours = AllocationSummary["perMentor"][number];
type Mentor = NonNullable<MentorHours["mentor"]>;

/**
 * One mentor: the time held with them, and the way to reach them.
 *
 * `hours` is always there — a row exists because the student holds (or held)
 * time with this mentor. `bookingUrl` is optional because it comes from the
 * pairing, a different table that does not have to agree.
 */
type BookRow = {
  mentor: Mentor;
  hours: MentorHours;
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

/** Soonest use-by first; time with no deadline has no clock and goes last. */
function byUseBy(a: BookRow, b: BookRow): number {
  return (
    (a.hours.deadline?.getTime() ?? Infinity) -
    (b.hours.deadline?.getTime() ?? Infinity)
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
      enrollments: {
        select: { programId: true, levelId: true, cohortId: true },
      },
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
  // a pairing's link is looked up per (program, mentor), taking whichever of
  // the two carries one. The mentor-wide entry is the fallback for time held in
  // a program whose own pairing has no link yet: it is the same person's
  // calendar either way.
  const links = new Map<string, string>();
  for (const a of assignments) {
    if (!a.calendlyUrl) continue;
    const pair = `${a.programId}:${a.mentorId}`;
    if (!links.has(pair)) links.set(pair, a.calendlyUrl);
    if (!links.has(a.mentorId)) links.set(a.mentorId, a.calendlyUrl);
  }

  // Keyed on the mentor, and a mentor qualifies ONLY by holding this student's
  // time. A pairing alone is not an invitation: mentors were booked by students
  // of their program who held none of their hours, and had to turn them away
  // (Sep 2026). Keying on the allocation also keeps time held with a mentor
  // whose pairing was later removed on this page, where the student can see
  // whose it is.
  const rows = new Map<string, BookRow>();
  for (const h of hours.perMentor) {
    // Pooled time has no mentor to book with; the state row above names it.
    if (!h.mentor) continue;
    const bookingUrl =
      links.get(`${h.program.id}:${h.mentor.id}`) ??
      links.get(h.mentor.id) ??
      null;
    const row: BookRow = {
      mentor: h.mentor,
      hours: h,
      bookingUrl,
      bookable: offersBooking(h.mentor, bookingUrl) && canBookOn(h),
    };
    // Time with one mentor in two programs is two entries; the one that can
    // still be booked is the one this card is for.
    const seen = rows.get(h.mentor.id);
    if (!seen || (!seen.bookable && row.bookable)) rows.set(h.mentor.id, row);
  }

  const all = [...rows.values()].sort(byUseBy);
  // Settled: nothing left to spend and nothing to book. Folded rather than cut —
  // the count keeps the magnitude on screen, and expired or overdrawn time is
  // still time the student needs to be able to name.
  const settled = all.filter((r) => !r.bookable && r.hours.remaining <= 0);
  const live = all.filter((r) => !settled.includes(r));
  // A fold that hides everything is just a hidden page.
  const open = live.length > 0 ? live : settled;
  const folded = live.length > 0 ? settled : [];

  const states: Status[] = [];
  // Time granted before a mentor was chosen: it is inside the balance on the
  // home page and belongs to no row here, so the difference has to be stated.
  const pooled = hours.perMentor
    .filter((m) => !m.mentor && !m.bank)
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
    <div className="space-y-4">
      <PageTitle title="Book a meeting" />

      {states.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {states.map((s) => (
            <StatusChip key={s.type} status={s} />
          ))}
        </div>
      )}

      <Section title="Mentors" count={all.length > 1 ? all.length : undefined}>
        {nothingToShow ? (
          <EmptyState framed={false} variant="blocked" title={nothingToShow.label} />
        ) : (
          // One grouped list, hairlines between. The two-up grid it replaces
          // drew a vertical rule down the card and a rule across its top — a
          // table's grid laid over a list of three people, with a hole in it
          // whenever the count was odd. A student has two or three mentors;
          // the page is short either way.
          <ul className="divide-y divide-line">
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
            label="None remaining"
            count={folded.length}
            className="border-t border-line px-4 py-2 sm:px-5"
          >
            <ul className="-mx-4 divide-y divide-line border-t border-line sm:-mx-5">
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

  // One chip, for the one thing standing between this row and a booking.
  // Overdrawn is deliberately absent: the balance beside the name already says
  // "over", in red, and saying it twice on one row is the habit this page was
  // rebuilt to drop.
  //
  // A missing link is grey, not amber: it is the mentor's setup step, and the
  // student has done nothing that needs a warning. The email button beside it
  // is the answer, so the chip only has to name the reason.
  const noLink = !bookingUrl && sayLinkState ? status("BOOKING_LINK_MISSING", viewer) : null;
  const blocked =
    hours.expired && hours.forfeited > 0
      ? status("ALLOCATION_EXPIRED", viewer, { minutes: hours.forfeited })
      : noLink
        ? { ...noLink, severity: "neutral" as const }
        : null;
  const firstName = name.split(" ")[0];

  return (
    <li className="px-4 py-3 sm:px-5">
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
          <AllocationBalance entry={hours} />
        </span>
      </div>

      <AllocationMeter
        entry={hours}
        viewer={viewer}
        label={`Time with ${name}`}
        className="mt-2"
      />

      {/* The foot: what stands in the way on the left, the one way forward on
          the right — the calendar as this card's single filled button, or,
          with no calendar, the mentor's address as a plain text link. Every
          row ends at the same edge, so a list of three reads as one column. */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {bookable && bookingUrl ? (
          // The one thing this page is for, at full size: 44px, and the full
          // width of the card on a phone.
          <ExternalLink
            variant="action"
            href={bookingUrl}
            className="ml-auto max-sm:w-full"
          >
            Book with {firstName}
          </ExternalLink>
        ) : (
          <>
            {blocked ? <StatusChip status={blocked} /> : <span />}
            {/* The fallback that makes this page an answer rather than a dead
                end: no calendar, but a person, and a way to write to them —
                as a real button. A 13px address was the smallest thing on the
                row and the only way forward on it. */}
            <a
              href={`mailto:${mentor.email}`}
              title={mentor.email}
              className={buttonClasses("secondary", "md", "ml-auto max-sm:w-full")}
            >
              Email {firstName}
            </a>
          </>
        )}
      </div>
    </li>
  );
}
