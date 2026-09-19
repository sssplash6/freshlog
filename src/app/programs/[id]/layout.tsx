import { PageTitle } from "@/components/ui/section";
import { TabLinks } from "@/components/ui/segmented";
import { ProgramDot } from "@/components/program-chip";
import { StatusChip } from "@/components/ui/status-chip";
import { adminScope } from "@/lib/authz";
import { requireProgramScope } from "@/lib/dal";
import { formatMoney, formatRough } from "@/lib/format";
import { cn } from "@/lib/cn";
import { programTotals } from "@/lib/hours";

import {
  PROGRAM_STATUS,
  programOf,
  programPairings,
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
 * NOTHING ELSE IS IN THE ACTIONS CLUSTER EITHER. "Add students" was a button
 * up here and a fold on the page below it — one action drawn twice, a header
 * apart. It is the full-width button under the tabs now, on the page it acts
 * on, and Overview is gone: the roster IS the program (`page.tsx`).
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
    <div className="space-y-4">
      <PageTitle
        backHref={toIndex ? "/programs" : "/admin"}
        backLabel={toIndex ? "Programs" : "Inbox"}
        // No eyebrow. "PROGRAM" sat in grey capitals directly under a back
        // link reading "Programs", above a title that is a program's name
        // beside its own coloured dot — the same fact three times in forty
        // pixels of vertical space.
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
          <span className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm text-muted-fg">
              {totals.students} student{totals.students === 1 ? "" : "s"} · {mentors}{" "}
              mentor{mentors === 1 ? "" : "s"}
            </span>
            <ProgramMetric
              label="Completed"
              value={shortHours(formatRough(totals.completed))}
              tone="hours"
            />
            <ProgramMetric
              label="Remaining"
              value={shortHours(formatRough(totals.remaining))}
              tone={totals.remaining < 0 ? "danger" : "hours"}
            />
            {/* The column decides, never the program's name — renaming the
                Master's Program used to switch the money off across the app
                (`Program.tracksPayment`, schema). */}
            {program.tracksPayment && (
              <ProgramMetric label="Paid" value={formatMoney(totals.paid)} tone="neutral" />
            )}
          </span>
        }
      />

      <TabLinks
        label="Program sections"
        items={[
          { href: base, label: "Students", count: totals.students },
          { href: `${base}/settings`, label: "⚙ Settings" },
        ]}
      />

      {children}
    </div>
  );
}

function ProgramMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "hours" | "danger" | "neutral";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs",
        tone === "hours" && "border-line bg-surface text-ink",
        tone === "danger" && "border-danger-line bg-danger-soft text-danger-ink",
        tone === "neutral" && "border-line bg-surface text-muted-fg",
      )}
    >
      <span className="font-medium">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function shortHours(value: string) {
  return value.replace(/hours?/, "hrs");
}
