"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";

import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { Switch } from "@/components/ui/switch";
import {
  addPartnerEmails,
  createPartner,
  removePartnerEmail,
  setPartnerMentors,
  updatePartner,
} from "@/lib/actions/partners";
import type { ActionState } from "@/lib/actions/shared";

/**
 * A platform admin's setup of a partner school's feedback form. Every action
 * here re-checks `platformAdmin` itself; these components only draw.
 *
 * Each section saves on its own, with its own tick (§5.8): renaming the
 * partner must not also re-post the mentor ticks somebody is halfway through.
 */

function failure(state: ActionState) {
  return state && !state.ok ? state : null;
}

/**
 * Name and link for a new partner. On success the action redirects to the
 * partner's settings, where its emails and mentors are the next thing to do,
 * so there is no success state to draw here.
 */
export function NewPartnerForm() {
  const [state, action] = useActionState(createPartner, null);
  const failed = failure(state);
  // Controlled, because React resets an uncontrolled form once its action
  // settles: "That link is already used." would arrive under an empty box,
  // with the name typed beside it gone too.
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  return (
    <form action={action} className="space-y-4 p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Name"
          required
          error={failed?.field === "name" ? failed.error : undefined}
        >
          <Input
            name="name"
            required
            maxLength={80}
            placeholder="Khana"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label="Link"
          required
          hint="Students open /f/ and this. Lowercase letters, digits and dashes."
          error={failed?.field === "slug" ? failed.error : undefined}
        >
          <Input
            name="slug"
            required
            maxLength={40}
            placeholder="khana"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </Field>
      </div>
      {failed && failed.field !== "name" && failed.field !== "slug" && (
        <p role="alert" className="text-sm text-danger-ink">
          {failed.error}
        </p>
      )}
      <SubmitButton pendingText="Adding…">Add partner</SubmitButton>
    </form>
  );
}

/** The partner's name, and whether its form takes feedback at all. */
export function PartnerDetailsForm({
  partnerId,
  name,
  active,
}: {
  partnerId: string;
  name: string;
  active: boolean;
}) {
  const id = useId();
  const save = useMemo(() => updatePartner.bind(null, partnerId), [partnerId]);
  const [result, action, state] = useSaveState(save);
  const failed = failure(result);

  return (
    <form action={action} className="space-y-4 p-4 sm:p-5">
      <Field
        label="Name"
        required
        hint="Shown to students above the form."
        error={failed?.field === "name" ? failed.error : undefined}
      >
        <Input name="name" required maxLength={80} defaultValue={name} />
      </Field>
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={id} className="min-w-0">
          <span className="block text-sm font-medium text-ink">Form open</span>
          <span className="block text-xs text-muted-fg">
            Off, the links answer as if they did not exist. Feedback already sent stays.
          </span>
        </label>
        <Switch id={id} name="active" defaultChecked={active} />
      </div>
      <div>
        <SubmitButton variant="secondary" pendingText="Saving…">
          Save
        </SubmitButton>
        <SaveState state={failed?.field === "name" ? { kind: "idle" } : state} />
      </div>
    </form>
  );
}

/**
 * One link and a button that copies it. The URL is shown as text too, so it
 * can be read out over the phone. Where the clipboard is refused (an insecure
 * origin, a denied permission) the button selects the link instead and says
 * so, rather than doing nothing visible.
 */
export function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState<"copied" | "selected" | null>(null);
  const text = useRef<HTMLElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    let outcome: "copied" | "selected" = "copied";
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const range = document.createRange();
      if (text.current) range.selectNodeContents(text.current);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      outcome = "selected";
    }
    setDone(outcome);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(null), 2400);
  }

  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <code ref={text} className="min-w-0 text-sm text-ink wrap-anywhere">
        {url}
      </code>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0"
        onClick={copy}
      >
        {done === "copied" ? (
          <>
            <CheckIcon className="h-3.5 w-3.5" />
            Copied
          </>
        ) : done === "selected" ? (
          "Selected, copy it"
        ) : (
          "Copy"
        )}
      </Button>
    </div>
  );
}

