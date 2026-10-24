"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo } from "react";

import { StarRating } from "@/components/forms/feedback-forms";
import { CheckIcon } from "@/components/icons";
import { Select } from "@/components/select";
import { EmailInput, Field, Input, Textarea } from "@/components/ui/field";
import { RequiredMark } from "@/components/ui/required-mark";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  checkPartnerEmail,
  checkPartnerStaffEmail,
  submitPartnerFeedback,
} from "@/lib/actions/partner-feedback";
import type { ActionState } from "@/lib/actions/shared";

/**
 * The public forms a partner school's students fill in on their phones, from
 * a link in a Telegram group. No account, so no SaveState tick: a check-in
 * moves on to the next step, and a submit becomes the done screen.
 */

const COMMENT_MAX = 2000;

const card = "space-y-4 rounded-xl bg-surface p-4 shadow-sm sm:p-5";

function failure(state: ActionState) {
  return state && !state.ok ? state : null;
}

/** Step one. On a listed email the pass is set and the page re-renders past it. */
export function PartnerEmailForm({
  slug,
  purpose = "student",
}: {
  slug: string;
  /** Which list the address is checked against: the students' or the staff's. */
  purpose?: "student" | "staff";
}) {
  const router = useRouter();
  const check = useMemo(
    () => (purpose === "staff" ? checkPartnerStaffEmail : checkPartnerEmail).bind(null, slug),
    [slug, purpose]
  );
  const [state, action] = useActionState(check, null);
  const failed = failure(state);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={action} className={card}>
      <Field
        label="Your email"
        required
        error={failed?.field === "email" ? failed.error : undefined}
      >
        <EmailInput
          name="email"
          required
          // Kept on a refusal: the usual mistake is one letter, not the whole address.
          defaultValue={failed?.values?.email ?? ""}
        />
      </Field>
      {failed && failed.field !== "email" && (
        <p role="alert" className="text-sm text-danger-ink">
          {failed.error}
        </p>
      )}
      <SubmitButton pendingText="Checking…">Continue</SubmitButton>
    </form>
  );
}

/**
 * The submit half both feedback forms share: the action bound to this partner
 * and kind, and what a refusal means for the page behind the form.
 *
 * `field: "pass"` is the pass gone — expired, signed out, or the email taken
 * off the list mid-form — so the page is asked again and falls back to the
 * email step. `mentorId` is refreshed too: the likeliest reason a listed
 * mentor is refused is that they were unticked after this page loaded, and a
 * fresh page is a fresh dropdown.
 */
function useFeedbackAction(slug: string, kind: "MENTOR" | "SESSION") {
  const router = useRouter();
  const submit = useMemo(
    () => submitPartnerFeedback.bind(null, slug, kind),
    [slug, kind]
  );
  const [state, action] = useActionState(submit, null);
  const failed = failure(state);

  useEffect(() => {
    if (failed?.field === "pass" || failed?.field === "mentorId") router.refresh();
  }, [failed, router]);

  return { state, action, failed };
}

/** The errors that have no field box of their own to sit under. */
function FormError({ failed, under }: { failed: ReturnType<typeof failure>; under: string[] }) {
  if (!failed || (failed.field && under.includes(failed.field))) return null;
  return (
    <p role="alert" className="text-sm text-danger-ink">
      {failed.error}
    </p>
  );
}

function FeedbackField({ failed }: { failed: ReturnType<typeof failure> }) {
  return (
    <Field
      label="Feedback"
      required
      error={failed?.field === "comment" ? failed.error : undefined}
    >
      <Textarea
        name="comment"
        rows={4}
        required
        maxLength={COMMENT_MAX}
        defaultValue={failed?.values?.comment ?? ""}
      />
    </Field>
  );
}

export function PartnerMentorForm({
  slug,
  mentors,
}: {
  slug: string;
  mentors: { id: string; label: string }[];
}) {
  const { state, action, failed } = useFeedbackAction(slug, "MENTOR");
  if (state?.ok) return <PartnerDone again={`/f/${slug}/mentor`} />;

  return (
    <form action={action} className={card}>
      {/* A span, not Field's <label>: Select's trigger is a button, and a
          label around it would forward every tap on the caption to it. */}
      <div className="block">
        <span className="block text-sm font-medium text-ink">
          Mentor<RequiredMark />
        </span>
        <div className="mt-1.5">
          <Select
            name="mentorId"
            ariaLabel="Mentor"
            placeholder="Choose a mentor"
            requiredMessage="Pick who you're rating."
            title="Mentor"
            // Not echoed after a refused mentor: that choice is the one the
            // refreshed list may no longer hold.
            defaultValue={failed?.field === "mentorId" ? "" : (failed?.values?.mentorId ?? "")}
            options={mentors.map((m) => ({ value: m.id, label: m.label }))}
          />
        </div>
      </div>
      <StarRating name="rating" idPrefix="partner-mentor-rating" />
      <FeedbackField failed={failed} />
      <FormError failed={failed} under={["comment"]} />
      <SubmitButton pendingText="Sending…">Send</SubmitButton>
    </form>
  );
}

export function PartnerSessionForm({ slug }: { slug: string }) {
  const { state, action, failed } = useFeedbackAction(slug, "SESSION");
  if (state?.ok) return <PartnerDone again={`/f/${slug}/session`} />;
  const errorFor = (name: string) => (failed?.field === name ? failed.error : undefined);

  return (
    <form action={action} className={card}>
      <Field label="Session number" required error={errorFor("sessionNumber")}>
        <Input
          name="sessionNumber"
          type="number"
          inputMode="numeric"
          min={1}
          max={999}
          step={1}
          required
          defaultValue={failed?.values?.sessionNumber ?? ""}
        />
      </Field>
      <Field label="Your name" required error={errorFor("name")}>
        <Input
          name="name"
          autoComplete="name"
          maxLength={100}
          required
          defaultValue={failed?.values?.name ?? ""}
        />
      </Field>
      <StarRating name="rating" idPrefix="partner-session-rating" />
      <FeedbackField failed={failed} />
      <FormError failed={failed} under={["sessionNumber", "name", "comment"]} />
      <SubmitButton pendingText="Sending…">Send</SubmitButton>
    </form>
  );
}

/**
 * The done screen. "Leave another" is a full load of the form's own page, not
 * a client reset: stars, dropdown and action state all start over, and the
 * page checks the pass again on the way in.
 */
export function PartnerDone({ again }: { again: string }) {
  return (
    <div role="status" className={card}>
      <p className="flex items-baseline gap-2 text-body font-medium text-ink">
        <CheckIcon className="check-draw h-4 w-4 shrink-0 translate-y-0.5" />
        Thanks — your feedback was sent.
      </p>
      <a
        href={again}
        className="inline-flex min-h-11 items-center font-semibold text-brand hover:text-brand-dark"
      >
        Leave another
      </a>
    </div>
  );
}
