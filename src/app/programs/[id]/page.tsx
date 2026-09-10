import { PersonChip } from "@/components/person-chip";
import { programTone } from "@/lib/program-tone";
import { ArrowLink } from "@/components/ui/link";
import { Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { requireProgramScope } from "@/lib/dal";
import { formatDate, formatDuration } from "@/lib/format";
import { programTotals } from "@/lib/hours";
import { recentMeetings } from "@/lib/queries";

import { programOf, programPairings, programStudents } from "../reads";

/** Past ten, a list of mentors is a page of its own. */
const MENTORS_SHOWN = 10;

/**
 * The program at a glance: what needs a person, who teaches here, and when it
 * was last taught in.
 *
 * Reading, not doing. Everything that changes the program's shape is one tab
 * over in Settings, and the roster with its add form is in Students — which is
 * what the page this replaces could not say, because it carried an editable
 * 12-row `MeetingsLog`, a violet "Tasks in flight" panel, and a Mentors list
 * byte-identical to the one on the settings page beneath it (§6.12).
 */
export default async function ProgramOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireProgramScope(id);

  // The first three are the layout's reads, memoised: opening a program asks
  // for its row, its roster and its pairings once between the two files.
  const [program, students, pairings, [lastSession]] = await Promise.all([
    programOf(id),
    programStudents(id),
    programPairings(id),
    recentMeetings({ programId: id, take: 1 }),
  ]);

  // §8.6: the one helper, over the unsliced roster — never a second reducer.
  const totals = programTotals(students);

  // One line per MENTOR: somebody paired with three cohorts of this program is
  // one person teaching here, not three rows.
  const mentors = new Map<
    string,
    {
      mentor: (typeof pairings)[number]["mentor"];
      cohorts: string[];
      missingLink: boolean;
    }
  >();
  for (const p of pairings) {
    const held = mentors.get(p.mentorId);
    const row = held ?? { mentor: p.mentor, cohorts: [], missingLink: false };
    if (p.cohort) row.cohorts.push(p.cohort.name);
    if (!p.calendlyUrl) row.missingLink = true;
    mentors.set(p.mentorId, row);
  }
  const mentorRows = [...mentors.values()];
  const spilled = mentorRows.length - MENTORS_SHOWN;

  return (
    <div className="space-y-6">
      <Section
        title="Mentors"
        count={mentorRows.length}
        action={
          spilled > 0 ? (
            <ArrowLink href={`/mentors?program=${program.id}`} className="text-[13px]">
              All mentors
            </ArrowLink>
          ) : undefined
        }
      >
        {mentorRows.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-fg sm:px-5">
            Nobody teaches here yet. Settings pairs a mentor with the program.
          </p>
        ) : (
          <ul className="divide-y divide-line/60 text-sm">
            {mentorRows.slice(0, MENTORS_SHOWN).map(({ mentor, cohorts, missingLink }) => (
              <li
                key={mentor.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  {/* "Their mentors can have matching colours." This is the
                      one page where that is unambiguous: every row belongs to
                      this program, so the chip can spend its hue on the place.
                      On /mentors, where a mentor may appear under three
                      programs, they keep their own. */}
                  <PersonChip
                    person={mentor}
                    size="sm"
                    href={`/mentors/${mentor.id}`}
                    tone={programTone(program.id)}
                  />
                  {cohorts.length > 0 && (
                    <span className="text-xs text-muted-fg">
                      {cohorts.join(" · ")}
                    </span>
                  )}
                </span>
                {missingLink && (
                  <StatusChip severity="attention">No booking link</StatusChip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* The delivery line, carrying the two figures the removed stat strip
          was the only place to read — logged and missed — and now linking to
          the ledger they came from. */}
      <p className="text-sm text-muted-fg">
        {lastSession
          ? `Last session ${formatDate(lastSession.date)} by ${lastSession.mentor.name ?? lastSession.mentor.email}`
          : "No sessions have been logged in this program"}
        {` · ${formatDuration(totals.completed)} completed`}
        {totals.missed > 0 && ` · ${formatDuration(totals.missed)} missed`}
        {" · "}
        {/* The figures above are lifetime. This is how somebody asks the same
            question of a week: the ledger, already filtered to this program,
            with the date chips on it. */}
        <ArrowLink href={`/sessions?program=${program.id}`} className="text-[13px]">
          All sessions
        </ArrowLink>
      </p>
    </div>
  );
}
