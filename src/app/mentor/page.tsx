import Link from "next/link";

import { AttentionList } from "@/components/attention-list";
import { Avatar } from "@/components/avatar";
import { PersonCell } from "@/components/person-chip";
import { ProgramChip } from "@/components/program-chip";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckIcon, ChevronRightIcon } from "@/components/icons";
import { PageTitle, Section } from "@/components/ui/section";
import { StatStrip } from "@/components/ui/stat-strip";
import { TabLinks } from "@/components/ui/segmented";
import { DeadlineText } from "@/components/ui/status-chip";
import { FILL_CELL, Table, Td, Tr, type Column } from "@/components/ui/table";
import { attentionFor } from "@/lib/attention";
import { cn } from "@/lib/cn";
import { SESSION_STATUS, USER_STATUS } from "@/lib/constants";
import { requireMentor } from "@/lib/dal";
import { formatBalance, formatDate, formatDaysAgo, formatDuration } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { applySort, readSort } from "@/lib/sort";
import { mentorCaseload, type CaseloadStudent } from "@/lib/queries";
import { EXPIRY_WINDOW_DAYS, type ViewerContext } from "@/lib/status";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Home" };

/** Students shown before the table offers to unfold the rest. */
const CASELOAD_ROWS = 8;

/** Rows of the bell's list repeated on Home; the rest stay behind the bell. */
const ATTENTION_ROWS = 4;

/**
 * What a caseload row's balance says, in the words and the ink it is said in.
 *
 * One answer for the table cell, the phone row and the sort, so the three can
 * never disagree. Two states used to be drawn wrong: hours that expired unused
 * read "0 min", as if the student had spent them, and a student whose only
 * time sat in the unassigned pool read "—", as if there were none.
 */
function balanceOf(s: CaseloadStudent): {
  text: string;
  tone: keyof typeof TONE;
  /** 0 needs the mentor first, 1 holds time, 2 has time to claim, 3 nothing. */
  rank: 0 | 1 | 2 | 3;
} {
  const forfeited = s.expired
    ? Math.max(0, s.allocated - s.completed - s.missed)
    : 0;
  if (s.remaining < 0) {
    return { text: formatBalance(s.remaining), tone: "danger", rank: 0 };
  }
  if (forfeited > 0) {
    return { text: `${formatDuration(forfeited)} expired`, tone: "danger", rank: 0 };
  }
  if (s.remaining > 0) {
    return { text: formatDuration(s.remaining), tone: "ink", rank: 1 };
  }
  if (s.pool && s.pool > 0) {
    return {
      text: `${formatDuration(s.pool)} ${s.bank ? "in their bank" : "unassigned"}`,
      tone: "muted",
      rank: 2,
    };
  }
  // Nothing granted and nothing spent: an em dash, not "0 min", which reads as
  // time that ran out.
  if (s.allocated === 0) return { text: "—", tone: "muted", rank: 3 };
  return { text: formatDuration(0), tone: "muted", rank: 3 };
}

const TONE = {
  danger: "font-semibold text-danger-ink",
  ink: "text-ink",
  muted: "font-normal text-muted-fg",
} as const;

/**
 * The page's own order, when the reader has not asked for one: whoever needs
 * the mentor first. Expired or overdrawn time leads, then time that is still
 * theirs by soonest use-by date, then time waiting to be claimed.
 *
 * It sorted by the largest balance, which put the one student whose hours had
 * already run out twelfth of thirteen, below the fold — and a student due to
 * lose eight hours next week sixth, under four who had until February.
 */
function byUrgency(a: CaseloadStudent, b: CaseloadStudent): number {
  const ra = balanceOf(a).rank;
  const rb = balanceOf(b).rank;
  if (ra !== rb) return ra - rb;
  const da = a.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
  const db = b.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  if (a.remaining !== b.remaining) return b.remaining - a.remaining;
  return nameOf(a).localeCompare(nameOf(b));
}

const nameOf = (s: CaseloadStudent) => s.profile.user.name ?? s.profile.user.email;

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
 *
 * Every column but the name has a fixed width. Unfolding the rest of the
 * caseload — a longer name, a date with a year — used to shift every column
 * 40px sideways under the reader's eye.
 */
