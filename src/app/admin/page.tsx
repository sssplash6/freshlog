import Link from "next/link";
import { Suspense } from "react";

import { CheckIcon, ChevronRightIcon, LayersIcon, UsersIcon } from "@/components/icons";
import { CreateButton, CreatePanel, CreateSlot } from "@/components/page-create";
import { Figure } from "@/components/ui/figure";
import { ArrowLink } from "@/components/ui/link";
import { CreateProgramForm } from "@/components/forms/program-forms";
import { ProgramChip } from "@/components/program-chip";
import { TabLinks } from "@/components/ui/segmented";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusChip } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import {
  adminScope,
  scopeIsEmpty,
  scopeProgramFilter,
} from "@/lib/authz";
import { staffAttention, type StaffPreload } from "@/lib/attention";
import { requireStaff } from "@/lib/dal";
import { applySort, readSort } from "@/lib/sort";
import { formatDuration, formatRough } from "@/lib/format";
import { programTotals, totalsByLevel, type ProgramTotals } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { studentsWithHours } from "@/lib/queries";
import { spaceOf, type Space } from "@/lib/space";
import { status, type Status, type ViewerContext } from "@/lib/status";
import { formatProgramStamp, programStampISO } from "@/lib/when";
import type { User } from "@/generated/prisma/client";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Home" };

/**
 * The admin's landing page: how big are my programs, and how much time is
 * still in them.
 *
 * It used to open with "Needs you" — twenty derived rows about students,
 * mentors, tasks and meetings — and then a week's diary, and then this table.
 * Both of those are behind the bell now (`lib/attention.ts`, `/notifications`),
 * which is the one place in the app that lists "what is waiting on me"; this
 * page says only how many, and links there. What is left here is the thing no
 * feed can say: the shape of the school this person administers.
 *
 * Every figure comes from `programTotals` over the unsliced roster, per
 * program, so a student in two programs is counted once in each with that
 * program's own hours.
 */

/**
 * What is waiting on this reader: the first three, in place, and the way to
 * the rest.
 *
 * It was a count and a link — "6 items need your attention · Review in
 * notifications" — which made the one thing on this page anybody acts on the
 * only thing it would not show. The three worst rows now sit here, already
 * sorted problems-first by `staffAttention`, in the shape the bell's page
 * gives them (state, who, what to do), so the reader can tell from Home
 * whether to stop and look. The rest stay behind the bell, which is still
 * the one full list. Streamed, so the program table never waits on the
 * mentors, tasks and ratings these rows also read — the roster it already has
 * is handed over rather than read twice.
 */
const HOME_ISSUES = 3;

async function NeedsYou({ user, preload }: { user: User; preload: StaffPreload }) {
  const { statuses, spilled } = await staffAttention(user, preload);
  // The count is the rows that exist, not a subset of them: a heading that
  // says 6 over a list of 8 reads as a bug.
  const total = statuses.length + spilled;

  if (total === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-surface px-4 py-3 text-body text-muted-fg shadow-sm sm:px-5">
        <CheckIcon className="h-4 w-4 shrink-0 text-ink/60" />
        Nothing needs your attention right now.
      </p>
    );
  }
  return (
    <Section
      title="Needs you"
      count={total}
      action={
        <ArrowLink href="/notifications" className="text-xs">
          {total > HOME_ISSUES ? `All ${total}` : "Notifications"}
        </ArrowLink>
      }
    >
      <ul className="divide-y divide-line">
        {statuses.slice(0, HOME_ISSUES).map((s, i) => (
          <IssueRow key={`${s.type}-${s.subject?.id ?? i}`} status={s} />
        ))}
      </ul>
    </Section>
  );
}

/** One issue: the state and who it is about on one line, what to do under it. */
function IssueRow({ status }: { status: Status }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StatusChip status={{ ...status, explanation: undefined }} />
        {status.subject && (
          <span className="min-w-0 truncate text-body font-semibold text-ink">
            {status.subject.name}
          </span>
        )}
        {status.program && (
          <span className="min-w-0 truncate text-xs text-muted-fg">{status.program.name}</span>
        )}
      </span>
      {status.explanation && (
        <span className="mt-0.5 block text-xs text-muted-fg">{status.explanation}</span>
      )}
    </>
  );
  if (!status.href) {
    return <li className="px-4 py-3 sm:px-5">{body}</li>;
  }
  return (
    <li className="relative">
      <Link
        href={status.href}
        transitionTypes={["nav-forward"]}
        className="group block min-h-11 py-3 pl-4 pr-10 transition-colors hover:bg-fill/60 sm:pl-5 sm:pr-11"
      >
        {body}
        <ChevronRightIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg transition-colors group-hover:text-brand sm:right-5" />
      </Link>
    </li>
  );
}

