import { LinkButton } from "@/components/ui/button";
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
        backLabel={toIndex ? "Programs" : "Home"}
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
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {/* One primary: granting time is what a program admin opens this
                page to do that no other page does for the whole program. */}
            <LinkButton href={`${base}/allocate`} variant="primary" size="md">
              Allocate time
            </LinkButton>
            {/* The program travels with it: a student in two of them has two
                balances, and the one being looked at is the one this log
                should land in. */}
            <LinkButton
              href={`/sessions/new?program=${program.id}`}
              variant="secondary"
              size="md"
            >
              Log a session
            </LinkButton>
          </span>
        }
      />

      {/* What the program holds, as a stat row: label over value, space
          between, no boxes. It was a wrapping row of bordered pills, amber
          ones among them, which read as seven buttons. Colour is on the VALUE
          and only where the value is a problem. */}
      <dl className="flex flex-wrap gap-x-8 gap-y-3 px-1">
        <ProgramMetric label="Students" value={String(totals.students)} />
        <ProgramMetric label="Mentors" value={String(mentors)} />
        <ProgramMetric label="Completed" value={formatRough(totals.completed)} />
        <ProgramMetric
          label="Remaining"
          value={formatRough(totals.remaining)}
          tone={totals.remaining < 0 ? "danger" : undefined}
        />
        {/* The ones below exist only when nonzero — a healthy program's
            masthead is unchanged, and the numbers `programTotals` already
            computes stop being invisible precisely where they matter. */}
        {totals.missed > 0 && (
          <ProgramMetric label="Missed" value={formatRough(totals.missed)} tone="warn" />
        )}
        {totals.forfeited > 0 && (
          <ProgramMetric
            label="Expired unused"
            value={formatRough(totals.forfeited)}
            tone="warn"
          />
        )}
        {totals.extra > 0 && (
          <ProgramMetric label="Extra" value={formatRough(totals.extra)} />
        )}
        {totals.overdrawn > 0 && (
          // A count of students, not minutes — the value has to say which.
          <ProgramMetric
            label="Overdrawn"
            value={`${totals.overdrawn} ${totals.overdrawn === 1 ? "student" : "students"}`}
            tone="danger"
          />
        )}
        {/* The column decides, never the program's name — renaming the
            Master's Program used to switch the money off across the app
            (`Program.tracksPayment`, schema). */}
        {program.tracksPayment && (
          <ProgramMetric label="Paid" value={formatMoney(totals.paid)} />
        )}
      </dl>

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
  /** Only for a figure that is a problem. Everything else is ink. */
  tone?: "warn" | "danger";
}) {
  return (
    <div>
      <dt className="text-[0.8125rem] text-muted-fg">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-[1.25rem] font-semibold tabular-nums",
          tone === "warn" ? "text-warn-ink" : tone === "danger" ? "text-danger-ink" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
