import { ExchangeList } from "@/components/exchange-panel";
import { CrownIcon } from "@/components/icons";
import { AddStudentsForm } from "@/components/forms/add-students-form";
import { AssignMentorForm } from "@/components/forms/program-settings-forms";
import { ProgramTaskForm } from "@/components/forms/student-task-forms";
import { PersonChip } from "@/components/person-chip";
import { SessionsList } from "@/components/session-row";
import { STUDENT_SORTS, StudentsTable } from "@/components/students-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { ArrowLink } from "@/components/ui/link";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { Section } from "@/components/ui/section";
import { canManageProgram } from "@/lib/authz";
import { SESSION_STATUS, USER_STATUS } from "@/lib/constants";
import { requireProgramScope } from "@/lib/dal";
import { formatDuration } from "@/lib/format";
import { programExchanges } from "@/lib/exchanges";
import {
  activeFilterCount,
  readParam,
  readTimeState,
  studentsWhere,
  type SearchParams,
} from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import { programTone } from "@/lib/program-tone";
import { toSessionEntries } from "@/lib/session-entries";
import { applySort, readSort } from "@/lib/sort";
import { studentsWithHours } from "@/lib/queries";
import { timeStateHolds, type ViewerContext } from "@/lib/status";

import {
  mentorPool,
  programCohorts,
  programGrants,
  programLevels,
  programOf,
  programPairings,
  requestNow,
} from "../reads";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Program" };

/** Past ten, a list of mentors is a page of its own. */
const MENTORS_SHOWN = 10;
/** Enough to see what has been happening; the rest is Sessions' job. */
const RECENT_SESSIONS = 6;

/**
 * A program IS its roster.
 *
 * Opening one used to land on "Overview" — a mentors list, an exchange panel
 * and one line about the last session — and the students were a tab away. That
 * is the wrong first screen: nobody administers a program to read a summary of
 * it, they open it to find a person, and the summary already sits in the
 * header the layout draws above this (students · mentors · hours remaining).
 * So the roster is the page, the mentors sit in a rail beside it where they
 * are still one glance away, its latest sessions follow it, and the Overview
 * tab is gone with the duplicate it stood for.
 *
 * The list itself is `/students` (§6.8) with the program fixed: same table,
 * same `where`, same paging. The program is a SCOPE rather than a param, so a
 * `?program=` arriving from somewhere else ANDs against it and can only narrow
 * (`lib/filters.ts`, rule 3).
 *
 * NO FILTER CHIPS AND NO COHORT SELECT, on the owner's instruction (12
 * September 2026): a search box over a program's own roster is the whole
 * control. The presets still work as URLs — `?time=expiring` from the bell
 * narrows this list exactly as it did — they are simply not offered as six
 * pills above a table that is usually shorter than they are. The one select a
 * leveled program earns is LEVEL: with Emerging, Advanced and Frontiers under
 * one Research program, "which level is this roster?" is a question the page
 * has to be able to answer.
 */
