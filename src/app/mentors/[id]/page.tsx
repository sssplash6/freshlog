import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { BookingLinksForm } from "@/components/forms/booking-link-form";
import { EditMentorForm } from "@/components/forms/mentor-forms";
import { AvatarForm, OwnNameForm } from "@/components/forms/profile-forms";
import { PersonCell } from "@/components/person-chip";
import { SessionsLog } from "@/components/session-row";
import { sessionsCaption, toSessionEntries } from "@/lib/session-entries";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Figure, FigureRow } from "@/components/ui/figure";
import { ArrowLink, ExternalLink } from "@/components/ui/link";
import { PageTitle, Section } from "@/components/ui/section";
import { TabLinks } from "@/components/ui/segmented";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import {
  adminScope,
  canAdministerMentor,
  canManageMentor,
  scopeProgramFilter,
} from "@/lib/authz";
import { cn } from "@/lib/cn";
import { canActAsMentor, ROLES, USER_STATUS } from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import { readParam, type SearchParams } from "@/lib/filters";
import { formatDate, formatDuration } from "@/lib/format";
import { allocationSummary, canBookOn } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import {
  assignmentsForStudentWhere,
  mentorAssignments,
  mentorOverview,
  programOptions,
  toProgramOptions,
} from "@/lib/queries";
import { type ViewerContext } from "@/lib/status";
import type { User } from "@/generated/prisma/client";

/** Sessions shown under the record; the figures above them stay complete. */
const LOG_LIMIT = 10;
const DAY = 24 * 60 * 60 * 1000;

/** "Global Admissions / Spring 25", or just the program where there is no cohort. */
function labelOf(a: {
  program: { name: string };
  cohort: { name: string } | null;
}): string {
  return a.cohort ? `${a.program.name} / ${a.cohort.name}` : a.program.name;
}

/**
 * One mentor, three views, decided by who is reading (§6.9).
 *
 *   record  what this mentor has delivered, to whom, and lately. Read by the
 *           mentor themself and by an admin who administers a program they work
 *           in — the union of the viewer's rights, not one or the other.
 *   card    the page that says YES. A student deciding whether to book, or a
 *           colleague who works alongside them: a face, the programs they
 *           share, and a way to reach them. Twenty words.
 *
 * It replaces two pages joined by a "View profile" button — /admin/mentors/[id]
 * carried the whole delivery record and none of the identity, /mentors/[id]
 * carried the identity and, by its own comment, "deliberately NO hours" — so an
 * admin looking at a mentor had to know which of two addresses held the fact
 * they wanted.
 *
 * THE GATE RUNS BEFORE ANY QUERY ABOUT THE MENTOR. `requireUser` first, the
 * mentor's existence second, and the reach question third; a page that gated
 * after fetching was a live data leak on Sep 3 2026.
 *
 * Reach is `canManageMentor`: at least one program in common between this
 * reader's grants and this mentor's pairings. Everything the record then shows
 * is filtered to those same programs — a mentor's other programs are not this
 * reader's to read, which is the leak that was fixed on the mentors LIST last
 * week and would otherwise have been reintroduced here one page later.
 */
export default async function MentorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requireUser();
  const { id } = await params;
  const query = await searchParams;

  const mentor = await prisma.user.findUnique({ where: { id } });
  // The same pool the mentors list draws from: plain mentors, plus dual-role
  // admins flagged as mentors.
  if (!mentor || !canActAsMentor(mentor)) notFound();

  const isSelf = viewer.id === mentor.id;
  const isStudent = viewer.role === ROLES.STUDENT;
  // `manages` opens the record — a shared program at any grant level reads a
  // mentor's figures. `edits` is the write answer, so a read-only grant (a
  // LEADER, a SALES row) sees the record but not the Edit disclosure.
  const manages = !isStudent && (await canManageMentor(viewer, mentor.id));
  const edits = !isStudent && (await canAdministerMentor(viewer, mentor.id));

  if (isSelf || manages) {
    return (
      <MentorRecord
        mentor={mentor}
        viewer={viewer}
        isSelf={isSelf}
        manages={manages}
        edits={edits}
        query={query}
      />
    );
  }
  return <MentorCard mentor={mentor} viewer={viewer} isStudent={isStudent} />;
}