/**
 * "Updated October 5, 15:10 Tashkent (UTC+5)". §5.8 lets exactly this page
 * claim freshness: its figures are a snapshot of a ledger other people are
 * writing to, and a table that was right at nine is worth knowing is from nine
 * — and from which day. The exact instant is the tooltip.
 */
function UpdatedAt({ now }: { now: Date }) {
  return (
    <time
      dateTime={now.toISOString()}
      title={programStampISO(now)}
      className="text-xs text-muted-fg"
    >
      Updated {formatProgramStamp(now)}
    </time>
  );
}

/** What the Programs table can be ordered by. */
const PROGRAM_SORTS = ["program", "students", "mentors", "remaining"] as const;

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string; show?: string }>;
}) {
  const user = await requireStaff();
  const query = await searchParams;
  const asked = readSort(query, PROGRAM_SORTS);
  const overOnly = query.show === "over";

  // The reader's grants are applied ONCE here and every read below carries
  // them. `undefined` is a platform admin and means no filter at all — not
  // "every id I happen to have fetched", which would go stale the moment a
  // program is created.
  const scope = await adminScope(user);
  const programIds = scopeProgramFilter(scope);
  const inScope = programIds ? { in: [...programIds] } : undefined;

  // One instant for the whole render, so no two figures can disagree about
  // what today is or what has expired.
  const now = new Date();
  const viewer: ViewerContext = { audience: "staff", userId: user.id, now };

  // Staff with no grants are let in by `requireStaff` precisely so this page
  // can answer them — "0 programs · 0 students" is a dashboard, not the
  // explanation, and `STAFF_UNSCOPED` already has the honest one. A platform
  // admin holding no programs is a different case entirely: theirs is the
  // empty school the CreateProgramForm below belongs to.
  if (scopeIsEmpty(scope) && !user.platformAdmin) {
    const unscoped = status("STAFF_UNSCOPED", viewer);
    return (
      <div className="space-y-4">
        <PageTitle title="Home" />
        <EmptyState variant="blocked" title={unscoped?.label ?? "No programs granted"}>
          {unscoped?.explanation ??
            "A platform admin grants you a program to work in."}
        </EmptyState>
      </div>
    );
  }

  const [programs, students, pairings] = await Promise.all([
    prisma.program.findMany({
      where: inScope ? { id: inScope } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true, colorIndex: true },
    }),
    studentsWithHours(
      inScope ? { enrollments: { some: { programId: inScope } } } : {},
      { now, programIds }
    ),
    prisma.mentorAssignment.findMany({
      where: inScope ? { programId: inScope } : {},
      select: { mentorId: true, programId: true },
    }),
  ]);

  // By name as people read it: SQLite orders by code point, which put "efde"
  // after "Research Program".
  programs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const overall = programTotals(students);

  // A reader whose whole scope is one institute gets the institute: the same
  // roster and the same figures, broken down by level instead of by program —
  // a table of one program row is what this page already refuses to draw.
  // Asked in the admin lens whatever the cookie says, since this is the admin
  // home (lib/space.ts).
  const space = await spaceOf(user, "admin");
  if (space.kind === "institute") {
    const levels = await prisma.programLevel.findMany({
      where: { programId: space.programId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, standardMinutes: true, standardDays: true },
    });
    const program = await prisma.program.findUniqueOrThrow({
      where: { id: space.programId },
      select: { standardMinutes: true, standardDays: true },
    });
    const enrolled = students.flatMap((s) => {
      const figures = s.byProgram.get(space.programId);
      return figures ? [figures] : [];
    });
    return (
      <InstituteHome
        space={space}
        now={now}
        overall={programTotals(enrolled)}
        split={totalsByLevel(enrolled)}
        levels={levels}
        programStandard={program}
        needsYou={
          <Suspense fallback={null}>
            <NeedsYou user={user} preload={{ now, programs, students }} />
          </Suspense>
        }
      />
    );
  }
  const unsorted = programs.map((p) => {
    // That program's figures for each student in it — never the student's
    // combined row, which would put another program's hours in this total and
    // count a two-program student twice.
    const enrolled = students.flatMap((s) => {
      const figures = s.byProgram.get(p.id);
      return figures ? [figures] : [];
    });
    const totals = programTotals(enrolled);
    return {
      ...p,
      students: totals.students,
      mentors: new Set(
        pairings.filter((a) => a.programId === p.id).map((a) => a.mentorId)
      ).size,
      remaining: totals.remaining,
    };
  });

  // Ordered by the heading the reader clicked. Remaining opens lowest-first —
  // the program furthest over is the one a reader sorts a table to find.
  const overCount = unsorted.filter((r) => r.remaining < 0).length;
  const rows = applySort(overOnly ? unsorted.filter((r) => r.remaining < 0) : unsorted, asked, {
    program: (r) => r.name,
    students: (r) => r.students,
    mentors: (r) => r.mentors,
    remaining: (r) => r.remaining,
  });

  const columns: Column[] = [
    { label: "Program", sort: "program" },
    { label: "Students", align: "right", sort: "students", sortDir: "desc" },
    { label: "Mentors", align: "right", sort: "mentors", sortDir: "desc" },
    { label: "Remaining", align: "right", sort: "remaining", sortDir: "asc", emphasis: "key" },
  ];

  return (
    <CreateSlot>
    <div className="space-y-4">
      {/* The freshness stamp is the subtitle, not an action: the actions slot
          is where every page keeps its one "new" button. */}
      <PageTitle
        title="Home"
        subtitle={<UpdatedAt now={now} />}
        actions={user.platformAdmin ? <CreateButton label="New program" /> : undefined}
      />

      {user.platformAdmin && (
        <CreatePanel
          title="New program"
          hint="It starts with no students or mentors. Grant its admins access afterwards."
        >
          <CreateProgramForm />
        </CreatePanel>
      )}

      {/* The school in three figures. Remaining leads, in the hours orange,
          because it is the one of the three anybody acts on. */}
      <StatStrip
        lead={{
          label: "Remaining",
          value: formatRough(overall.remaining),
          tone: overall.remaining < 0 ? "danger" : "hours",
        }}
        items={[
          { label: "Programs", value: String(programs.length), icon: <LayersIcon className="h-4 w-4" /> },
          { label: "Students", value: String(overall.students), icon: <UsersIcon className="h-4 w-4" /> },
        ]}
      />

      <Suspense fallback={null}>
        <NeedsYou user={user} preload={{ now, programs, students }} />
      </Suspense>

      {/* One program is the whole scope, and a table of one row that repeats
          the figures above it is furniture. */}
      {programs.length > 1 && (
        <Section
          title="Programs"
          action={<ArrowLink href="/programs" className="text-xs">All programs</ArrowLink>}
        >
          {/* The outliers, one click away. Only offered when there are some:
              a filter that can only ever show the same table is furniture. */}
          {overCount > 0 && (
            <TabLinks
              label="Programs shown"
              className="mx-1 mb-2"
              items={[
                { href: "/admin", label: "All" },
                { href: "/admin?show=over", label: "Over capacity", count: overCount },
              ]}
            />
          )}
          <Table columns={columns} framed={false}>
            {rows.map((p) => (
              <Tr key={p.id}>
                <Td>
                  {/* The name is the way in — the same rule as `/programs`,
                      which this table is the short version of.
                      On a phone the row is ONE line — name, then the figure
                      at the right edge — with the counts quiet under it. The
                      stacked version repeated "Program / Students / Mentors /
                      Remaining" labels down five 170px cards. */}
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <ProgramChip
                        program={p}
                        href={`/programs/${p.id}`}
                        className="min-h-11 font-semibold sm:min-h-0"
                      />
                      {p.remaining < 0 && (
                        <StatusChip severity="problem">Over capacity</StatusChip>
                      )}
                    </span>
                    <Figure
                      size="inline"
                      value={formatRough(p.remaining)}
                      tone={p.remaining < 0 ? "danger" : "hours"}
                      className="shrink-0 sm:hidden"
                    />
                  </span>
                  <span className="-mt-2 block pb-1 text-xs text-muted-fg sm:hidden">
                    {p.students} {p.students === 1 ? "student" : "students"} · {p.mentors}{" "}
                    {p.mentors === 1 ? "mentor" : "mentors"}
                  </span>
                </Td>
                <Td align="right" className="tabular-nums max-sm:hidden">
                  {p.students}
                </Td>
                <Td align="right" className="tabular-nums max-sm:hidden">
                  {p.mentors}
                </Td>
                <Td align="right" className="max-sm:hidden">
                  <Figure
                    size="inline"
                    value={formatRough(p.remaining)}
                    tone={p.remaining < 0 ? "danger" : "hours"}
                    className="sm:text-right"
                  />
                </Td>
              </Tr>
            ))}
          </Table>
        </Section>
      )}
    </div>
    </CreateSlot>
  );
}

