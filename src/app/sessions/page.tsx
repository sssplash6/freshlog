import { SessionRowActions } from "@/components/forms/session-forms";
import { SessionsList, toSessionEntries } from "@/components/session-row";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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
  filterSummary,
  readDateWindow,
  readParam,
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
import { profileOf } from "@/lib/profile";
import { taskOptionsForSessions } from "@/lib/queries";

/**
 * The ledger: what has been delivered.
 *
 * It had a second tab for what was still in the diary. Scheduling is gone from
 * the product entirely, so there is one list again — and it lives here rather
 * than under `/mentor/sessions`, an address that said "one mentor" about a page
 * the whole school reads.
 *
 * Which rows exist is the reader's grants and reach. The lens only decides
 * whether "Mine" is on when you arrive.
 */
export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const lens = await profileOf(user);
  const scope = await adminScope(user);
  const programIds = scopeProgramFilter(scope);
  const administers = scope === "ALL" || scope.size > 0;
  const isMentor = canActAsMentor(user);

  const params = await searchParams;
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
      <Header lens={lens} />
      {filters}

      <p className="text-sm text-muted-fg">
        <span className="font-semibold tabular-nums text-ink">
          {formatDuration(logged)}
        </span>{" "}
        logged
        {missed > 0 && ` · ${formatDuration(missed)} missed`}
        {extra > 0 && ` · ${formatDuration(extra)} extra`}
        {" · "}
        {filterSummary(total, { one: "session", many: "sessions" }, params)}
      </p>

      {total === 0 ? (
        activeFilterCount(params) > 0 ? (
          <EmptyState variant="no-results">
            Reset the filters to see the rest.
          </EmptyState>
        ) : (
          <EmptyState title="Nothing logged yet">
            A mentor logs each meeting once it has happened.
          </EmptyState>
        )
      ) : (
        <>
          <SessionsList
            sessions={toSessionEntries(sessions, {
              mentorBase: "/mentors",
              studentBase: "/students",
            })}
            viewer={viewer}
            renderActions={(row) =>
              administers || row.mentor.id === user.id ? (
                <SessionRowActions
                  session={{
                    id: row.id,
                    minutes: row.minutes,
                    date: toDateInputValue(row.date),
                    // `attendanceOf`, not a hand-rolled ternary. This spelt
                    // the absent state "NO_SHOW", which is not a value in
                    // `ATTENDANCE` — so `readAttendance` did not recognise it,
                    // the picker opened a no-show row on "Attended", and
                    // saving without touching it turned the no-show into an
                    // attended session.
                    attendance: attendanceOf(row),
                    timeKind: timeKindOf(row),
                    note: row.note,
                    assignmentId: row.task?.id ?? null,
                  }}
                  goals={tasksBySession[row.id] ?? []}
                  canEdit={row.status !== SESSION_STATUS.VOIDED}
                  canDelete={administers}
                />
              ) : null
            }
          />
          <Pagination
            basePath="/sessions"
            params={params}
            page={page}
            total={total}
            unit="sessions"
          />
        </>
      )}
    </div>
  );
}

/** The title and the one action, shared by both tabs. */
function Header({ lens }: { lens: "admin" | "mentor" }) {
  return (
    <PageTitle
      title="Sessions"
      actions={
        <LinkButton
          href="/sessions/new"
          variant={lens === "mentor" ? "primary" : "secondary"}
          size="md"
        >
          Log a session
        </LinkButton>
      }
    />
  );
}