/* ------------------------------------------------------------------ record --- */

/**
 * The window the delivery figures are read through.
 *
 * Three answers and no free-text range, because the range this page had was
 * two date inputs and a program select producing a sentence nobody could check.
 * The default is ninety days rather than everything: a lifetime total only ever
 * grows, so it tells a reader nothing about whether this mentor is delivering
 * now — which is the question the section is on the page to answer.
 */
function windowFor(period: string, now: Date): { from?: Date; label: string } {
  if (period === "all") return { label: "all time" };
  if (period === "30d") {
    return { from: new Date(now.getTime() - 30 * DAY), label: "30 days" };
  }
  return { from: new Date(now.getTime() - 90 * DAY), label: "90 days" };
}

async function MentorRecord({
  mentor,
  viewer,
  isSelf,
  manages,
  edits,
  query,
}: {
  mentor: User;
  viewer: User;
  isSelf: boolean;
  manages: boolean;
  edits: boolean;
  query: SearchParams;
}) {
  // One instant for every use-by date and every window bound on the page.
  const now = new Date();
  // The lens changes emphasis, never authority (§3): a mentor reading their own
  // record is addressed as one, and an admin reading it is addressed as staff.
  const audience = isSelf ? ("mentor" as const) : ("staff" as const);
  const context: ViewerContext = { audience, userId: viewer.id, now };

  /**
   * Which programs this reader may see of this mentor's.
   *
   * `undefined` means every one, which is both a platform admin and the mentor
   * reading their own record — their own work is not somebody's grant to
   * narrow. For a scoped admin it is their grants, and every figure below is
   * summed from rows that carry it.
   */
  const programIds = isSelf
    ? undefined
    : scopeProgramFilter(await adminScope(viewer));
  const inReach = (programId: string) =>
    !programIds || programIds.includes(programId);

  const period = readParam(query, "period");
  const win = windowFor(period, now);

  const [allPairings, overview, feedback, pickerPrograms] = await Promise.all([
    mentorAssignments(mentor.id),
    mentorOverview(mentor.id, { from: win.from }),
    prisma.mentorFeedback.aggregate({
      where: {
        mentorId: mentor.id,
        ...(programIds
          ? { student: { enrollments: { some: { programId: { in: [...programIds] } } } } }
          : {}),
      },
      _avg: { rating: true },
      _count: true,
    }),
    // The picker is built from the READER's programs, which is what makes an
    // unticked box safe to read as a removal: a pairing in a program they do
    // not hold draws no row, and `updateMentor` refuses to delete what drew no
    // row. Only fetched when there is an Edit fold to put it in.
    edits ? programOptions(programIds) : Promise.resolve([]),
  ]);

  /**
   * Everything narrowed to the reader's programs, in one place.
   *
   * `mentorOverview` has no scope argument — it takes a single `programId` or
   * none — so the narrowing happens here, over the rows it returns. The totals
   * are then summed from those same rows rather than re-derived from the
   * database: a scoped admin's "delivered" is genuinely a different number from
   * a platform admin's, and summing the rows the table already shows is what
   * keeps the figure and the table agreeing.
   */
  const pairings = allPairings.filter((a) => inReach(a.programId));
  const byProgram = overview.byProgram.filter((row) => inReach(row.id));
  // A balance row and a session each name their own program now, so the
  // narrowing asks the row rather than the student — who may study in a program
  // this reader does not hold.
  const students = overview.students.filter((s) => inReach(s.program.id));
  const sessions = overview.sessions.filter((s) => inReach(s.programId));
  const sum = (pick: (row: (typeof byProgram)[number]) => number) =>
    byProgram.reduce((total, row) => total + pick(row), 0);
  const entries = toSessionEntries(sessions, { studentBase: "/students" });
  const delivered = sum((r) => r.delivered);
  const missed = sum((r) => r.missed);
  const meetings = sum((r) => r.sessions);

  const name = mentor.name ?? mentor.email;
  const rated = feedback._count > 0 && feedback._avg.rating != null;
  const base = `/mentors/${mentor.id}`;

  // `AllocationRow`'s columns, in its order — see the comment on the table
  // below. Delivered, wasted, left, and the size of the grant last.
  const studentColumns: Column[] = [
    { label: "Student" },
    { label: "Completed", align: "right" },
    { label: "Missed", align: "right" },
    { label: "Remaining", align: "right" },
    { label: "Assigned", align: "right" },
  ];

  // Soonest use-by first: the row at the top is the time about to be lost.
  const holders = [...students].sort(
    (a, b) => (a.deadline?.getTime() ?? 0) - (b.deadline?.getTime() ?? 0)
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <PageTitle
          backHref={manages ? "/mentors" : undefined}
          backLabel={manages ? "Mentors" : undefined}
          eyebrow="Mentor"
          title={name}
          subtitle={
            /*
              Programs as text, each carrying whether a student can book
              through it. This is the ONLY place that says WHICH pairing has no
              link — the attention row below says that one is missing, and the
              old page's per-pairing chips said which. A mentor in three
              programs with one link needs both halves.
            */
            <>
              <span className="block">
                {mentor.email} · registered {formatDate(mentor.createdAt)}
              </span>
              {pairings.length > 0 && (
                <span className="block">
                  {pairings.map((a, i) => (
                    <span key={a.id}>
                      {i > 0 && " · "}
                      {labelOf(a)}
                      {!a.calendlyUrl && (
                        <span className="text-warn-ink"> (no booking link)</span>
                      )}
                    </span>
                  ))}
                </span>
              )}
            </>
          }
          leading={
            <Avatar
              person={mentor}
              alt={`${name}'s profile picture`}
              className="h-16 w-16 text-2xl"
            />
          }
        />

        {edits && (
          <Disclosure label="Edit">
            <EditMentorForm
              mentorId={mentor.id}
              name={mentor.name ?? ""}
              email={mentor.email}
              targets={pairings.map((a) =>
                a.cohortId ? `c:${a.cohortId}` : `p:${a.programId}`
              )}
              programs={toProgramOptions(pickerPrograms)}
              // `updateMentor` refuses a name or email change from anybody but
              // a platform admin: once admins are peers, whoever can repoint
              // another admin's sign-in can become them.
              canEditIdentity={viewer.platformAdmin}
            />
          </Disclosure>
        )}

        {/*
          The mentor's own edit forms, which §6.9 moves to /settings in commit
          48. They stay folded here until that page exists: this is the ONLY
          place in the app that sets a booking link, a profile picture or a
          mentor's own name, and /mentor's BOOKING_LINK_MISSING row points here
          to do it. Deleting them now would leave a mentor told to set a link
          with nowhere to set one.
        */}
        {isSelf && (
          <Disclosure
            label="Edit your profile and booking links"
             // Open when a link is missing. /mentor's booking-link warning
            // sends the mentor here to fix it, and landing on a closed fold is
            // a second click on a page they were told to visit.
            defaultOpen={allPairings.some((a) => !a.calendlyUrl)}
          >
            <div className="mt-2 space-y-4">
              <Section eyebrow="Yours" title="Picture and name">
                <div className="space-y-4 p-4 sm:p-5">
                  <AvatarForm
                    person={{
                      id: mentor.id,
                      name: mentor.name,
                      email: mentor.email,
                      avatarUpdatedAt: mentor.avatarUpdatedAt,
                    }}
                  />
                  <div className="border-t border-line pt-5">
                    <OwnNameForm defaultName={mentor.name ?? ""} />
                  </div>
                </div>
              </Section>
              {allPairings.length > 0 ? (
                <BookingLinksForm
                  assignments={allPairings.map((a) => ({
                    id: a.id,
                    label: labelOf(a),
                    calendlyUrl: a.calendlyUrl,
                  }))}
                />
              ) : (
                <EmptyState title="No programs">
                  An admin adds you to a program, and its booking link is yours
                  to set.
                </EmptyState>
              )}
            </div>
          </Disclosure>
        )}
      </div>

      <Section
        eyebrow="Time"
        title="Completed"
        action={
          <TabLinks
            label="Period"
            className="text-xs"
            items={[
              { href: `${base}?period=30d`, label: "30 days" },
              // The bare address IS ninety days, so a link to this page and the
              // default view are the same URL.
              { href: base, label: "90 days" },
              { href: `${base}?period=all`, label: "All" },
            ]}
          />
        }
      >
        <div className="px-4 sm:px-5">
          <FigureRow framed={false} className="pt-4">
            <Figure
              label={`Completed · ${win.label}`}
              value={formatDuration(delivered)}
              size="lead"
              tone="hours"
            />
            <Figure label="Meetings" value={String(meetings)} />
            <Figure
              label="Missed"
              value={missed > 0 ? formatDuration(missed) : "—"}
              // No colour: at this size the figure is an aggregate, and the
              // per-program row below is where a no-show has a program to be
              // amber about.
              tone={missed > 0 ? "ink" : "muted"}
            />
          </FigureRow>
        </div>

        {byProgram.length === 0 ? (
          <EmptyState framed={false} title="No time in these programs">
            A line appears for each program once this mentor holds a
            student&apos;s time or logs a session.
          </EmptyState>
        ) : (
          <Table
            framed={false}
            className="border-t border-line"
            columns={[
              { label: "Program" },
              { label: "Students", align: "right" },
              { label: "Completed", align: "right" },
              { label: "Missed", align: "right" },
              { label: "Total", align: "right" },
              { label: "Remaining", align: "right" },
            ]}
          >
            {byProgram.map((row, i) => (
              <Tr
                key={row.id}
                className="deal-in"
                style={{ animationDelay: `${Math.min(i, 14) * 24}ms` }}
              >
                <Td className="sm:min-w-52">
                  {manages ? (
                    <Link
                      href={`/programs/${row.id}`}
                      transitionTypes={["nav-forward"]}
                      className="font-medium text-ink hover:text-brand"
                    >
                      {row.name}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">{row.name}</span>
                  )}
                </Td>
                <Td label="Students" align="right" className="tabular-nums">
                  {row.students}
                </Td>
                <Td
                  label="Completed"
                  align="right"
                  className="font-semibold tabular-nums text-ink"
                >
                  {formatDuration(row.delivered)}
                </Td>
                <Td
                  label="Missed"
                  align="right"
                  className={cn(
                    "tabular-nums",
                    row.missed > 0 ? "text-warn-ink" : "text-muted-fg"
                  )}
                >
                  {row.missed > 0 ? formatDuration(row.missed) : "—"}
                </Td>
                <Td label="Total" align="right" className="tabular-nums">
                  {formatDuration(row.allocated)}
                </Td>
                <Td
                  label="Remaining"
                  align="right"
                  className={cn(
                    "font-medium tabular-nums",
                    // The tone this table lost in the palette sweep: without it
                    // an overdrawn program reads in plain ink, exactly like one
                    // in credit.
                    row.remaining < 0 ? "text-danger-ink" : "text-ink"
                  )}
                >
                  {formatDuration(row.remaining)}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>

      <Section
        eyebrow="Holding time from them"
        title="Students"
        count={holders.length || undefined}
      >
        {holders.length === 0 ? (
          <EmptyState framed={false} title="Nobody holds their time">
            An admin allocates a student time from a mentor, on the
            student&apos;s own page.
          </EmptyState>
        ) : (
          /*
            REDESIGN.md §5.2 gives `AllocationRow` a `person="mentor|student"`
            prop for exactly this table; the component that shipped only draws
            the mentor, and its first column is headed "Mentor". So the columns
            below are AllocationRow's, in its order, so that the prop can
            replace this block without moving a value.
          */
          <Table framed={false} columns={studentColumns}>
            {holders.map((s, i) => (
              <Tr
                key={s.student.id}
                className="deal-in"
                style={{ animationDelay: `${Math.min(i, 14) * 24}ms` }}
              >
                <Td>
                  <PersonCell
                    person={{
                      id: s.student.user.id,
                      name: s.student.user.name,
                      email: s.student.user.email,
                      avatarUpdatedAt: s.student.user.avatarUpdatedAt,
                    }}
                    href={`/students/${s.student.id}`}
                    // The program rides here rather than in a seventh column:
                    // a table stacks to one labelled line per field on a phone,
                    // and six is the cap.
                    secondary={`${s.student.user.email} · ${s.program.name}`}
                  >
                    {s.student.user.status === USER_STATUS.PENDING && (
                      <span className="shrink-0 text-xs font-normal text-warn-ink">
                        Pending approval
                      </span>
                    )}
                  </PersonCell>
                </Td>
                <Td label="Completed" align="right" className="tabular-nums">
                  {formatDuration(s.completed)}
                </Td>
                <Td
                  label="Missed"
                  align="right"
                  className={cn(
                    "tabular-nums",
                    s.missed > 0 ? "text-warn-ink" : "text-muted-fg"
                  )}
                >
                  {s.missed > 0 ? formatDuration(s.missed) : "—"}
                </Td>
                <Td
                  label="Remaining"
                  align="right"
                  className={cn(
                    "font-medium tabular-nums",
                    s.remaining < 0 ? "text-danger-ink" : "text-ink"
                  )}
                >
                  {formatDuration(s.remaining)}
                </Td>
                <Td
                  label="Assigned"
                  align="right"
                  className="tabular-nums text-muted-fg"
                >
                  {formatDuration(s.allocated)}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>

      {/*
        Ten rows and a way to the rest. The window above narrows this log too,
        so the count says what the period holds and the link drops the period
        entirely: `/sessions` is the whole ledger, filtered to this mentor, and
        a reader who wants more than ten rows is past the point where a
        ninety-day default is helping them.
      */}
      <SessionsLog
        sessions={entries.slice(0, LOG_LIMIT)}
        viewer={context}
        title="Recent sessions"
        // No eyebrow: the component's default is "Logged by mentors", one of
        // the provenance labels §5.7 retires, and "Time" is already the eyebrow
        // on the section above.
        eyebrow={null}
        moreHref={`/sessions?mentor=${mentor.id}`}
        moreLabel="All sessions"
        // The shared tally, not a row count: it excludes voided and rescheduled
        // rows, which are history and not hours. Counting the rows instead said
        // "1 session" above a log holding one voided line, beside a Delivered
        // figure of zero.
        caption={
          entries.length > LOG_LIMIT
            ? `${sessionsCaption(entries)} · showing ${LOG_LIMIT}`
            : sessionsCaption(entries)
        }
        empty={
          <EmptyState framed={false} title="No sessions in this period">
            {period === "all"
              ? "This mentor has logged none at all."
              : "Widen the period above to see older ones."}
          </EmptyState>
        }
      />

      {rated ? (
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-fg">
          <span className="text-lg font-bold tabular-nums text-ink">
            {feedback._avg.rating!.toFixed(1)}
          </span>
          <span>
            from {feedback._count}{" "}
            {feedback._count === 1 ? "rating" : "ratings"}
          </span>
          {/* A mentor's own address for this is the bare page — /feedback
              already answers with their ratings and nobody else's. */}
          <ArrowLink
            href={isSelf ? "/feedback" : `/feedback?mentor=${mentor.id}`}
            className="text-[0.8125rem]"
          >
            Read them
          </ArrowLink>
        </p>
      ) : (
        <p className="text-sm text-muted-fg">
          No ratings written{isSelf ? " about you" : ""} so far.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- card --- */

/**
 * The page that says yes.
 *
 * A student deciding whether to book, or a colleague who works alongside them:
 * a face, the programs they share, and one way in per pairing. What it replaces
 * was fifty-six words that said "Book a session" three times and then, in a
 * dashed placeholder, said no.
 *
 * The scoping is the other half. A student sees ONLY the pairings covering
 * their own program or cohort, and a mentor from a program they are not in is
 * indistinguishable from one who does not exist. A colleague sees only the
 * programs the two of them share — the old page showed a mentor every program
 * every other mentor worked in.
 *
 * And a student is handed the calendar only where they hold time with this
 * mentor, in that pairing's program. Sharing a program is not a grant: this
 * card was how students with none of a mentor's hours were booking them.
 */
async function MentorCard({
  mentor,
  viewer,
  isStudent,
}: {
  mentor: User;
  viewer: User;
  isStudent: boolean;
}) {
  let visible;
  // Programs where a calendar may be offered. Null for a colleague, who books
  // nobody and may see every shared link.
  let bookableIn: Set<string> | null = null;
  if (isStudent) {
    const profile = await prisma.studentProfile.findUnique({
      where: { userId: viewer.id },
      include: { enrollments: { select: { programId: true, cohortId: true } } },
    });
    // Not onboarded, or not approved yet — their home says what is next.
    if (!profile || viewer.status !== USER_STATUS.ACTIVE) redirect("/student");
    const [pairings, hours] = await Promise.all([
      prisma.mentorAssignment.findMany({
        where: { mentorId: mentor.id, ...assignmentsForStudentWhere(profile) },
        include: { program: true, cohort: true },
        orderBy: { createdAt: "asc" },
      }),
      allocationSummary(profile.id),
    ]);
    visible = pairings;
    bookableIn = new Set(
      hours.perMentor.flatMap((h) =>
        h.mentor?.id === mentor.id && canBookOn(h) ? [h.program.id] : []
      )
    );
  } else {
    // A colleague: the programs both of them work in, and nothing else.
    const mine = await prisma.mentorAssignment.findMany({
      where: { mentorId: viewer.id },
      select: { programId: true },
    });
    const shared = new Set(mine.map((a) => a.programId));
    visible = (await mentorAssignments(mentor.id)).filter((a) =>
      shared.has(a.programId)
    );
  }
  if (visible.length === 0) notFound();

  const name = mentor.name ?? mentor.email;
  const first = mentor.name?.split(" ")[0] ?? name;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle
        backHref={isStudent ? "/student/book" : undefined}
        backLabel={isStudent ? "Book" : undefined}
        eyebrow="Mentor"
        title={name}
        subtitle={visible.map(labelOf).join(" · ")}
        leading={
          <Avatar
            person={mentor}
            alt={`${name}'s profile picture`}
            className="h-20 w-20 text-3xl sm:h-24 sm:w-24"
          />
        }
      />

      <ul className="space-y-2">
        {visible.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface shadow-sm px-4 py-2"
          >
            {/* Named only when there is a choice to make. One pairing is
                already named in the line under the h1, and a page of twenty
                words cannot afford to say "Master's Program" twice. */}
            {visible.length > 1 && (
              <span className="min-w-0 text-sm font-medium text-ink">
                {labelOf(a)}
              </span>
            )}
            {a.calendlyUrl && (!bookableIn || bookableIn.has(a.programId)) ? (
              <ExternalLink variant="action" href={a.calendlyUrl}>
                Book {first}
              </ExternalLink>
            ) : (
              /* Never a dashed placeholder: a pairing with no booking link, or
                 a student with no time left to book on it, still has a person
                 behind it, so the page hands over the way to reach them
                 instead of announcing a missing setting. */
              <ExternalLink variant="chip" href={`mailto:${mentor.email}`}>
                {mentor.email}
              </ExternalLink>
            )}
          </li>
        ))}
      </ul>

      {isStudent && (
        // Straight to the form with this mentor chosen: the student has just
        // said who they mean by opening this page.
        <ArrowLink href={`/student/feedback?mentor=${mentor.id}`}>Rate {first}</ArrowLink>
      )}
    </div>
  );
}