/** "15h within 180 days", or a dash when nothing is granted on joining. */
function standardLabel(minutes: number | null, days: number | null): string {
  if (minutes === null || days === null) return "—";
  return `${formatDuration(minutes)} within ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * The institute's own home: its name as the title, its levels as the table.
 *
 * Built from the same rows as the school's home and the same helper —
 * `totalsByLevel` is `programTotals` per level — so a level's Remaining here,
 * the program's Remaining on `/programs`, and the platform admin's figure for
 * the same program cannot disagree.
 *
 * A level's standard grant is printed beside it because it is what a level IS
 * to the people who run it: Emerging buys two hours, Advanced fifteen. A level
 * that sets none inherits the program's, and says so by printing that.
 */
function InstituteHome({
  space,
  now,
  overall,
  split,
  levels,
  programStandard,
  needsYou,
}: {
  space: Extract<Space, { kind: "institute" }>;
  now: Date;
  overall: ProgramTotals;
  split: Map<string | null, ProgramTotals>;
  levels: {
    id: string;
    name: string;
    standardMinutes: number | null;
    standardDays: number | null;
  }[];
  programStandard: { standardMinutes: number | null; standardDays: number | null };
  needsYou: React.ReactNode;
}) {
  const base = `/programs/${space.programId}`;
  const unleveled = split.get(null);
  const columns: Column[] = [
    { label: "Level" },
    { label: "Standard grant" },
    { label: "Students", align: "right" },
    { label: "Remaining", align: "right", emphasis: "key" },
  ];
  const remainingCell = (totals: ProgramTotals | undefined) => {
    const remaining = totals?.remaining ?? 0;
    return (
      <Figure
        size="inline"
        value={formatRough(remaining)}
        tone={remaining < 0 ? "danger" : "hours"}
        className="sm:text-right"
      />
    );
  };

  return (
    <div className="space-y-4">
      <PageTitle title={space.name} subtitle={<UpdatedAt now={now} />} />

      <StatStrip
        lead={{
          label: "Remaining",
          value: formatRough(overall.remaining),
          tone: overall.remaining < 0 ? "danger" : "hours",
        }}
        items={[
          { label: "Levels", value: String(levels.length), icon: <LayersIcon className="h-4 w-4" /> },
          { label: "Students", value: String(overall.students), icon: <UsersIcon className="h-4 w-4" /> },
        ]}
      />

      {needsYou}

      {levels.length > 0 && (
        <Section
          title="Levels"
          action={<ArrowLink href={base} className="text-xs">Everyone</ArrowLink>}
        >
          <Table columns={columns} framed={false}>
            {levels.map((l) => (
              <Tr key={l.id}>
                <Td label="Level">
                  <ArrowLink href={`${base}?level=${l.id}`} className="min-h-11 font-semibold sm:min-h-0">
                    {l.name}
                  </ArrowLink>
                </Td>
                <Td label="Standard grant" tone="muted">
                  {l.standardMinutes !== null
                    ? standardLabel(l.standardMinutes, l.standardDays)
                    : standardLabel(programStandard.standardMinutes, programStandard.standardDays)}
                </Td>
                <Td label="Students" align="right" className="tabular-nums">
                  {split.get(l.id)?.students ?? 0}
                </Td>
                <Td label="Remaining" align="right">
                  {remainingCell(split.get(l.id))}
                </Td>
              </Tr>
            ))}
            {/* Visitors and anyone enrolled before the levels existed. Shown
                rather than dropped, so the rows add up to the figure above. */}
            {unleveled && (
              <Tr>
                <Td label="Level" className="text-muted-fg">No level</Td>
                <Td label="Standard grant" className="text-muted-fg">—</Td>
                <Td label="Students" align="right" className="tabular-nums">
                  {unleveled.students}
                </Td>
                <Td label="Remaining" align="right">
                  {remainingCell(unleveled)}
                </Td>
              </Tr>
            )}
          </Table>
        </Section>
      )}
    </div>
  );
}
