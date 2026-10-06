import { notFound, redirect } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { BookingLinksForm } from "@/components/forms/booking-link-form";
import { EditMentorForm } from "@/components/forms/mentor-forms";
import { AvatarForm, OwnNameForm } from "@/components/forms/profile-forms";
import { CreateButton, CreatePanel, CreateSlot } from "@/components/page-create";
import { PersonCell } from "@/components/person-chip";
import { ProgramChip } from "@/components/program-chip";
import { HoursLeft } from "@/components/ui/hours-left";
import { StatusChip } from "@/components/ui/status-chip";
import { SessionsLog } from "@/components/session-row";
import { toSessionEntries } from "@/lib/session-entries";
import { Disclosure } from "@/components/ui/disclosure";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DateField } from "@/components/ui/date-field";
import { Figure, FigureRow } from "@/components/ui/figure";
import { ArrowLink, ExternalLink } from "@/components/ui/link";
import { PageTitle, Section } from "@/components/ui/section";
import { TabLinks } from "@/components/ui/segmented";
import { FILL_CELL, Table, Td, Tr, type Column } from "@/components/ui/table";
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
import { mentorWindow } from "@/lib/mentor-window";
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
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Mentor" };

/** Sessions shown under the record; the figures above them stay complete. */
const LOG_LIMIT = 10;

