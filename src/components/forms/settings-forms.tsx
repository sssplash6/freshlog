"use client";

import { useId, useState } from "react";

import {
  setNotificationPreference,
  setWeeklyDigest,
} from "@/lib/actions/email-prefs";
import { setOwnTelegram } from "@/lib/actions/profile";
import { Input } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SettingsRow } from "@/components/ui/settings-row";
import { SubmitButton } from "@/components/ui/submit-button";
import { Switch } from "@/components/ui/switch";

/**
 * The rows on /settings that had no form of their own, because the things they
 * change were never editable from anywhere.
 */

/**
 * A student's Telegram handle.
 *
 * Captured once during onboarding and then frozen: somebody who mistyped it,
 * or changed it later, had no way to correct it and no way to know that was
 * why nobody was messaging them.
 */
export function OwnTelegramForm({ defaultHandle }: { defaultHandle: string }) {
  const id = useId();
  const [handle, setHandle] = useState(defaultHandle);
  // No reset needed: the action revalidates, so a saved handle comes back as a
  // new `defaultHandle` and the dirty flag clears itself.
  const [, action, save] = useSaveState(setOwnTelegram, handle !== defaultHandle);

  return (
    <SettingsRow
      label="Telegram"
      htmlFor={id}
      state={<SaveState state={save} />}
      control={
        <form action={action} className="flex flex-wrap items-center gap-2">
          {/* Required here as it is at sign-in: the server refuses an empty
              handle either way, and a field that looks optional and is not is
              how a student learns the rule from an error message. */}
          <Input
            id={id}
            name="telegramUsername"
            required
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="username"
            className="w-48"
          />
          <SubmitButton size="sm">Save</SubmitButton>
        </form>
      }
    />
  );
}

/**
 * The Monday email.
 *
 * It lived at the bottom of the notification feed — a list of things that have
 * already happened, which is not where anybody goes to change what will happen.
 * The other way to switch it off is still the link in the footer of the email
 * itself, for people who will not sign in to say stop.
 */
export function WeeklyDigestForm({ defaultOn }: { defaultOn: boolean }) {
  const id = useId();
  const [on, setOn] = useState(defaultOn);

  return (
    <SettingsRow
      label="Weekly summary"
      htmlFor={id}
      trailing
      control={
        <form action={setWeeklyDigest} className="flex items-center gap-2">
          {/* Flip is the whole interaction: the switch submits itself, the way
              a Settings row does on a phone. A checkbox plus a Save button
              reads as a form; this reads as a preference. A failed flip still
              surfaces — rejected actions land on the toaster. */}
          <Switch
            id={id}
            name="weeklyDigest"
            checked={on}
            onChange={(e) => {
              setOn(e.target.checked);
              e.target.form?.requestSubmit();
            }}
            aria-label="Weekly summary"
          />
        </form>
      }
    />
  );
}

/**
 * The per-category matrix: what reaches you in the app, and what by email.
 *
 * Six rows, not seventeen. A person deciding what they want to hear about is
 * answering "do I care about meetings", not "do I care about INTERVIEW_MOVED"
 * — and a preference screen with a row per notification type is a preference
 * screen nobody finishes reading.
 *
 * Each row saves itself. The default — in the app, not by email — is what
 * everybody had before this existed, and setting a row back to it deletes the
 * row rather than storing a no-op.
 */
export function NotificationMatrix({
  categories,
}: {
  categories: {
    key: string;
    label: string;
    inApp: boolean;
    email: boolean;
  }[];
}) {
  return (
    <div className="divide-y divide-line">
      {categories.map((c) => (
        <CategoryRow key={c.key} category={c} />
      ))}
    </div>
  );
}

function CategoryRow({
  category,
}: {
  category: { key: string; label: string; inApp: boolean; email: boolean };
}) {
  const [inApp, setInApp] = useState(category.inApp);
  const [email, setEmail] = useState(category.email);
  // Either switch submits the pair — the row is one preference, and a flip is
  // the whole interaction, not half of a form.
  const flip = (set: (v: boolean) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.checked);
    e.target.form?.requestSubmit();
  };

  return (
    <form
      action={setNotificationPreference}
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2"
    >
      <input type="hidden" name="category" value={category.key} />
      <div className="min-w-0">
        <span className="text-[0.9375rem] font-medium text-ink">{category.label}</span>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex min-h-11 items-center gap-2 text-[0.8125rem] text-muted-fg">
          <Switch
            name="inApp"
            checked={inApp}
            onChange={flip(setInApp)}
            aria-label={`${category.label} — in the app`}
          />
          In the app
        </label>
        <label className="flex min-h-11 items-center gap-2 text-[0.8125rem] text-muted-fg">
          <Switch
            name="email"
            checked={email}
            onChange={flip(setEmail)}
            aria-label={`${category.label} — by email`}
          />
          Email
        </label>
      </div>
    </form>
  );
}
