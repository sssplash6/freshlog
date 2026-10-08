import { SessionRowActions } from "@/components/forms/session-forms";
import { SessionsList } from "@/components/session-row";
import { toSessionEntries } from "@/lib/session-entries";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLink } from "@/components/ui/link";
import { FilterBar } from "@/components/ui/filter-bar";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { PageTitle } from "@/components/ui/section";
import { adminScope, scopeProgramFilter } from "@/lib/authz";
import {
  ATTENDANCE_OPTIONS,
  KIND_OPTIONS,
  SESSION_STATUS_OPTIONS,
  DATE_PRESETS,
  MINE_PRESET,
  activeFilterCount,
  filterHref,
  filterSummary,
  readDateWindow,
  readParam,
  resetHref,
  sessionsWhere,
  type SearchParams,
} from "@/lib/filters";
import {
  SESSION_STATUS,
  attendanceOf,
  canActAsMentor,
  timeKindOf,
} from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import { formatDuration, toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { taskOptionsForSessions } from "@/lib/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sessions" };

/**
 * The ledger: what has been delivered.
 *
 * It had a second tab for what was still in the diary. Scheduling is gone from
 * the product entirely, so there is one list again — and it lives here rather
 * than under `/mentor/sessions`, an address that said "one mentor" about a page
 * the whole school reads.
 *
 * Which rows exist is the reader's grants and reach. The lens only decides
 * whether "Mine" is offered.
 */