/** "Global Admissions / Spring 25", "Research / Advanced", or just the program name. */
function labelOf(a: {
  program: { name: string };
  level: { name: string } | null;
  cohort: { name: string } | null;
}): string {
  return [a.program.name, a.level?.name, a.cohort?.name]
    .filter(Boolean)
    .join(" / ");
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

  const win = mentorWindow(query, now);
  // The date fields open for a typed range, and for the Custom tab before
  // anything is typed — an empty pair of fields is how it asks for one.
  const choosingDates = win.kind === "custom" || readParam(query, "period") === "custom";

  const [allPairings, overview, feedback, pickerPrograms] = await Promise.all([
    mentorAssignments(mentor.id),
    mentorOverview(mentor.id, { from: win.from, to: win.to }),
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
  // Every program the header names gets a row, even one with nothing in it
  // yet. The header listed "efde" and the table did not, so the two halves of
  // the page disagreed about where this mentor works.
  const listed = new Set(byProgram.map((row) => row.id));
  const idle = [
    ...new Map(
      pairings
        .filter((a) => !listed.has(a.programId))
        .map((a) => [a.programId, { id: a.programId, name: a.program.name, colorIndex: a.program.colorIndex }])
    ).values(),
  ];
  const sum = (pick: (row: (typeof byProgram)[number]) => number) =>
    byProgram.reduce((total, row) => total + pick(row), 0);
  // The program table is the Students ledger summed by program — every
  // session ever logged against these grants, whatever the window above. Its
  // Completed and Missed were the window's while its Total and Remaining were
  // the ledger's, so under "30 days" a row read 2h completed of 40h with 10h
  // remaining and could not be made to add up.
  const ledger = byProgram.map((row) => {
    const held = students.filter((s) => s.program.id === row.id);
    const total = (pick: (s: (typeof held)[number]) => number) =>
      held.reduce((sum, s) => sum + pick(s), 0);
    return { ...row, completedAll: total((s) => s.completed), missedAll: total((s) => s.missed) };
  });
  const programMissed = ledger.some((r) => r.missedAll > 0);
  const programExpired = ledger.some((r) => r.forfeited > 0);
  // A mentor reading their own record gets it without the student's rating
  // or note — anonymous to them, and stripped before the payload, not hidden
  // after it.
  const entries = toSessionEntries(sessions, {
    studentBase: "/students",
    feedback: !isSelf,
  });
  const delivered = sum((r) => r.delivered);
  const missed = sum((r) => r.missed);
  const meetings = sum((r) => r.sessions);
  const name = mentor.name ?? mentor.email;
  const rated = feedback._count > 0 && feedback._avg.rating != null;
  const base = `/mentors/${mentor.id}`;

  // `AllocationRow`'s columns, in its order — see the comment on the table
  // below. Delivered, wasted, left, and the size of the grant last.
  //
  // "Granted", not "Assigned", as on the student's page: the grant alone, so
  // completed + missed + remaining (+ expired, under remaining) is the figure
  // in the last column and the row can be checked by adding it up.
  const studentColumns: Column[] = [
    { label: "Student" },
    { label: "Completed", align: "right" },
    { label: "Missed", align: "right" },
    { label: "Remaining", align: "right", emphasis: "key" },
    { label: "Total", align: "right" },
  ];

  // Soonest use-by first: the row at the top is the time about to be lost.
  const holders = [...students].sort(
    (a, b) => (a.deadline?.getTime() ?? 0) - (b.deadline?.getTime() ?? 0)
  );

  return (
    <CreateSlot>
    <div className="space-y-4">
      <div className="space-y-2">
        {/* The same masthead the student's page has: face, name, the facts
            under it, and the one change control in the title's actions. It
            had a "Mentor" eyebrow nobody needed on a page reached from
            Mentors, and its Edit was a fold under the header while the
            student's was a pencil beside the name. */}
        <PageTitle
          backHref={manages ? "/mentors" : undefined}
          backLabel={manages ? "Mentors" : undefined}
          title={name}
          subtitle={
            /*
              Programs, each carrying whether a student can book through it.
              This is the ONLY place that says WHICH pairing has no link — the
              attention row says that one is missing, and a mentor in three
              programs with one link needs to know which. A chip with its
              glyph, not amber text in brackets: colour alone was the only
              thing marking it.
            */
            <>
              <span className="block">
                {mentor.email} · registered {formatDate(mentor.createdAt)}
              </span>
              {pairings.length > 0 && (
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {pairings.map((a) => (
                    // `max-w-full flex-wrap`: a pairing is a program, its cohort and
                    // a chip, and with a long program name the row was wider than
                    // a phone — the chip broke one letter per line and the page
                    // scrolled sideways.
                    <span key={a.id} className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1">
                      <ProgramChip program={a.program} className="text-sm text-ink" />
                      {a.level || a.cohort ? (
                        <span>/ {[a.level?.name, a.cohort?.name].filter(Boolean).join(" / ")}</span>
                      ) : null}
                      {!a.calendlyUrl && (
                        <StatusChip severity="attention" className="shrink-0 whitespace-nowrap">No booking link</StatusChip>
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
          actions={edits ? <CreateButton label="Edit" icon="edit" /> : undefined}
        />

        {edits && (
          <CreatePanel title="Edit mentor" hint="Their name, sign-in email and programs.">
            <EditMentorForm
              mentorId={mentor.id}
              name={mentor.name ?? ""}
              email={mentor.email}
              targets={pairings.map((a) =>
                a.cohortId
                  ? `c:${a.cohortId}`
                  : a.levelId
                    ? `l:${a.levelId}`
                    : `p:${a.programId}`
              )}
              programs={toProgramOptions(pickerPrograms)}
              // `updateMentor` refuses a name or email change from anybody but
              // a platform admin: once admins are peers, whoever can repoint
              // another admin's sign-in can become them.
              canEditIdentity={viewer.platformAdmin}
            />
          </CreatePanel>
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
              <Section title="Picture and name">
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

      {/* "Time", not "Completed" over a "Completed" eyebrow-and-figure: the
          lead figure's own label already says what it counts. */}
      <Section
        title="Time"
        action={
          <TabLinks
            label="Period"
            items={[
              { href: `${base}?period=30d`, label: "30 days" },
              // The bare address IS ninety days, so a link to this page and the
              // default view are the same URL.
              { href: base, label: "90 days" },
              { href: `${base}?period=all`, label: "All" },
              { href: `${base}?period=custom`, label: "Custom" },
            ]}
          />
        }
      >
        {choosingDates && (
          // A plain GET form: the range lives in the address, so a link to this
          // page is a link to exactly the days being read. `period=custom` is
          // what keeps the Custom tab lit once the dates are in.
          <form
            method="get"
            action={base}
            className="flex flex-wrap items-end gap-2 px-4 pt-3 sm:px-5"
          >
            <input type="hidden" name="period" value="custom" />
            <label className="min-w-0 flex-1 text-sm sm:w-40 sm:flex-none">
              <span className="block text-muted-fg">From</span>
              <DateField
                name="from"
                label="Completed from"
                defaultValue={win.fromValue}
              />
            </label>
            <label className="min-w-0 flex-1 text-sm sm:w-40 sm:flex-none">
              <span className="block text-muted-fg">To</span>
              <DateField
                name="to"
                label="Completed to"
                defaultValue={win.toValue}
              />
            </label>
            <Button type="submit" size="md">
              Apply
            </Button>
          </form>
        )}
        <div className="px-4 sm:px-5">
          <FigureRow framed={false} className="py-3">
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
          {/* Said once, here: a balance is what is owed after every session
              ever logged, so no reporting range can move it — and the Students
              list is that ledger, grant by grant, not a report. */}
          <p className="pb-3 text-xs text-muted-fg">
            The tables below count every session ever logged, whatever the range.
          </p>
        </div>

        {byProgram.length === 0 && idle.length === 0 ? (
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
              // What has gone, what is left, then the grant they add up to.
              // Missed and Expired take a column only when a row has some.
              ...(programMissed ? [{ label: "Missed", align: "right" } as Column] : []),
              ...(programExpired ? [{ label: "Expired", align: "right" } as Column] : []),
              { label: "Remaining", align: "right", emphasis: "key" },
              { label: "Total", align: "right" },
            ]}
          >
            {ledger.map((row, i) => (
              <Tr
                key={row.id}
                className="deal-in"
                style={{ animationDelay: `${Math.min(i, 14) * 24}ms` }}
              >
                <Td className="sm:min-w-52">
                  {/* The program the way every roster draws one: its dot and
                      its name. Bare bold text here was the third look a
                      program had on one page. */}
                  <ProgramChip
                    program={row}
                    href={manages ? `/programs/${row.id}` : undefined}
                    className="font-semibold"
                  />
                </Td>
                <Td label="Students" align="right" className="tabular-nums">
                  {row.students}
                </Td>
                <Td
                  label="Completed"
                  align="right"
                  className="tabular-nums"
                >
                  {formatDuration(row.completedAll)}
                </Td>
                {/* Plain ink. The heading says what it is; amber with no
                    word or glyph beside it was colour alone saying "bad". */}
                {programMissed && (
                  <Td
                    label="Missed"
                    align="right"
                    className={cn("tabular-nums", row.missedAll > 0 ? "text-ink" : "text-muted-fg")}
                  >
                    {row.missedAll > 0 ? formatDuration(row.missedAll) : "—"}
                  </Td>
                )}
                {programExpired && (
                  <Td label="Expired" align="right" tone="muted" className="tabular-nums">
                    {row.forfeited > 0 ? formatDuration(row.forfeited) : "—"}
                  </Td>
                )}
                <Td label="Remaining" align="right" className="tabular-nums">
                  {/* Red when overdrawn, and a meter of the total's burn. */}
                  <HoursLeft
                    remaining={row.remaining}
                    used={Math.max(row.allocated - row.remaining - row.forfeited, 0)}
                    expired={row.forfeited}
                  />
                </Td>
                <Td label="Total" align="right" tone="muted" className="tabular-nums">
                  {formatDuration(row.allocated)}
                </Td>
              </Tr>
            ))}
            {idle.map((p) => (
              <Tr key={p.id}>
                <Td className="sm:min-w-52">
                  <ProgramChip
                    program={p}
                    href={manages ? `/programs/${p.id}` : undefined}
                    className="font-semibold"
                  />
                  <span className="block text-xs text-muted-fg">Nothing granted or logged yet</span>
                </Td>
                <Td label="Students" align="right" tone="muted">—</Td>
                <Td label="Completed" align="right" tone="muted">—</Td>
                {programMissed && <Td label="Missed" align="right" tone="muted">—</Td>}
                {programExpired && <Td label="Expired" align="right" tone="muted">—</Td>}
                <Td label="Remaining" align="right" tone="muted">—</Td>
                <Td label="Total" align="right" tone="muted">—</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>

      <Section
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
          <Table framed={false} columns={studentColumns} label="Students with time on this mentor">
            {holders.map((s, i) => (
              <Tr
                key={s.student.id}
                className="deal-in"
                style={{ animationDelay: `${Math.min(i, 14) * 24}ms` }}
              >
                <Td className={FILL_CELL}>
                  <PersonCell
                    person={{
                      id: s.student.user.id,
                      name: s.student.user.name,
                      email: s.student.user.email,
                      avatarUpdatedAt: s.student.user.avatarUpdatedAt,
                    }}
                    href={`/students/${s.student.id}?from=${s.program.id}`}
                    // The program rides here rather than in a seventh column:
                    // a table stacks to one labelled line per field on a phone,
                    // and six is the cap.
                    secondary={`${s.student.user.email} · ${s.program.name}`}
                  >
                    {s.student.user.status === USER_STATUS.PENDING && (
                      <StatusChip severity="attention" className="shrink-0">
                        Pending approval
                      </StatusChip>
                    )}
                  </PersonCell>
                </Td>
                <Td label="Completed" align="right" className="tabular-nums">
                  {formatDuration(s.completed)}
                </Td>
                <Td
                  label="Missed"
                  align="right"
                  className={cn("tabular-nums", s.missed > 0 ? "text-ink" : "text-muted-fg")}
                >
                  {s.missed > 0 ? formatDuration(s.missed) : "—"}
                </Td>
                <Td label="Remaining" align="right" className="tabular-nums">
                  <HoursLeft
                    remaining={s.remaining}
                    used={Math.max(s.allocated - s.remaining - s.forfeited, 0)}
                    expired={s.forfeited}
                  />
                  {/* Expired time is part of the grant, so it is named here
                      or the row would not add up to the Total figure. */}
                  {s.forfeited > 0 && (
                    <span className="block text-xs font-normal text-danger-ink">
                      {formatDuration(s.forfeited)} expired
                    </span>
                  )}
                </Td>
                <Td
                  label="Total"
                  align="right"
                  tone="muted"
                  className="tabular-nums"
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
        // the provenance labels §5.7 retires.
        eyebrow={null}
        moreHref={`/sessions?mentor=${mentor.id}`}
        moreLabel="All sessions"
        empty={
          <EmptyState framed={false} title="No sessions in this period">
            {win.kind === "all"
              ? "This mentor has logged none at all."
              : "Widen the period above to see older ones."}
          </EmptyState>
        }
      />

      {/* A group like every other, rather than a loose line under the last
          card: one row, the figure leading and the way to the words trailing. */}
      <Section title="Ratings" count={rated ? feedback._count : undefined}>
        {rated ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
            <p className="flex items-baseline gap-x-2 text-body text-muted-fg">
              <span className="text-figure-md font-semibold tabular-nums text-ink">
                {feedback._avg.rating!.toFixed(1)}
              </span>
              <span>
                from {feedback._count}{" "}
                {feedback._count === 1 ? "rating" : "ratings"}
              </span>
            </p>
            {/* A mentor's own address for this is the bare page — /feedback
                already answers with their ratings and nobody else's. */}
            <ArrowLink
              href={isSelf ? "/feedback" : `/feedback?mentor=${mentor.id}`}
              className="text-body"
            >
              {feedback._count === 1 ? "Read it" : "Read them"}
            </ArrowLink>
          </div>
        ) : (
          <p className="px-4 py-3 text-body text-muted-fg sm:px-5">
            No ratings written{isSelf ? " about you" : ""} so far.
          </p>
        )}
      </Section>
    </div>
    </CreateSlot>
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
      include: {
        enrollments: { select: { programId: true, levelId: true, cohortId: true } },
      },
    });
    // Not onboarded, or not approved yet — their home says what is next.
    if (!profile || viewer.status !== USER_STATUS.ACTIVE) redirect("/student");
    const [pairings, hours] = await Promise.all([
      prisma.mentorAssignment.findMany({
        where: { mentorId: mentor.id, ...assignmentsForStudentWhere(profile) },
        include: { program: true, cohort: true, level: true },
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

      {/* One grouped card with a row per pairing, not a stack of cards. */}
      <ul className="divide-y divide-line overflow-clip rounded-xl bg-surface shadow-sm">
        {visible.map((a) => (
          <li
            key={a.id}
            className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
          >
            {/* Named only when there is a choice to make. One pairing is
                already named in the line under the h1, and a page of twenty
                words cannot afford to say "Master's Program" twice. */}
            {visible.length > 1 && (
              <span className="min-w-0 text-body font-medium text-ink">
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