/**
 * Paste many, see what happened, remove one.
 *
 * The paste is split on lines, commas, semicolons and spaces by the action;
 * its reply ("Added 12. 3 already listed. 1 not valid: bob@.") is the tick's
 * own message, so the counts sit under the box they came from.
 */
export function PartnerEmailsForm({
  partnerId,
  emails,
}: {
  partnerId: string;
  emails: { id: string; email: string }[];
}) {
  const add = useMemo(() => addPartnerEmails.bind(null, partnerId), [partnerId]);
  const [result, action, state] = useSaveState(add);
  const failed = failure(result);

  return (
    <div>
      <form action={action} className="space-y-3 p-4 sm:p-5">
        <Field
          label="Add emails"
          hint="One per line, or separated by commas."
          error={failed?.field === "emails" ? failed.error : undefined}
        >
          <Textarea
            name="emails"
            rows={4}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={"aziza@example.com\nbobur@example.com"}
          />
        </Field>
        <div>
          <SubmitButton variant="secondary" pendingText="Adding…">
            Add emails
          </SubmitButton>
          <SaveState state={failed?.field === "emails" ? { kind: "idle" } : state} />
        </div>
      </form>
      {emails.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {emails.map((e) => (
            <EmailRow key={e.id} partnerId={partnerId} emailId={e.id} email={e.email} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EmailRow({
  partnerId,
  emailId,
  email,
}: {
  partnerId: string;
  emailId: string;
  email: string;
}) {
  const remove = useMemo(
    () => async () => removePartnerEmail(partnerId, emailId),
    [partnerId, emailId]
  );
  const [, action, save] = useSaveState(remove);

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 px-4 py-1.5 sm:px-5">
      <span className="min-w-0 text-sm text-ink wrap-anywhere">{email}</span>
      <div className="flex flex-col items-end">
        <ConfirmInline
          variant="quiet"
          action={action}
          pending={save.kind === "saving"}
          label="Remove"
          question="They can no longer send feedback. What they already sent stays."
          confirmLabel="Yes, remove"
          pendingLabel="Removing…"
        />
        {save.kind === "failed" && <SaveState state={save} />}
      </div>
    </li>
  );
}

/**
 * Which mentors this partner's students may rate: a tick per mentor, saved
 * together. Unticking hides a mentor from the form; what was said about them
 * stays on the partner's page.
 */
export function PartnerMentorsForm({
  partnerId,
  mentors,
}: {
  partnerId: string;
  mentors: { id: string; name: string | null; email: string; ticked: boolean }[];
}) {
  const save = useMemo(() => setPartnerMentors.bind(null, partnerId), [partnerId]);
  const [, action, state] = useSaveState(save);

  return (
    <form action={action}>
      <ul className="divide-y divide-line">
        {mentors.map((m) => (
          <li key={m.id} className="px-4 sm:px-5">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1.5">
              <input
                type="checkbox"
                name="mentorId"
                value={m.id}
                defaultChecked={m.ticked}
                className="h-5 w-5 shrink-0 accent-[var(--color-brand)]"
              />
              <span className="min-w-0">
                <span className="block text-body text-ink wrap-anywhere">
                  {m.name ?? m.email}
                </span>
                {/* The public dropdown lists mentors by name only, so it never
                    shows a staff address; a mentor with no name is left off
                    it, ticked or not. Said here, or the tick looks broken. */}
                {!m.name && (
                  <span className="block text-xs text-muted-fg">
                    No name yet. Students won&apos;t see them until they have one.
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="border-t border-line p-4 sm:px-5">
        <SubmitButton variant="secondary" pendingText="Saving…">
          Save mentors
        </SubmitButton>
        <SaveState state={state} />
      </div>
    </form>
  );
}
