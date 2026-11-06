"use client";

import { Disclosure } from "@/components/ui/disclosure";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  createInterviewTemplate,
  setInterviewTemplateRetired,
  updateInterviewTemplate,
} from "@/lib/actions/interview-templates";
import { TEMPLATE_LIMITS, type InterviewTemplate } from "@/lib/interview-templates";

/**
 * Writing a practice-interview template: the same three fields to make one and
 * to change one. The questions are one box, one per line, because a list of
 * questions is usually pasted from a document, not typed one field at a time.
 */
function TemplateFields({ template }: { template?: InterviewTemplate }) {
  return (
    <>
      <Field label="Name" required className="max-w-md">
        <Input
          name="name"
          type="text"
          required
          minLength={3}
          maxLength={TEMPLATE_LIMITS.name}
          defaultValue={template?.name}
          placeholder="e.g. Oxford tutorial"
        />
      </Field>
      <Field label="Summary" hint="One line under the name: who asks these, and why." className="max-w-xl">
        <Input
          name="summary"
          type="text"
          maxLength={TEMPLATE_LIMITS.summary}
          defaultValue={template?.summary}
        />
      </Field>
      <Field
        label="Questions"
        required
        hint={`One per line, in the order they are asked. Up to ${TEMPLATE_LIMITS.questions}.`}
      >
        <Textarea
          name="questions"
          required
          rows={Math.max(5, (template?.questions.length ?? 0) + 1)}
          defaultValue={template?.questions.join("\n")}
        />
      </Field>
    </>
  );
}

/** A new template, added at the end of the picker. */
export function CreateInterviewTemplateForm() {
  const [, action, save] = useSaveState(createInterviewTemplate);
  return (
    <Disclosure label="New template" variant="create" hint="Students can pick it as soon as it is saved.">
      <form action={action} className="space-y-3">
        <TemplateFields />
        <SubmitButton pendingText="Adding…">Add template</SubmitButton>
      </form>
      <SaveState state={save} />
    </Disclosure>
  );
}

/**
 * Change one template. Interviews not yet held ask the new questions; an
 * answer already given keeps the question it answered.
 */
export function EditInterviewTemplateForm({ template }: { template: InterviewTemplate }) {
  const [, action, save] = useSaveState(updateInterviewTemplate);
  return (
    <Disclosure label="Edit" hint="Booked interviews that have not happened yet get the new questions.">
      <form action={action} className="space-y-3">
        <input type="hidden" name="templateId" value={template.id} />
        <TemplateFields template={template} />
        <SubmitButton pendingText="Saving…">Save template</SubmitButton>
      </form>
      <SaveState state={save} />
    </Disclosure>
  );
}

/** Take a template out of the picker, or put a retired one back. */
export function RetireInterviewTemplateButton({
  templateId,
  retired,
}: {
  templateId: string;
  retired: boolean;
}) {
  const [, action, save] = useSaveState(setInterviewTemplateRetired);
  return (
    <div className="flex flex-col items-end gap-1">
      <form action={action}>
        <input type="hidden" name="templateId" value={templateId} />
        <input type="hidden" name="retire" value={retired ? "0" : "1"} />
        <SubmitButton variant="secondary" size="sm" pendingText={retired ? "Restoring…" : "Retiring…"}>
          {retired ? "Put back" : "Retire"}
        </SubmitButton>
      </form>
      <SaveState state={save} />
    </div>
  );
}