function studentColumns(showProgram: boolean): Column[] {
  return [
    { label: "Student", sort: "student" },
    ...(showProgram
      ? [{ label: "Program", sort: "program", className: "w-52" } as Column]
      : []),
    {
      label: "Remaining with you",
      align: "right",
      sort: "remaining",
      emphasis: "key",
      className: "w-40",
    },
    { label: "Use by", sort: "deadline", className: "w-40" },
    // Hidden below `xl` (it was `lg`): with the rail beside it a 1,024px laptop
    // gives the table ~770px, and the five columns that were left still came to
    // 860 — the last session and the chevron were cut off the edge. A name is
    // what the row is for.
    { label: "Last session", sort: "seen", className: "w-36 max-xl:sm:hidden" },
    { label: "", className: "w-14" },
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
 * That question is three parts: what needs my answer, who is running out of
 * time, and how much is left. The first is the top of the bell's list — only
 * when there is something on it, and never more than a few rows, with the rest
 * behind the bell. The second is the caseload, in the order of who needs the
 * mentor first. The third is the strip.
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

  const [caseload, attention] = await Promise.all([
    mentorCaseload(user.id),
    attentionFor(user, "mentor"),
  ]);
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
  // which is the answer to "who needs me first".
  const asked = readSort(
    { ...(sort ? { sort } : {}), ...(dir ? { dir } : {}) },
    CASELOAD_SORTS
  );
  const sortedCaseload = asked
    ? applySort(inView, asked, {
        student: nameOf,
        program: (s) => s.program.name,
        remaining: (s) => s.remaining,
        deadline: (s) => s.deadline,
        seen: (s) => lastSeen.get(s.profile.id) ?? null,
      })
    : [...inView].sort(byUrgency);
  const caseloadRows = showAllStudents
    ? sortedCaseload
    : sortedCaseload.slice(0, CASELOAD_ROWS);

  // Nothing granted and nothing delivered: the strip would be two zeroes.
  const hasFigures = completed > 0 || remaining !== 0;

  // This page's own address, with both of its states kept: a mentor who
  // narrowed to one program must not be thrown back to all of them for asking
  // to see more rows, and switching program must not silently re-fold them.
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

  // The bell's list, cut to its first few rows. Everything it holds is still
  // one tap away; Home only has to say that something is waiting and what.
  const attentionTotal = attention.statuses.length + attention.spilled;

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
          they have delivered, and what is still theirs to deliver. Exact, not
          `formatRough`: a mentor spends against this balance, and "35+ hours"
          above a row saying 38h 45m read as two different figures. */}
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

      {/* Only when something is waiting. An empty "Needs you" on every visit
          is a section a mentor learns to scroll past, and then they scroll past
          it on the day it has something in it. */}
      {attention.statuses.length > 0 && (
        <AttentionList
          title="Needs you"
          collapsible
          statuses={attention.statuses.slice(0, ATTENTION_ROWS)}
          dismissible={attention.dismissible}
          {...(attentionTotal > ATTENTION_ROWS
            ? { moreHref: "/notifications", moreLabel: `See all ${attentionTotal}` }
            : {})}
        />
      )}

      <Section
        title="Your students"
        count={inView.length || undefined}
        // The program tabs sit under the title rather than beside it. Beside
        // it, on a phone, three program names wrapped into a second row of
        // tabs and pushed the "All 13" link onto a line of its own.
        eyebrow={
          programs.size > 1 ? (
            // Scrolls sideways instead of wrapping. The arbitrary-variant
            // classes reach the track itself, which `cn` cannot override from
            // a `className` (it joins, it does not merge).
            <div className="scroll-x -mx-1 mt-1.5 px-1 [&>nav]:max-w-none [&>nav]:flex-nowrap [&>nav>a]:shrink-0 [&>nav>a]:whitespace-nowrap">
              <TabLinks
                label="Program"
                items={[
                  { href: homeHref({ all: showAllStudents }), label: "All" },
                  ...[...programs.entries()].map(([id, name]) => ({
                    href: homeHref({ program: id, all: showAllStudents }),
                    label: name,
                  })),
                ]}
              />
            </div>
          ) : undefined
        }
        action={
          // Unfolds the rest of the caseload HERE rather than navigating:
          // opening the rest of a list you are reading should not cost you the
          // page. One link in both states, worded as the two halves of one
          // toggle — it was "All 13 →" one way and an arrowless "First 8" back.
          inView.length > CASELOAD_ROWS ? (
            <Link
              href={homeHref({ program: selected, all: !showAllStudents })}
              scroll={false}
              className="inline-flex min-h-11 items-center text-xs font-medium text-brand transition-colors hover:underline"
            >
              {showAllStudents ? "Show fewer" : `Show all ${inView.length}`}
            </Link>
          ) : undefined
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
          <>
            {/* A phone row is two lines: who, then the one sentence about
                their time. The table's stacked rows repeated four labels under
                every name, so a student took 172px and one fitted on screen. */}
            <ul className="divide-y divide-line sm:hidden">
              {caseloadRows.map((s) => {
                const balance = balanceOf(s);
                return (
                  <li key={`${s.profile.id}:${s.program.id}`}>
                    <Link
                      href={`/students/${s.profile.id}`}
                      transitionTypes={["nav-forward"]}
                      className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors active:bg-fill"
                    >
                      <Avatar
                        person={{
                          id: s.profile.user.id,
                          name: s.profile.user.name,
                          email: s.profile.user.email,
                        }}
                        className="h-8 w-8 shrink-0 text-caption"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="min-w-0 truncate text-body font-semibold text-ink">
                            {nameOf(s)}
                          </span>
                          {s.profile.user.status !== USER_STATUS.ACTIVE && (
                            <span className="shrink-0 text-xs text-muted-fg">
                              not approved
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block min-w-0 truncate text-xs text-muted-fg">
                          <span className={cn("tabular-nums", TONE[balance.tone])}>
                            {balance.text}
                            {balance.rank === 1 && " left"}
                          </span>
                          {s.deadline && balance.rank < 2 && (
                            <>
                              {" · "}
                              {balance.rank === 1 ? "use by " : ""}
                              <DeadlineText
                                deadline={s.deadline}
                                now={viewer.now}
                                within={EXPIRY_WINDOW_DAYS.mentor}
                                className={balance.rank === 0 ? "font-normal text-muted-fg" : undefined}
                              />
                            </>
                          )}
                          {showProgram && ` · ${s.program.name}`}
                        </span>
                      </span>
                      <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-fg" />
                    </Link>
                  </li>
                );
              })}
            </ul>

            <Table columns={studentColumns(showProgram)} framed={false} label="Your students" className="max-sm:hidden">
              {caseloadRows.map((s) => {
                const balance = balanceOf(s);
                const seen = lastSeen.get(s.profile.id);
                return (
                  // `relative`: the chevron's link stretches over the whole
                  // row, so the row that tints on hover is the row that opens.
                  // It tinted everywhere and opened only from the name and a
                  // 32px chevron.
                  <Tr key={`${s.profile.id}:${s.program.id}`} className="relative">
                    <Td className={FILL_CELL}>
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
                      <Td>
                        <span className="flex min-w-0">
                          <ProgramChip program={s.program} variant="tag" />
                        </span>
                      </Td>
                    )}
                    <Td align="right" tone="key" className="whitespace-nowrap tabular-nums">
                      <span className={TONE[balance.tone]}>{balance.text}</span>
                    </Td>
                    <Td>
                      <DeadlineText
                        deadline={s.deadline}
                        now={viewer.now}
                        // A mentor's own window: they schedule a week out, so
                        // amber a fortnight early is a warning they cannot use.
                        within={EXPIRY_WINDOW_DAYS.mentor}
                      />
                    </Td>
                    <Td className="whitespace-nowrap max-xl:sm:hidden">
                      {seen ? (
                        <span className="flex flex-col">
                          <span className="text-ink">{formatDate(seen)}</span>
                          <span className="text-xs text-muted-fg">
                            {formatDaysAgo(seen, viewer.now)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-fg">—</span>
                      )}
                    </Td>
                    <Td align="right" corner>
                      <Link
                        href={`/students/${s.profile.id}`}
                        transitionTypes={["nav-forward"]}
                        aria-label={`Open ${nameOf(s)}`}
                        className="-my-2 inline-flex h-8 w-8 items-center justify-center rounded-lg align-middle text-muted-fg transition-colors after:absolute after:inset-0 hover:text-brand"
                      >
                        <ChevronRightIcon className="h-4 w-4" />
                      </Link>
                    </Td>
                  </Tr>
                );
              })}
            </Table>
          </>
        )}
      </Section>
    </div>
  );
}
