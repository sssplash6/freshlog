import { LinkButton } from "@/components/ui/button";
import { Figure } from "@/components/ui/figure";
import { PageTitle } from "@/components/ui/section";
import { TabLinks } from "@/components/ui/segmented";
import { ProgramDot } from "@/components/program-chip";
import { StatusChip } from "@/components/ui/status-chip";
import { adminScope } from "@/lib/authz";
import { requireProgramScope } from "@/lib/dal";
import { formatMoney, formatRough } from "@/lib/format";
import { programTotals } from "@/lib/hours";

import {
  PROGRAM_STATUS,
  programOf,
  programPairings,
  programStudents,
} from "../reads";

/**
 * The shell all three program tabs share: who this program is, one line of what
 * it holds, and the split into what it looks like (Overview), who is in it
 * (Students) and how it is set up (Settings).
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
  const [program, students, pairings] = await Promise.all([
    programOf(id),
    programStudents(id),
    programPairings(id),
  ]);

  const scope = await adminScope(user);
  // Back to the index, unless this reader's whole scope is this program — then
  // `/programs` redirects straight back here and the link is a loop.
  const toIndex = scope === "ALL" || scope.size > 1;
  const totals = programTotals(students);
  const mentors = new Set(pairings.map((p) => p.mentorId)).size;
  const base = `/programs/${program.id}`;

  return (
    <div className="space-y-5">
      <PageTitle
        backHref={toIndex ? "/programs" : "/admin"}
        backLabel={toIndex ? "Programs" : "Inbox"}
        eyebrow="Program"
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* The mark, at the one place the program is the subject. Not a
                wash and not a monogram — see `program-tone.ts`. */}
            <ProgramDot program={program} className="h-3 w-3" />
            {program.name}
            {program.status === PROGRAM_STATUS.ARCHIVED && (
              <StatusChip severity="neutral">Archived</StatusChip>
            )}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span>
              {totals.students} student{totals.students === 1 ? "" : "s"} ·{" "}
              {mentors} mentor{mentors === 1 ? "" : "s"} ·
            </span>
            <Figure
              size="inline"
              value={formatRough(totals.remaining)}
              tone={totals.remaining < 0 ? "danger" : "hours"}
            />
            <span>remaining</span>
            {/* The column decides, never the program's name — renaming the
                Master's Program used to switch the money off across the app
                (`Program.tracksPayment`, schema). */}
            {program.tracksPayment && (
              <span>· {formatMoney(totals.paid)} paid</span>
            )}
          </span>
        }
        actions={
          <LinkButton href={`${base}/students`} variant="secondary">
            Add students
          </LinkButton>
        }
      />

      <TabLinks
        label="Program sections"
        items={[
          { href: base, label: "Overview" },
          { href: `${base}/students`, label: "Students", count: totals.students },
          { href: `${base}/settings`, label: "⚙ Settings" },
        ]}
      />

      {children}
    </div>
  );
}
