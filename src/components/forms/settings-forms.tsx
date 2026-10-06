"use client";

import { useId, useState } from "react";

import {
  setNotificationPreference,
  setWeeklyDigest,
} from "@/lib/actions/email-prefs";
import { setOwnTelegram } from "@/lib/actions/profile";
import { inputClasses } from "@/components/ui/field";
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
  const dirty = handle.trim().replace(/^@/, "") !== defaultHandle;
  const [, action, save] = useSaveState(setOwnTelegram, dirty);

  return (
    <SettingsRow
      label="Telegram"
      htmlFor={id}
      state={<SaveState state={save} />}
      control={
        <form action={action} className="flex items-center gap-2">
          {/* The "@" is drawn, not typed: the server strips one anyway, and
              a bare "username" placeholder left students unsure whether to
              include it. Required here as it is at sign-in — a field that
              looks optional and is not is how a student learns the rule from
              an error message. */}
          <div className="relative min-w-0 flex-1">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-body text-muted-fg"
            >
              @
            </span>
            {/* The field chrome with its left padding swapped rather than
                overridden: `cn` does not merge, so a `pl-7` added after
                `px-3.5` would race it on CSS order. */}
            <input
              id={id}
              name="telegramUsername"
              required
              value={handle}
              onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))}
              placeholder="your_username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={inputClasses.replace("px-3.5", "pl-7 pr-3.5")}
            />
          </div>
          {/* Only lit once there is something to save. An always-blue Save
              beside an unchanged field asked to be pressed for nothing, and
              two of them on one page was two primary buttons at rest. */}
          <SubmitButton
            pendingText="Saving…"
            variant={dirty ? "primary" : "secondary"}
            disabled={!dirty}
          >
            Save
          </SubmitButton>
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
      // Names its channel: the switch sat at the Email column's x, above the
      // "In app / Email" header, and could be read as either.
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
    hint?: string;
    inApp: boolean;
    email: boolean;
  }[];
}) {
  return (
    <div>
      {/* The two columns are named once, over the switches, the way a matrix
          is. Each row used to carry "In the app" and "Email" beside its own
          switches, which wrapped the longer categories onto two lines on a
          phone and left the switches at a different x in every row. */}
      <div
        aria-hidden="true"
        className="flex justify-end gap-4 pt-2 text-center text-xs font-medium text-muted-fg"
      >
        <span className="w-[3.25rem]">In app</span>
        <span className="w-[3.25rem]">Email</span>
      </div>
      <div className="divide-y divide-line">
        {categories.map((c) => (
          <CategoryRow key={c.key} category={c} />
        ))}
      </div>
    </div>
  );
}

function CategoryRow({
  category,
}: {
  category: { key: string; label: string; hint?: string; inApp: boolean; email: boolean };
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
      className="flex min-h-11 items-center justify-between gap-x-4 py-2"
    >
      <input type="hidden" name="category" value={category.key} />
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-ink">{category.label}</span>
        {category.hint && (
          <span className="mt-0.5 block text-xs text-muted-fg">{category.hint}</span>
        )}
      </span>
      {/* The last switch sits on the row's right edge, under the weekly
          summary's switch above it, so all three columns line up. */}
      <div className="flex shrink-0 items-center gap-4">
        <Switch
          name="inApp"
          checked={inApp}
          onChange={flip(setInApp)}
          aria-label={`${category.label} — in the app`}
        />
        <Switch
          name="email"
          checked={email}
          onChange={flip(setEmail)}
          aria-label={`${category.label} — by email`}
        />
      </div>
    </form>
  );
}
