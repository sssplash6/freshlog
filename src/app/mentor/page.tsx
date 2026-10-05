import Link from "next/link";

import { PersonCell } from "@/components/person-chip";
import { ProgramChip } from "@/components/program-chip";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckIcon, ChevronRightIcon } from "@/components/icons";
import { ArrowLink } from "@/components/ui/link";
import { PageTitle, Section } from "@/components/ui/section";
import { StatStrip } from "@/components/ui/stat-strip";
import { TabLinks } from "@/components/ui/segmented";
import { DeadlineText } from "@/components/ui/status-chip";
import { FILL_CELL, Table, Td, Tr, type Column } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { SESSION_STATUS, USER_STATUS } from "@/lib/constants";
import { requireMentor } from "@/lib/dal";
import { formatBalance, formatDate, formatDuration } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { applySort, readSort } from "@/lib/sort";
import { mentorCaseload } from "@/lib/queries";
import { EXPIRY_WINDOW_DAYS, type ViewerContext } from "@/lib/status";

/** Students shown before the table offers to unfold the rest. */
const CASELOAD_ROWS = 8;

/**
 * The caseload's columns.
 *
 * Program is drawn only when the rows actually span more than one, the same
 * rule `AllocationsTable` follows: a mentor who works in one program would
 * otherwise read their own program's name down every line of the table, and a
 * mentor who has just narrowed to one with the tabs above would read the
 * answer to the question they just asked. It matters the rest of the time
 * because a student can be enrolled twice — two rows, one name, two balances —
 * and without the column those two rows look like a duplicate.
 */
function studentColumns(showProgram: boolean): Column[] {
  return [
    { label: "Student", sort: "student" },
    ...(showProgram ? [{ label: "Program", sort: "program" } as Column] : []),
    { label: "Remaining with you", align: "right", sort: "remaining", emphasis: "key" },
    { label: "Use by", sort: "deadline" },
    // Hidden below `lg`: at tablet width the other four columns left a student's
    // name 140px, and a name is what the row is for. The stacked phone row still
    // shows it (`Td` below carries the same class only from `sm`).
    { label: "Last session", sort: "seen", className: "max-lg:sm:hidden" },
    { label: "" },
  ];
}

/** What each of those headings orders by. `Column.sort` names the key. */
const CASELOAD_SORTS = [
  "student",
  "program",
  "remaining",
  "deadline",
  "seen",
] as const;

/**
 * A mentor's Monday morning.
 *
 * The page it replaces opened with a greeting banner, then six lifetime
 * figures — sessions logged, time delivered, programs — then a grid of program
 * islands, then the diary, then a log of what had already happened, then a
 * nine-column table, then a booking-link form, then the log-a-session form.
 * About 2,400px on a phone, and none of the first 1,000px answered the
 * question a mentor opens this page with.
 *
 * That question is three parts, and now they are the three sections: what
 * needs my answer, who am I seeing this week, and who is running out of time.
 * The lifetime figures are gone — a total that only ever grows tells nobody
 * what to do today — and the two forms have their own pages.
 */
