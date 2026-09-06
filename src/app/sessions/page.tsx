import { SessionRowActions } from "@/components/forms/session-forms";
import { MeetingRowActions } from "@/components/forms/meeting-forms";
import { SessionsTable, toSessionEntries } from "@/components/session-row";
import { Timeline, type TimelineEntry } from "@/components/timeline";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { PageTitle } from "@/components/ui/section";
import { TabLinks } from "@/components/ui/segmented";
import { adminScope, scopeProgramFilter } from "@/lib/authz";
import {
  ATTENDANCE_OPTIONS,
  KIND_OPTIONS,
  SESSION_STATUS_OPTIONS,
  DATE_PRESETS,
  MINE_PRESET,
  activeFilterCount,
  filterSummary,
  meetingsWhere,
  readDateWindow,
  readParam,
  sessionsWhere,
  type SearchParams,
} from "@/lib/filters";
import {
  SESSION_STATUS,
  canActAsMentor,
  interviewIsOpen,
} from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import { formatDuration, toDateInputValue, toTimeInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { profileOf } from "@/lib/profile";
import { meetingStatus } from "@/lib/status";
import { taskOptionsForSessions } from "@/lib/queries";

/**
 * The ledger: what has been delivered, and what is still in the diary.
 *
 * Two tabs rather than two tints. A logged session is a row in a table and a
 * scheduled meeting is a point on a calendar, and the old design tried to hold
 * both shapes in one list by tinting them — which is why staff had no meetings
 * destination at all and a mentor's log lived under `/mentor/sessions`, an
 * address that says "one mentor" about a page the whole school reads.
 *
 * Which rows exist is the reader's grants and reach, never the tab. The lens
 * only decides whether "Mine" is on when you arrive.
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
  const scheduled = readParam(params, "view") === "scheduled";

  // Somebody who only mentors sees their own rows and no others, whatever the
  // URL says; an admin sees the programs they were granted. The tab and the
  // "Mine" chip narrow inside that and can never widen it.
  const reach = administers
    ? { audience: "staff" as const, userId: user.id, programIds }
    : { audience: "mentor" as const, userId: user.id, mentorId: user.id };
  const viewer = { audience: reach.audience, userId: user.id, now };

  const tabs = [
    { href: "/sessions", label: "Logged" },
    { href: "/sessions?view=scheduled", label: "Scheduled" },
  ];

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
      basePath={scheduled ? "/sessions?view=scheduled" : "/sessions"}
      params={params}
      q="sessions"
      dateRange={readDateWindow(params, now)}
      selects={
        scheduled
          ? programSelect
          : [
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

  if (scheduled) {
    const where = meetingsWhere(params, reach, now);
    const meetings = await prisma.interview.findMany({
      where,
      include: { mentor: true, student: { include: { user: true } } },
      orderBy: { scheduledAt: "asc" },
      take: 100,
    });

    const entries: TimelineEntry[] = meetings
      .filter(interviewIsOpen)
      .map((m) => ({
        id: m.id,
        at: m.scheduledAt,
        hasTime: m.hasTime,
        timePending: !m.hasTime,
        title: "Meeting",
        status: meetingStatus(
          {
            id: m.id,
            status: m.status,
            scheduledAt: m.scheduledAt,
            sessionId: m.sessionId,
            student: {
              id: m.student.id,
              name: m.student.user.name ?? m.student.user.email,
            },
          },
          viewer
        ),
        // Staff watch meetings they are not in, so both sides are named: a row
        // with one chip leaves the reader to guess which side it is.
        person: {
          id: m.student.id,
          name: m.student.user.name,
          email: m.student.user.email,
        },
        counterpart: {
          id: m.mentorId,
          name: m.mentor.name,
          email: m.mentor.email,
        },
        href: `/students/${m.student.id}`,
        joinUrl: m.link,
        note: m.note,
        // Only the mentor who booked it may move it: an admin correcting
        // somebody else's diary is not a thing this product does.
        action:
          m.mentorId === user.id ? (
            <MeetingRowActions
              meeting={{
                id: m.id,
                date: toDateInputValue(m.scheduledAt),
                time: m.hasTime ? toTimeInputValue(m.scheduledAt) : "",
                link: m.link,
                note: m.note,
              }}
            />
          ) : undefined,
      }));

    return (
      <div className="space-y-4">
        <Header lens={lens} />
        <TabLinks label="Sessions" items={tabs} />
        {filters}
        <Timeline
          entries={entries}
          now={now}
          title="Scheduled"
          buckets={["overdue", "today", "week", "later"]}
          empty={
            activeFilterCount(params) > 0
              ? "No meetings match. Reset the filters to see the rest."
              : "Nothing in the diary. Meetings are scheduled from a student's page."
          }
        />
      </div>
    );
  }

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
      <TabLinks label="Sessions" items={tabs} />
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
          <SessionsTable
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
                    attendance: row.attended
                      ? row.late
                        ? "LATE"
                        : "ATTENDED"
                      : "NO_SHOW",
                    timeKind: row.withinPlan ? "PLAN" : "EXTRA",
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
