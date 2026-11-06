import {
  CreateInterviewTemplateForm,
  EditInterviewTemplateForm,
  RetireInterviewTemplateButton,
} from "@/components/forms/interview-template-forms";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { requireAdminAccess } from "@/lib/dal";
import { allInterviewTemplates, type StoredTemplate } from "@/lib/interview-template-store";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Interview templates" };

/**
 * The practice interviews students pick from, with their questions.
 *
 * Anyone who runs a program reads them here: before this page the questions
 * were in the code, and the people running the school had nowhere to see what
 * their students were rehearsing. Only platform admins change them, because a
 * template is offered to every program's students at once.
 */
export default async function InterviewTemplatesPage() {
  const user = await requireAdminAccess();
  const canEdit = user.platformAdmin;
  const templates = await allInterviewTemplates();
  const live = templates.filter((t) => t.retiredAt === null);
  const retired = templates.filter((t) => t.retiredAt !== null);

  return (
    <div className="space-y-4">
      <PageTitle
        backHref="/interviews"
        backLabel="Interview prep"
        title="Interview templates"
        subtitle={
          canEdit
            ? "Students pick one of these when they book a practice interview."
            : "Students pick one of these when they book a practice interview. A platform admin can change them."
        }
      />

      {canEdit && <CreateInterviewTemplateForm />}

      <Section title="In the picker" count={live.length}>
        {live.length === 0 ? (
          <EmptyState framed={false} title="No templates in the picker">
            Students cannot book a practice interview until one is added.
          </EmptyState>
        ) : (
          <TemplateList templates={live} canEdit={canEdit} />
        )}
      </Section>

      {retired.length > 0 && (
        <Section
          title="Retired"
          count={retired.length}
          caption="Not offered any more. Interviews already booked with them keep them."
        >
          <TemplateList templates={retired} canEdit={canEdit} />
        </Section>
      )}
    </div>
  );
}

function TemplateList({ templates, canEdit }: { templates: StoredTemplate[]; canEdit: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {templates.map((t) => (
        <li key={t.id} className="space-y-2 px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="font-semibold text-ink">{t.name}</h3>
              {t.summary && <p className="text-sm text-muted-fg">{t.summary}</p>}
            </div>
            {canEdit && (
              <RetireInterviewTemplateButton templateId={t.id} retired={t.retiredAt !== null} />
            )}
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-body text-ink">
            {t.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
          {canEdit && <EditInterviewTemplateForm template={t} />}
        </li>
      ))}
    </ul>
  );
}