export default async function ProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const user = await requireProgramScope(id);
  const query = await searchParams;
  const page = parsePage(readParam(query, "page"));
  // One instant, shared with the layout above: a use-by date must not be
  // judged twice by two sections reading the clock separately.
  const now = requestNow();
  const viewer: ViewerContext = { audience: "staff", userId: user.id, now };

  // The first three are the layout's reads, memoised: opening a program asks
  // for its row, its roster and its pairings once between the two files.
  // `?task=1`, from the header's "Set a task": the form opens above
  // the roster, for an admin who may set it.
  const settingTask =
    readParam(query, "task") === "1" && (await canManageProgram(user, id));
  const [program, pairings, cohorts, levels, exchanges, grants, pool, recent, approved] =
    await Promise.all([
      programOf(id),
      programPairings(id),
      programCohorts(id),
      programLevels(id),
      programExchanges(id),
      programGrants(id),
      mentorPool(),
      prisma.session.findMany({
        where: { programId: id, status: SESSION_STATUS.ACTIVE },
        include: {
          mentor: true,
          student: { include: { user: true } },
          assignment: { select: { id: true, purpose: true } },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: RECENT_SESSIONS,
      }),
      // Who a task for everyone reaches — the action's own set, counted only
      // when the form is open.
      settingTask
        ? prisma.studentEnrollment.count({
            where: { programId: id, student: { user: { status: USER_STATUS.ACTIVE } } },
          })
        : Promise.resolve(0),
    ]);

  const where = studentsWhere(
    query,
    { audience: "staff", userId: user.id, programIds: [id] },
    now
  );
  // THE WHOLE FILTERED SET, then the order, then the page — in that sequence
  // and not the database's. Completed and Remaining are computed per row from
  // the grants and the sessions behind them (`studentsWithHours`), so they do
  // not exist until the rows are in memory: letting SQL take twenty-five rows
  // first and ordering those would order one page of forty and call it the
  // list. A program's roster is the size of a program, and the layout above
  // already reads every row of it for the figures in the masthead.
  const matching = await studentsWithHours(where, {
    now,
    // This page IS one program, so the hours on it are that program's.
    programIds: [id],
  });
  const asked = readSort(
    {
      ...(readParam(query, "sort") ? { sort: readParam(query, "sort") } : {}),
      ...(readParam(query, "dir") ? { dir: readParam(query, "dir") } : {}),
    },
    STUDENT_SORTS
  );
  // The `?time=` chip asks the bell's question, so it gets the bell's answer:
  // `studentsWhere` can only see that a grant's date is in the window, and
  // `timeStateHolds` asks whether its minutes survived to it. The figures here
  // are already this program's.
  const timeFilter = readTimeState(query);
  const visible = timeFilter
    ? matching.filter((s) =>
        timeStateHolds(timeFilter, s, { audience: "staff", now })
      )
    : matching;
  // The level this roster is narrowed to, when the tab above names one of
  // this program's — anything else in `?level=` already matched nobody.
  const level = levels.find((l) => l.id === readParam(query, "level")) ?? null;
  // A cohort as this roster names it. Under a level tab the level goes without
  // saying; on "All students" it leads, because "Fall 2026" under Emerging and
  // under Advanced are two intakes — and leading, it sorts them level by level.
  const cohortOf =
    cohorts.length > 0
      ? (s: (typeof matching)[number]) => {
          const here = s.byProgram.get(id);
          if (!here?.cohort) return null;
          return here.level && !level
            ? `${here.level.name} · ${here.cohort.name}`
            : here.cohort.name;
        }
      : undefined;
  const ordered = asked
    ? applySort(visible, asked, {
        student: (s) => s.user.name ?? s.user.email,
        completed: (s) => s.completedMinutes,
        total: (s) => s.allottedMinutes,
        remaining: (s) => s.remainingMinutes,
        deadline: (s) => s.expiring?.date,
        seen: (s) => s.lastSessionAt,
        cohort: (s) => cohortOf?.(s),
      })
    : visible;
  const total = ordered.length;
  const students = ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const lent = [...exchanges.hosted, ...exchanges.sent];
  // The student link keeps this program, so the student page's Back returns
  // here — the same `?from=` the roster's own rows carry.
  const recentEntries = toSessionEntries(recent, {
    mentorBase: "/mentors",
    studentBase: "/students",
  }).map((entry) =>
    entry.student?.href
      ? { ...entry, student: { ...entry.student, href: `${entry.student.href}?from=${id}` } }
      : entry,
  );
  const basePath = `/programs/${program.id}`;

  // One line per MENTOR: somebody paired with three cohorts of this program is
  // one person teaching here, not three rows. The cohort names themselves are
  // not on the line — programs are flat by default, so on a list of fourteen
  // it was one bare date beside one name, reading as a mystery rather than a
  // fact. Settings is where a pairing's cohort is set and shown.
  //
  // EVERYONE WHO WORKS HERE, not only everyone paired to teach: somebody who
  // administers this program without a pairing in it belongs on the one list
  // of its people, and leaving them off made a program run by one admin who
  // does not mentor read as a program with nobody in it. The pairings lead,
  // in the order they were made, and the admins who teach nothing follow.
  const mentors = new Map<
    string,
    {
      mentor: { id: string; name: string | null; email: string; avatarUpdatedAt?: Date | null };
      /** Paired to teach here. False for an admin who only administers it. */
      teaches: boolean;
    }
  >();
  for (const p of pairings) {
    const held = mentors.get(p.mentorId);
    mentors.set(p.mentorId, held ?? { mentor: p.mentor, teaches: true });
  }
  for (const grant of grants) {
    if (!mentors.has(grant.user.id)) {
      mentors.set(grant.user.id, { mentor: grant.user, teaches: false });
    }
  }
  const mentorRows = [...mentors.values()];
  const superAdminIds = new Set(
    grants.filter((grant) => grant.role === "ADMIN").map((grant) => grant.user.id),
  );
  const spilled = mentorRows.length - MENTORS_SHOWN;
  // Adding a mentor is offered where the list of them is, not only a tab away
  // in Settings. Removing stays in Settings, beside the cohort each pairing
  // names — a narrow rail has no room to say which pairing a button unmakes.
  const paired = new Set(pairings.map((p) => p.mentorId));
  const eligibleMentors = pool
    .filter((m) => !paired.has(m.id))
    .map((m) => ({ value: m.id, label: m.name ?? m.email }));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
      <div className="min-w-0 space-y-4">
        {settingTask && (
          <ProgramTaskForm
            programId={program.id}
            programName={program.name}
            students={approved}
            closeHref={basePath}
          />
        )}
        {/* ONE way in, at the head of the roster it adds to: the same
            plus-button every page uses for "new", which the form REPLACES
            when it opens (add-students-form.tsx). `?add=1` — the link from
            Students — arrives with it open. */}
        <div>
          <AddStudentsForm
            defaultOpen={readParam(query, "add") === "1"}
            classHours={program.classHours}
            program={{
              id: program.id,
              name: program.name,
              levels: levels.map((l) => ({
                id: l.id,
                name: l.name,
                cohorts: l.cohorts.map((c) => ({ id: c.id, name: c.name })),
              })),
              cohorts: cohorts
                .filter((c) => c.levelId === null)
                .map((c) => ({ id: c.id, name: c.name })),
            }}
          />
        </div>

        {/* The level is a tab in the layout above, not a select here. */}
        {/* Reset only for a filter the reader set here; the level tab is
            not one, and Reset would have cleared it along with the rest. */}
        <FilterBar
          basePath={basePath}
          params={query}
          q="students"
          reset={activeFilterCount(query) > (level ? 1 : 0)}
        />

        {/* What the level buys, said where the level is being read: the
            standard grant is the one fact that makes Emerging and Advanced
            different places, and it otherwise lives two tabs away. */}
        {level && (
          <p className="px-1 text-xs text-muted-fg">
            {(() => {
              const minutes = level.standardMinutes ?? program.standardMinutes;
              const days = level.standardDays ?? program.standardDays;
              return minutes !== null && days !== null
                ? `Students joining ${level.name} get ${formatDuration(minutes)} to use within ${days} day${days === 1 ? "" : "s"}.`
                : `${level.name} grants no standard time on joining.`;
            })()}
          </p>
        )}

        {total === 0 ? (
          activeFilterCount(query) > (level ? 1 : 0) ? (
            // The bar above has just said in words that nothing matched, so
            // this adds the way out and not the count again.
            <EmptyState variant="no-results">
              Check the spelling, or reset to see everyone.
            </EmptyState>
          ) : level ? (
            <EmptyState title={`Nobody in ${level.name} yet`}>
              Add them with the button above.
            </EmptyState>
          ) : (
            <EmptyState title="Nobody enrolled">
              Add them with the button above.
            </EmptyState>
          )
        ) : (
          <>
            <StudentsTable
              students={students}
              viewer={viewer}
              showProgram={false}
              from={id}
              sorts={STUDENT_SORTS}
              cohortOf={cohortOf}
            />
            {/* Only with a second page: the tab above already counts them. */}
            {total > PAGE_SIZE && (
              <Pagination
                basePath={basePath}
                params={query}
                page={page}
                total={total}
                unit="students"
              />
            )}
          </>
        )}

        {/* Students this program took in, and students it lent out — both, in
            one list, because an admin's question is the same either way: is
            somebody delivering the hours that were promised? The rows are
            read-only here. A placement is called off from the student's own
            page, where the ledger it would take with it is on screen. */}
        {lent.length > 0 && (
          <Section
            title="Exchange"
            count={lent.length}
          >
            <ExchangeList
              exchanges={lent}
              viewer={viewer}
              showStudent
              canReturn={() => false}
            />
          </Section>
        )}

          {/* The program's latest sessions, under the roster: "last meetings
              on the bottom would be good too". The roster says who each
              student is and what they hold; this says what has actually been
              happening, without a trip to Sessions. Struck-off rows are left
              to that ledger. */}
          {recentEntries.length > 0 && (
            <Section
              title="Recent sessions"
              action={
                <ArrowLink href={`/sessions?program=${program.id}`} className="text-xs">
                  All sessions
                </ArrowLink>
              }
            >
              <SessionsList
                sessions={recentEntries}
                viewer={viewer}
                columns={["date", "student", "mentor", "duration", "task"]}
                framed={false}
              />
            </Section>
          )}
      </div>

        {/* The mentors in a rail beside the roster, restored at the program
            admins' request (11 October 2026): "Mentors are on the side like
            before, it was much more useful." The strip that replaced it on
            6 October put twenty names and the assign form above the students,
            so the list an admin opens a program for started half a screen
            down. Source order is the phone's order: students first, the rail
            under them. Side by side only from `xl`, where the roster still
            has the width for its columns. */}
        <Section
          title="Mentors"
          count={mentorRows.length}
          action={
            spilled > 0 ? (
              <ArrowLink href={`/mentors?program=${program.id}`} className="text-xs">
                All mentors
              </ArrowLink>
            ) : undefined
          }
        >
          {mentorRows.length === 0 ? (
            <p className="px-4 py-3 text-body text-muted-fg sm:px-5">Nobody here yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {mentorRows.slice(0, MENTORS_SHOWN).map(({ mentor, teaches }) => (
                // The flag follows the NAME, never the row's far edge: directly
                // after the name it costs a line only when the name leaves no
                // room.
                <li
                  key={mentor.id}
                  className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-body sm:px-5"
                >
                  {/* "Their mentors can have matching colours." This is the one
                      page where that is unambiguous: every row belongs to this
                      program, so the chip can spend its hue on the place. */}
                  <PersonChip
                    person={mentor}
                    size="sm"
                    href={`/mentors/${mentor.id}`}
                    tone={programTone(program)}
                  />
                  {superAdminIds.has(mentor.id) && (
                    <span title="Admin" className="text-warn-ink">
                      <CrownIcon className="h-4 w-4" />
                      <span className="sr-only">Admin</span>
                    </span>
                  )}
                  {/* The crown cannot say this: it marks an admin whether or
                      not they teach here. This says that no session can be
                      logged against them here, because nobody paired them. */}
                  {!teaches && <span className="text-xs text-muted-fg">Admin only</span>}
                </li>
              ))}
            </ul>
          )}
          {eligibleMentors.length > 0 && (
            <div className="border-t border-line px-4 py-3 sm:px-5">
              <AssignMentorForm
                programId={program.id}
                mentors={eligibleMentors}
                levels={levels.map((l) => ({
                  id: l.id,
                  name: l.name,
                  cohorts: l.cohorts.map((c) => ({ value: c.id, label: c.name })),
                }))}
                cohorts={cohorts
                  .filter((c) => c.levelId === null)
                  .map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>
          )}
        </Section>
    </div>
  );
}