export default async function MentorHomePage({
  searchParams,
}: {
  searchParams: Promise<{
    program?: string;
    students?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const user = await requireMentor();
  // One instant for the whole page, so two sections cannot disagree about what
  // "today" is — and so nothing reads the clock during a render.
  const viewer: ViewerContext = { audience: "mentor", userId: user.id, now: new Date() };
  const { program = "", students: studentRows, sort, dir } = await searchParams;
  // "Show me the rest of them", in the URL, so it survives a reload and can be
  // linked. The whole caseload on the page it is already on beats a second
  // address for the same nine rows.
  const showAllStudents = studentRows === "all";

  const caseload = await mentorCaseload(user.id);
  const { students, assignments } = caseload;

  // The date of this mentor's most recent session with each student. A
  // caseload row without it cannot answer "who have I not seen in a while",
  // which is the whole reason to look at the list.
  const lastSessions = await prisma.session.groupBy({
    by: ["studentId"],
    where: { mentorId: user.id, status: SESSION_STATUS.ACTIVE },
    _max: { date: true },
  });
  const lastSeen = new Map(lastSessions.map((s) => [s.studentId, s._max.date]));

  const programs = new Map<string, string>();
  for (const a of assignments) {
    if (!programs.has(a.programId)) programs.set(a.programId, a.program.name);
  }
  const selected = programs.has(program) ? program : "";
  // A caseload row is one (student, program) balance, so filtering by program
  // is a question about the row rather than about the person: a student in two
  // of this mentor's programs contributes one row to each.
  const inView = selected ? students.filter((s) => s.program.id === selected) : students;

  // -------------------------------------------------------------- Title figure
  //
  // The balance as every other page sums it — the mentor's own record, a
  // program's header — so an overdraw nets against what is left. Summing only
  // the positive rows made "Remaining" here 2h larger than the same mentor's
  // record said, under a label counting one student above a table of three.
  const remaining = inView.reduce((sum, s) => sum + s.remaining, 0);
  // Everything this mentor has actually delivered against the grants in view.
  // Lifetime, and it moves with the program tabs, because the question is
  // "what have I done here" and the tabs are how a mentor asks it of one
  // program.
  const completed = inView.reduce((sum, s) => sum + s.completed, 0);

  // Two rows for one student in two programs is not a duplicate, and the
  // column is what says so.
  const showProgram = new Set(inView.map((s) => s.program.id)).size > 1;

  // The reader's own order when they have asked for one; otherwise the page's,
  // which is the answer to "who is my next session for".
  const asked = readSort(
    { ...(sort ? { sort } : {}), ...(dir ? { dir } : {}) },
    CASELOAD_SORTS
  );
  const sortedCaseload = asked
    ? applySort(inView, asked, {
        student: (s) => s.profile.user.name ?? s.profile.user.email,
        program: (s) => s.program.name,
        remaining: (s) => s.remaining,
        deadline: (s) => s.deadline,
        seen: (s) => lastSeen.get(s.profile.id) ?? null,
      })
    : [...inView].sort((a, b) => {
        // Holding time with you first: that is who the next session is for.
        if ((b.remaining > 0 ? 1 : 0) !== (a.remaining > 0 ? 1 : 0)) {
          return (b.remaining > 0 ? 1 : 0) - (a.remaining > 0 ? 1 : 0);
        }
        return b.remaining - a.remaining;
      });
  const caseloadRows = showAllStudents
    ? sortedCaseload
    : sortedCaseload.slice(0, CASELOAD_ROWS);

  // This page's own address, with both of its states kept: a mentor who
  // narrowed to one program must not be thrown back to all of them for asking
  // to see more rows, and switching program must not silently re-fold them.
  // Nothing granted and nothing delivered: the strip would be two zeroes.
  const hasFigures = completed > 0 || remaining !== 0;

  const homeHref = (opts: { program?: string; all?: boolean }) => {
    const q = new URLSearchParams();
    if (opts.program) q.set("program", opts.program);
    if (opts.all) q.set("students", "all");
    // The three states compose. Narrowing to one program while the table is
    // ordered by use-by must not silently put it back in the page's own order:
    // a reader who asked one question does not expect answering a second to
    // cancel the first.
    if (asked) {
      q.set("sort", asked.key);
      q.set("dir", asked.dir);
    }
    const query = q.toString();
    return query ? `/mentor?${query}` : "/mentor";
  };

  return (
    <div className="space-y-4">
      <PageTitle
        eyebrow="Mentor"
        title="Home"
        subtitle={
          // The programs, and only when there is no figure strip below to say
          // more than they do. A mentor holding no time at all is the one
          // reader for whom "0 min completed · 0 min remaining" is a true
          // sentence that says nothing except that the page could not think of
          // anything to tell them.
          hasFigures ? undefined : programs.size > 0 ? (
            [...programs.values()].join(" · ")
          ) : undefined
        }
        actions={
          // Not above "No programs yet": with no program there is nobody to
          // log a meeting with, and the form would say so one page later.
          assignments.length > 0 ? (
            <LinkButton href="/sessions/new" className="w-full sm:w-auto">
              Log a session
            </LinkButton>
          ) : undefined
        }
      />

      {/* The mentor's own two numbers, and the only two they asked for: what
          they have delivered, and what is still theirs to deliver. Both lead —
          a rule this page breaks on purpose, because they are two halves of
          one quantity and ranking one above the other would answer half the
          question. Exact, not `formatRough`: a mentor spends against this
          balance, and "35+ hours" above a row saying 38h 45m read as two
          different figures. */}
      {hasFigures && (
        <StatStrip
          lead={{
            label: "Remaining",
            value: formatBalance(remaining),
            tone: remaining > 0 ? "hours" : remaining < 0 ? "danger" : "muted",
          }}
          items={[
            { label: "Completed", value: formatDuration(completed), icon: <CheckIcon className="h-4 w-4" /> },
          ]}
        />
      )}

      <Section
        title="Your students"
        count={inView.length || undefined}
        action={
          <div className="flex flex-wrap items-center gap-3">
                        {programs.size > 1 && (
              <TabLinks
                label="Program"
                className="text-xs"
                items={[
                  { href: homeHref({ all: showAllStudents }), label: "All" },
                  ...[...programs.entries()].map(([id, name]) => ({
                    href: homeHref({ program: id, all: showAllStudents }),
                    label: name,
                  })),
                ]}
              />
            )}
            {/* Unfolds the rest of the caseload HERE rather than navigating.
                It used to point at /mentor/sessions — a log of hours delivered
                — so a mentor asking to see all twelve of their students was
                handed a filtered table of their own sessions and no student
                list at all. /students now exists with "Mine" on by default,
                and the header's own link goes there; this one stays in place,
                because opening the rest of a list you are reading should not
                cost you the page. */}
            {inView.length > CASELOAD_ROWS &&
              (showAllStudents ? (
                <Link
                  href={homeHref({ program: selected })}
                  className="text-[0.8125rem] font-medium text-brand transition-colors hover:underline"
                >
                  First {CASELOAD_ROWS}
                </Link>
              ) : (
                <ArrowLink
                  href={homeHref({ program: selected, all: true })}
                  className="text-[0.8125rem]"
                >
                  All {inView.length}
                </ArrowLink>
              ))}
          </div>
        }
      >
        {caseloadRows.length === 0 ? (
          <EmptyState
            framed={false}
            variant={assignments.length === 0 ? "blocked" : "healthy"}
            title={
              assignments.length === 0
                ? "No programs yet"
                : "Nobody holds time with you"
            }
          >
            {assignments.length === 0
              ? "An admin has to add you to a program."
              : "An admin allocates it. You can still log a meeting with anyone in your programs."}
          </EmptyState>
        ) : (
          <Table columns={studentColumns(showProgram)} framed={false}>
            {caseloadRows.map((s) => (
              <Tr key={s.profile.id}>
                <Td className={FILL_CELL}>
                  {/* The student IS this row, so they are a cell, not a chip
                      inside somebody else's link — which is also what this was:
                      a chip with no href of its own, made clickable by an
                      ancestor, the only place in the app that happened. */}
                  <PersonCell
                    person={{
                      id: s.profile.user.id,
                      name: s.profile.user.name,
                      email: s.profile.user.email,
                    }}
                    href={`/students/${s.profile.id}`}
                    secondary={false}
                  >
                    {s.profile.user.status !== USER_STATUS.ACTIVE && (
                      <span className="shrink-0 text-xs font-normal text-muted-fg">
                        not approved
                      </span>
                    )}
                  </PersonCell>
                </Td>
                {showProgram && (
                  <Td label="Program">
                    {/* Capped below `xl` like the students roster: a table
                        sizes this column to the longest program name, and at
                        tablet width that pushed the last column out. */}
                    <span className="flex min-w-0 sm:max-w-52 xl:max-w-none">
                      <ProgramChip program={s.program} />
                    </span>
                  </Td>
                )}
                <Td label="Remaining with you" align="right" tone="key" className="tabular-nums">
                  <span className={cn(s.remaining < 0 ? "text-danger-ink" : "text-ink")}>
                    {s.allocated === 0 && s.remaining === 0
                      ? // Nothing granted and nothing spent: an em dash, not
                        // "0h", which reads as time that ran out.
                        "—"
                      : formatBalance(s.remaining)}
                  </span>
                </Td>
                <Td label="Use by">
                  <DeadlineText
                    deadline={s.deadline}
                    now={viewer.now}
                    // A mentor's own window: they schedule a week out, so
                    // amber a fortnight early is a warning they cannot use.
                    within={EXPIRY_WINDOW_DAYS.mentor}
                  />
                </Td>
                <Td label="Last session" tone="muted" className="whitespace-nowrap max-lg:sm:hidden">
                  {lastSeen.get(s.profile.id)
                    ? formatDate(lastSeen.get(s.profile.id) as Date)
                    : "—"}
                </Td>
                <Td align="right" corner>
                  {/* A chevron, the mark of a row that goes somewhere — not
                      a column of blue "Open →" repeating what the name, already
                      a link, says. Still its own target for a thumb. */}
                  <Link
                    href={`/students/${s.profile.id}`}
                    transitionTypes={["nav-forward"]}
                    aria-label={`Open ${s.profile.user.name ?? s.profile.user.email}`}
                    className="-my-2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-fg/60 transition-colors hover:bg-fill hover:text-brand sm:h-8 sm:w-8"
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </Link>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
