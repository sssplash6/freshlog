import { CheckIcon, LayersIcon, UsersIcon } from "@/components/icons";
import { LinkButton } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/section";
import { StatStrip } from "@/components/ui/stat-strip";
import { TabLinks } from "@/components/ui/segmented";
import { ProgramDot } from "@/components/program-chip";
import { StatusChip } from "@/components/ui/status-chip";
import { adminScope, canManageProgram } from "@/lib/authz";
import { requireProgramScope } from "@/lib/dal";
import { formatBalance, formatDuration } from "@/lib/format";
import { programTotals } from "@/lib/hours";

import {
  PROGRAM_STATUS,
  programLevels,
  programOf,
  programStudents,
} from "../reads";

/**
 * The shell both program tabs share: who this program is, one line of what it
 * holds, and the split into who is in it (Students) and how it is set up
 * (Settings).
 *
 * A layout rather than a header each page renders, so switching tabs leaves the
 * title and the tab strip exactly where they are. It re-runs when an action
 * revalidates, which is what keeps the counts honest.
 *
 * WHAT WENT: the program-hue banner and the 104px ghost monogram behind the
 * title, and the four-to-six `StatCard` strip on the overview under it, which
 * printed the same three numbers this one line does (§6.12).
 *
 * The gear is in the tab strip and NOT also in the actions cluster. §6.12 asks
 * for both; they would have sat one row apart, both reading "⚙ Settings" and
 * both going to the same page. The word is with the gear, which is the part the
 * owner asked for.
 *
 * "Add students" is not up here either — it was a button here AND a fold on the
 * page below, one action drawn twice a header apart. It is the full-width
 * secondary button in the header of the Students group, on the page it acts on.
 *
 * THE TWO THAT ARE HERE are the two an admin opens a program to do and could
 * only reach through a student (21 September 2026, the owner's instruction):
 * log a session, and grant somebody time. Both need a student, and both now
 * ask for one themselves — which is the difference between an action in a
 * header and a link to a page that will turn you away.
 */
export default async function ProgramLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireProgramScope(id);
  const [program, students, levels] = await Promise.all([
    programOf(id),
    programStudents(id),
    programLevels(id),
  ]);

  const scope = await adminScope(user);
  // A read-only grant (LEADER, SALES) sees the program and changes nothing in
  // it, so it is not offered a control that sets every student a task.
  const writes = await canManageProgram(user, id);
  // Back to the index, unless this reader's whole scope is this program — then
  // `/programs` redirects straight back here and the link is a loop.
  const toIndex = scope === "ALL" || scope.size > 1;
  const totals = programTotals(students);
  const base = `/programs/${program.id}`;

  return (
    <div className="space-y-4">
      <PageTitle
        backHref={toIndex ? "/programs" : "/admin"}
        backLabel={toIndex ? "Programs" : "Home"}
        // No eyebrow. "PROGRAM" sat in grey capitals directly under a back
        // link reading "Programs", above a title that is a program's name
        // beside its own coloured dot — the same fact three times in forty
        // pixels of vertical space.
        title={
          <>
            {/* The mark, at the one place the program is the subject. Not a
                wash and not a monogram — see `program-tone.ts`. Inline with
                the name, not a flex sibling: a flex row wraps at ITEMS, so a
                name too long for one line wrapped whole onto the second and
                left the dot alone on the first. In the text flow it stays on
                the first line whatever wraps under it. */}
            <ProgramDot
              program={program}
              className="mr-3 inline-block h-3 w-3 align-[0.12em]"
            />
            {program.name}
            {program.status === PROGRAM_STATUS.ARCHIVED && (
              <span className="ml-3 inline-flex align-middle">
                <StatusChip severity="neutral">Archived</StatusChip>
              </span>
            )}
          </>
        }
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {/* Allocate time FIRST and Log a session LAST, in the right-hand
                corner (12 October 2026, asked for in that order: "Log a
                session should always be in right corner, Allocate time to the
                left"). Granting time is what a program admin opens this page
                to do that no other page does for the whole program. */}
            <LinkButton href={`${base}/allocate`} variant="primary" size="md">
              Allocate time
            </LinkButton>
            {/* One task for every student in the program, set above the
                roster — asked for by the program's admins (11 October 2026).
                "Set a task", and the only task button up here: "Set a task,
                not mentor tasks — I need to send tasks to students mostly"
                (12 October 2026). The mentors' form is on the Mentor tasks
                tab, one click below. */}
            {writes && (
              <LinkButton href={`${base}?task=1`} variant="secondary" size="md">
                Set a task
              </LinkButton>
            )}
            {/* The program travels with it: a student in two of them has two
                balances, and the one being looked at is the one this log
                should land in. */}
            <LinkButton
              href={`/sessions/new?program=${program.id}`}
              // Blue wherever it appears, as on Home, Sessions and a
              // student's page — one action, one look.
              variant="primary"
              size="md"
            >
              {program.classHours ? "Log an hour for a group" : "Log a session"}
            </LinkButton>
          </span>
        }
      />

      {/* What the program holds, as a stat row: label over value, space
          between, no boxes. Four figures and nothing else, at the owner's
          request: Total is what the students hold in all — the hour bank,
          where the program has one. Colour is on the VALUE and only where the
          value is a problem.

          EXACT, and it adds up (October 2026). Each figure was rounded down
          on its own, so "7+ hours" completed and "3+ hours" remaining sat
          beside an 11-hour total that is neither their sum nor the whole
          story — missed and expired time were nowhere. A program admin grants
          against these figures, so they are the record, not a bearing; and
          what the other two leave out of the total is said in the hint, so
          the strip reconciles without arithmetic. */}
      <StatStrip
        lead={{
          label: "Remaining",
          value: formatBalance(totals.remaining),
          tone: totals.remaining < 0 ? "danger" : "hours",
          hint:
            totals.missed + totals.forfeited > 0
              ? [
                  totals.missed > 0 ? `${formatDuration(totals.missed)} missed` : null,
                  totals.forfeited > 0 ? `${formatDuration(totals.forfeited)} expired unused` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined,
        }}
        items={[
          { label: "Students", value: String(totals.students), icon: <UsersIcon className="h-4 w-4" /> },
          { label: "Completed", value: formatDuration(totals.completed), icon: <CheckIcon className="h-4 w-4" /> },
          { label: "Total", value: formatDuration(totals.allotted), icon: <LayersIcon className="h-4 w-4" /> },
        ]}
      />

      {/* A leveled program's roster comes in its levels as well as whole:
          one tab per level, each the roster narrowed by `?level=`. They are
          what an institute's sidebar links to, and they replace the Level
          select the roster used to carry — two controls for one filter. The
          count is each level's own members, never the whole program's. */}
      <TabLinks
        label="Program sections"
        items={[
          {
            href: base,
            label: levels.length > 0 ? "All students" : "Students",
            // Only beside level tabs, where it is the sum they split. Alone,
            // it was the strip's Students figure said a second time.
            count: levels.length > 0 ? totals.students : undefined,
          },
          ...levels.map((l) => ({
            href: `${base}?level=${l.id}`,
            label: l.name,
            count: students.filter((s) => s.byProgram.get(id)?.level?.id === l.id).length,
          })),
          // What the program's admins have asked its mentors to do.
          { href: `${base}/tasks`, label: "Mentor tasks" },
          { href: `${base}/settings`, label: "⚙ Settings" },
        ]}
      />

      {children}
    </div>
  );
}