export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const scope = await adminScope(user);
  const programIds = scopeProgramFilter(scope);
  const administers = scope === "ALL" || scope.size > 0;
  const isMentor = canActAsMentor(user);

  const params = await searchParams;
  // The form's Back returns here (`back=sessions`), to this program's list
  // when one is picked — the form then offers that program's people too. It
  // said "Home", and an admin who had filtered to their program lost it.
  const listedProgram = readParam(params, "program");
  const logHref = `/sessions/new?back=sessions${
    listedProgram ? `&program=${encodeURIComponent(listedProgram)}` : ""
  }`;
  const page = parsePage(readParam(params, "page"));
  const now = new Date();
  // Somebody who only mentors sees their own rows and no others, whatever the
  // URL says; an admin sees the programs they were granted. The tab and the
  // "Mine" chip narrow inside that and can never widen it.
  const reach = administers
    ? { audience: "staff" as const, userId: user.id, programIds }
    : { audience: "mentor" as const, userId: user.id, mentorId: user.id };
  const viewer = { audience: reach.audience, userId: user.id, now };

  // The programs this reader may filter by. One is not a choice — the whole
  // list is already that program — so the select only appears for somebody who
  // holds more than one, exactly as on /students and /mentors.
  const programs = administers
    ? await prisma.program.findMany({
        where: programIds ? { id: { in: [...programIds] } } : {},
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];
  const programSelect =
    programs.length > 1
      ? [
          {
            name: "program",
            label: "Program",
            all: "All programs",
            options: programs.map((p) => ({ value: p.id, label: p.name })),
          },
        ]
      : [];

  const filters = (
    <FilterBar
      basePath="/sessions"
      params={params}
      q="sessions"
      dateRange={readDateWindow(params, now)}
      selects={
        [
              ...programSelect,
              {
                name: "attendance",
                label: "Attendance",
                all: "Any attendance",
                options: ATTENDANCE_OPTIONS,
              },
              { name: "kind", label: "Kind", all: "Any kind", options: KIND_OPTIONS },
              {
                name: "status",
                label: "Status",
                all: "Any status",
                options: SESSION_STATUS_OPTIONS,
              },
            ]
      }
      presets={[
        // Offered only to a reader who has more than their own rows to see.
        ...(administers && isMentor ? [MINE_PRESET] : []),
        ...DATE_PRESETS,
      ]}
      summary={undefined}
    />
  );

  const where = sessionsWhere(params, reach, now);
  const [sessions, total, sums] = await Promise.all([
    prisma.session.findMany({
      where,
      include: {
        mentor: true,
        program: true,
        student: { include: { user: true } },
        assignment: { select: { id: true, purpose: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.session.count({ where }),
    // The headline reads the whole filtered set, not the page. A total that
    // describes 25 rows under a filter matching 300 is the bug this replaces.
    prisma.session.groupBy({
      by: ["attended", "withinPlan"],
      where: { AND: [where, { status: SESSION_STATUS.ACTIVE }] },
      _sum: { minutes: true },
    }),
  ]);
  const tasksBySession = await taskOptionsForSessions(sessions);
  // Which program a row counted against, for a reader who holds more than one
  // — the row's OWN program (AGENTS.md: ask the row, not the student). With one
  // program the whole list is that program and the label would repeat on
  // every line. A mentor reading their own log gets the record without the
  // student's rating or note: those are anonymous to them.
  const multiProgram = programs.length > 1;
  const entries = toSessionEntries(
    sessions.map((s) =>
      multiProgram && s.student
        ? { ...s, student: { ...s.student, program: s.program } }
        : s,
    ),
    {
      mentorBase: "/mentors",
      studentBase: "/students",
      feedback: reach.audience !== "mentor",
    },
  );
  // Rendered here rather than by a callback the list runs: `SessionsList` is a
  // client component, and a function prop is not something that survives the
  // crossing. An element is.
  const rowActions = Object.fromEntries(
    entries.map((row) => [
      row.id,
      administers || row.mentor.id === user.id ? (
        <SessionRowActions
          session={{
            id: row.id,
            minutes: row.minutes,
            date: toDateInputValue(row.date),
            // `attendanceOf`, not a hand-rolled ternary. This spelt the absent
            // state "NO_SHOW", which is not a value in `ATTENDANCE` — so
            // `readAttendance` did not recognise it, the picker opened a
            // no-show row on "Attended", and saving without touching it turned
            // the no-show into an attended session.
            attendance: attendanceOf(row),
            timeKind: timeKindOf(row),
            note: row.note,
            assignmentId: row.task?.id ?? null,
          }}
          goals={tasksBySession[row.id] ?? []}
          canEdit={row.status !== SESSION_STATUS.VOIDED}
          canDelete={administers}
          student={row.student ? (row.student.name ?? row.student.email) : null}
          mentor={row.mentor.name ?? row.mentor.email}
        />
      ) : null,
    ]),
  );

  // Every row in `sums` is already ACTIVE, so what is left of the charging
  // rule is the plan flag: out-of-plan time was delivered and charges nothing.
  const logged = sums
    .filter((r) => r.withinPlan)
    .reduce((sum, r) => sum + (r._sum.minutes ?? 0), 0);
  const missed = sums
    .filter((r) => !r.attended && r.withinPlan)
    .reduce((sum, r) => sum + (r._sum.minutes ?? 0), 0);
  const extra = sums
    .filter((r) => !r.withinPlan)
    .reduce((sum, r) => sum + (r._sum.minutes ?? 0), 0);

  return (
    <div className="space-y-4">
      <Header logHref={logHref} />
      {filters}

      {/* One figure leads — what was logged — and the rest is its caption.
          It was four figures at one size (Logged, Missed, Extra, Sessions),
          the strip DESIGN.md retired: four equal numbers are four questions
          and no answer, and on a phone the 2 × 2 grid took 250px before the
          first row. Reads the whole filtered set, never the page — and is not
          drawn over an empty result, where it was four zeroes above "No
          sessions match". */}
      {total > 0 && (
        <div className="px-1" aria-live="polite">
          <p className="text-xs text-muted-fg">Logged</p>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-figure-md font-semibold leading-tight tabular-nums text-ink">
              {formatDuration(logged)}
            </span>
            <span className="text-xs tabular-nums text-muted-fg">
              {/* What the filters did, in words, when any are on; otherwise
                  the plain count. Never both — the count is inside the
                  summary. */}
              {activeFilterCount(params) > 0
                ? filterSummary(total, { one: "session", many: "sessions" }, params)
                : `${total} ${total === 1 ? "session" : "sessions"}`}
              {missed > 0 && ` · ${formatDuration(missed)} missed`}
              {extra > 0 && ` · ${formatDuration(extra)} extra`}
            </span>
          </p>
        </div>
      )}

      {total === 0 ? (
        activeFilterCount(params) > 0 ? (
          // Says what came back empty — the words typed, or the filters —
          // and offers the ways forward, not only the one that undoes
          // everything: drop the search and keep the filters, drop the
          // filters, or log the session that is not here yet.
          <EmptyState
            variant="no-results"
            title={filterSummary(0, { one: "session", many: "sessions" }, params)}
            action={
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
                {readParam(params, "q") && (
                  <ArrowLink
                    href={filterHref("/sessions", params, { q: undefined })}
                    className="text-xs"
                  >
                    {activeFilterCount(params) > 0 ? "Clear the search" : "Show every session"}
                  </ArrowLink>
                )}
                {(activeFilterCount(params) > 1 || !readParam(params, "q")) && (
                  <ArrowLink
                    href={resetHref("/sessions", params)}
                    className="text-xs"
                  >
                    Reset all filters
                  </ArrowLink>
                )}
                <ArrowLink href={logHref} className="text-xs">
                  Log a session
                </ArrowLink>
              </div>
            }
          >
            {readParam(params, "q")
              ? "Check the spelling, search a student or mentor by name, or widen the filters."
              : "Widen the dates or attendance, or reset to see every session."}
          </EmptyState>
        ) : (
          <EmptyState title="Nothing logged yet">
            A mentor logs each meeting once it has happened.
          </EmptyState>
        )
      ) : (
        <>
          <SessionsList sessions={entries} viewer={viewer} actions={rowActions} />
          {/* Only when there is a second page. On one page its "21 sessions"
              repeated the count the headline had just given. */}
          {total > PAGE_SIZE && (
            <Pagination
              basePath="/sessions"
              params={params}
              page={page}
              total={total}
              unit="sessions"
              className="px-1"
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * The title and the one action — full width on a phone, as on Home, so the
 * same button is the same shape on both pages a mentor logs from.
 */
function Header({ logHref }: { logHref: string }) {
  return (
    <PageTitle
      title="Sessions"
      actions={
        <LinkButton
          href={logHref}
          variant="primary"
          size="md"
          className="w-full sm:w-auto"
        >
          Log a session
        </LinkButton>
      }
    />
  );
}
