import { EssayStageBar } from "@/components/essay-stage";
import {
  AddUniversityForm,
  SnapshotEditor,
  UniversityRowActions,
  type UniversityChoice,
} from "@/components/forms/application-forms";
import { Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { ieltsLabel, isRound, ROUND_LABEL, wordsLabel } from "@/lib/applications";

export type ApplicationView = {
  sat: number | null;
  ielts: number | null;
  school: string | null;
  gpa: string | null;
  essayStage: string | null;
  universities: {
    id: string;
    isPrimary: boolean;
    round: string | null;
    essayStage: string | null;
    university: UniversityChoice;
  }[];
};

/**
 * Where a student's application stands, at the top of their page for the
 * programs that track applications: the snapshot, the motivational essay, and
 * the universities with a supplemental each — the primary first.
 *
 * Read-only for a reader who may only read (a LEADER or SALES grant); every
 * control is the affordance for `applicationAccess`, which the actions ask
 * again.
 */
export function ApplicationSection({
  studentProfileId,
  application,
  editable,
  canCorrectWords,
  universities,
}: {
  studentProfileId: string;
  application: ApplicationView;
  editable: boolean;
  canCorrectWords: boolean;
  /** The shared list, for the add form. Empty when not editable. */
  universities: UniversityChoice[];
}) {
  const facts = [
    { label: "SAT", value: application.sat?.toString() ?? null },
    { label: "IELTS", value: application.ielts != null ? ieltsLabel(application.ielts) : null },
    { label: "School", value: application.school },
    { label: "GPA", value: application.gpa },
  ];
  // Primary first, then the others in the order they were added.
  const list = [...application.universities].sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary)
  );
  const primary = list.find((u) => u.isPrimary);

  return (
    <>
      <Section
        title="Application"
        action={
          editable ? (
            <SnapshotEditor
              studentProfileId={studentProfileId}
              current={{
                sat: application.sat,
                ielts: application.ielts,
                school: application.school,
                gpa: application.gpa,
              }}
            />
          ) : undefined
        }
      >
        <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0 bg-surface px-4 py-3 sm:px-5">
              <dt className="text-xs text-muted-fg">{fact.label}</dt>
              <dd
                className={
                  fact.value
                    ? "mt-0.5 break-words text-title font-semibold tabular-nums text-ink"
                    : "mt-0.5 text-title text-disabled"
                }
              >
                {fact.value ?? "—"}
              </dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-line px-4 py-3 sm:px-5">
          <p className="mb-1 text-sm font-medium text-ink">Motivational essay</p>
          <EssayStageBar
            stage={application.essayStage}
            label="Motivational essay"
            editable={editable}
            studentProfileId={studentProfileId}
            target="essay"
            showSteps
          />
        </div>
      </Section>

      <Section title="Universities" count={list.length}>
        {list.length === 0 && (
          <p className="px-4 py-3 text-body text-muted-fg sm:px-5">
            No universities on their list yet.
          </p>
        )}
        {list.length > 0 && (
          <ul className="divide-y divide-line">
            {list.map((row) => {
              const round = isRound(row.round) ? row.round : null;
              const words = row.university.supplementalWords;
              return (
                <li key={row.id} className="px-4 py-3 sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body font-medium text-ink">
                        <span className="min-w-0 break-words">{row.university.name}</span>
                        {row.isPrimary && (
                          <StatusChip severity="neutral">
                            {round ? (
                              <abbr title={ROUND_LABEL[round]} className="no-underline">
                                Primary · {round}
                              </abbr>
                            ) : (
                              "Primary"
                            )}
                          </StatusChip>
                        )}
                      </p>
                      <p className="text-xs text-muted-fg">
                        Supplemental: {wordsLabel(words).toLowerCase()}
                      </p>
                    </div>
                    {editable && (
                      <UniversityRowActions
                        studentProfileId={studentProfileId}
                        row={row}
                        canCorrectWords={canCorrectWords}
                      />
                    )}
                  </div>
                  {words > 0 && (
                    <div className="mt-1.5">
                      <EssayStageBar
                        stage={row.essayStage}
                        label={`${row.university.name} supplemental`}
                        editable={editable}
                        studentProfileId={studentProfileId}
                        target={row.id}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {editable && (
          // Open, not folded: adding a university is what this list is for
          // while it is being built, and a fold keyed on "the list is empty"
          // closed under the reader on their first add, hiding its receipt.
          <div className="border-t border-line px-4 py-3 sm:px-5">
            <AddUniversityForm
              studentProfileId={studentProfileId}
              universities={universities}
              onList={list.map((u) => u.university.id)}
              primaryName={primary?.university.name ?? null}
            />
          </div>
        )}
      </Section>
    </>
  );
}
