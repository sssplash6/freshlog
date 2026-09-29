import { CreateCohortForm } from "@/components/forms/program-forms";
import {
  ArchiveProgramButton,
  AssignMentorForm,
  DeleteCohortButton,
  DeleteProgramButton,
  RemoveMentorButton,
  RenameProgramForm,
  TrackPaymentToggle,
} from "@/components/forms/program-settings-forms";
import { PersonChip } from "@/components/person-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLink } from "@/components/ui/link";
import { Section } from "@/components/ui/section";
import { SettingsRow } from "@/components/ui/settings-row";
import { requireProgramScope } from "@/lib/dal";

import {
  PROGRAM_STATUS,
  mentorPool,
  programCohorts,
  programGrants,
  programOf,
  programPairings,
  programStudents,
} from "../../reads";

/**
 * A `ProgramStaff.role` by the name the grants editor gives it. It used to be
 * a sentence ("Reads this program"), which promised a limit the level does not
 * set on its own — the editor on Platform settings says what each one shows.
 */
const LEVEL: Record<string, string> = {
  ADMIN: "Admin",
  LEADER: "Leader",
  SALES: "Sales",
};

/**
 * How the program is set up: who teaches in it, how it is divided, who
 * administers it, what it asks for, and the two ways it ends.
 *
 * The gear the owner asked for — and the page it replaces was the right
 * grouping at an address nothing in the app linked to. Two things left it:
 *
 *   The "Enrolled students" panel, whose only control removed a student and
 *   deleted their account with it. Removal belongs on the person, beside the
 *   record it destroys, and that is where it now lives (`/students/[id]`).
 *
 *   The Mentors list that was byte-identical to the one on the overview. This
 *   one stays, because this is the one with the write controls on it: assigning
 *   and unassigning a mentor happens here. Assigning is also offered in the
 *   rail on the roster, where an empty program says it has nobody to teach.
 */
export default async function ProgramSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireProgramScope(id);

  const [program, students, pairings, cohorts, grants, allMentors] =
    await Promise.all([
      programOf(id),
      programStudents(id),
      programPairings(id),
      programCohorts(id),
      programGrants(id),
      mentorPool(),
    ]);

  const paired = new Set(pairings.map((p) => p.mentorId));
  const eligibleMentors = allMentors
    .filter((m) => !paired.has(m.id))
    .map((m) => ({ value: m.id, label: m.name ?? m.email }));
  const cohortOptions = cohorts.map((c) => ({ value: c.id, label: c.name }));
  const archived = program.status === PROGRAM_STATUS.ARCHIVED;

  const blockedReason =
    students.length > 0
      ? `${program.name} still has ${students.length} student${students.length === 1 ? "" : "s"}. Archive it instead, or move them first.`
      : grants.length > 0
        ? "Someone still administers this program. Remove their access on Platform settings first."
        : undefined;

  return (
    <div className="space-y-4">
      <Section
        title="Mentors"
        count={pairings.length > 0 ? pairings.length : undefined}
      >
        {pairings.length === 0 ? (
          <EmptyState framed={false} title="No mentors assigned">
            Assign one below, or allocate a student time from any mentor and
            they join this program automatically.
          </EmptyState>
        ) : (
          // Plain list rows, not settings rows: a person and the one thing you
          // can do to their pairing, on one line. As settings rows the name sat
          // top-left and its button dropped to the row's bottom-right.
          <ul className="divide-y divide-line">
            {pairings.map((p) => (
              <li
                key={p.id}
                className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 sm:px-5"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-[0.9375rem]">
                  <PersonChip
                    person={p.mentor}
                    size="sm"
                    href={`/mentors/${p.mentor.id}`}
                  />
                  {p.cohort && (
                    <span className="text-[0.8125rem] text-muted-fg">
                      {p.cohort.name}
                    </span>
                  )}
                </span>
                <RemoveMentorButton assignmentId={p.id} />
              </li>
            ))}
          </ul>
        )}
        {eligibleMentors.length > 0 && (
          <div className="border-t border-line px-4 py-3 sm:px-5">
            <AssignMentorForm
              programId={program.id}
              mentors={eligibleMentors}
              cohorts={cohortOptions}
            />
          </div>
        )}
      </Section>

      <Section
        title="Cohorts"
        caption={
          cohorts.length === 0
            ? "Flat — students belong to the program directly"
            : undefined
        }
        count={cohorts.length > 0 ? cohorts.length : undefined}
      >
        {cohorts.length > 0 && (
          <ul className="divide-y divide-line">
            {cohorts.map((c) => {
              const inUse =
                c._count.enrollments > 0 || c._count.mentorAssignments > 0;
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
                >
                  <div>
                    <div className="text-[0.9375rem] font-medium text-ink">{c.name}</div>
                    <div className="text-[0.8125rem] text-muted-fg">
                      {c._count.enrollments} student
                      {c._count.enrollments === 1 ? "" : "s"} ·{" "}
                      {c._count.mentorAssignments} mentor
                      {c._count.mentorAssignments === 1 ? "" : "s"}
                    </div>
                  </div>
                  {inUse ? (
                    <span className="text-[0.8125rem] text-muted-fg">
                      Not empty — move its people first
                    </span>
                  ) : (
                    <DeleteCohortButton cohortId={c.id} cohortName={c.name} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-line px-4 py-2 sm:px-5">
          <CreateCohortForm programId={program.id} />
        </div>
      </Section>

      {/* Read-only, deliberately: `/settings/platform` is the ONE place a grant
          is made, changed or removed (§8.4), so this says who holds one and
          sends the reader there rather than growing a second write surface.
          Only a platform admin can open that page, so only they get the link;
          everybody else is told where it happens and who to ask. */}
      <Section
        title="Admins"
        count={grants.length > 0 ? grants.length : undefined}
        caption="Granted on Platform settings"
        action={
          viewer.platformAdmin ? (
            <ArrowLink href="/settings/platform" className="text-[0.8125rem]">
              Manage on Platform settings
            </ArrowLink>
          ) : undefined
        }
      >
        {grants.length === 0 ? (
          <EmptyState framed={false} title="Nobody is granted this program">
            Only platform admins can see it until somebody is.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {grants.map((g) => (
              <li
                key={g.id}
                className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-4 py-3 text-[0.9375rem] sm:px-5"
              >
                <PersonChip person={g.user} size="sm" />
                <span className="text-[0.8125rem] text-muted-fg">
                  {LEVEL[g.role] ?? g.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Program">
        <div className="px-4 sm:px-5">
          <RenameProgramForm programId={program.id} currentName={program.name} />
          <TrackPaymentToggle
            programId={program.id}
            tracksPayment={program.tracksPayment}
          />
          <SettingsRow
            label={archived ? "Archived" : "Archive this program"}
            description={
              archived
                ? "It is out of the pickers and the lists. Its sessions and allocations are untouched."
                : "For a program that has finished. It leaves the pickers and the lists; every ledger page stays reachable."
            }
            control={
              <ArchiveProgramButton
                programId={program.id}
                programName={program.name}
                archived={archived}
              />
            }
          />
        </div>
      </Section>

      {/* No eyebrows on this page. "People", "Structure", "Access",
          "Identity" and "Permanent" each restated the title under it; the
          caption here says the one thing about deleting that is not obvious. */}
      <Section
        title="Delete this program"
        caption="Permanent, and only once nothing is left in it"
      >
        <div className="px-4 py-2 sm:px-5">
          <DeleteProgramButton
            programId={program.id}
            programName={program.name}
            blockedReason={blockedReason}
          />
        </div>
      </Section>
    </div>
  );
}
