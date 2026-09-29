"use client";

import { useId, useState } from "react";

import { Avatar } from "@/components/avatar";
import { Select } from "@/components/select";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, NameInput } from "@/components/ui/field";
import {
  SaveState,
  saveStateFrom,
  useSaveState,
} from "@/components/ui/save-state";
import { SettingsRow } from "@/components/ui/settings-row";
import { SubmitButton } from "@/components/ui/submit-button";
import { completeMentorProfile } from "@/lib/actions/mentors";
import {
  removeOwnAvatar,
  setOwnAvatar,
  updateOwnName,
} from "@/lib/actions/profile";
import {
  completeOnboarding,
  completeStudentProfile,
} from "@/lib/actions/students";
import { AVATAR_ACCEPT, AVATAR_PX } from "@/lib/avatar";
import type { ActionState } from "@/lib/actions/shared";
import type { ProgramOption } from "@/lib/queries";

/**
 * Every form that writes YOUR OWN record: the two on /settings, and the three
 * steps of /onboarding.
 *
 * They are one file because they were four, and three of the four asked for the
 * same thing. "Full name" had three implementations — `onboarding-form.tsx`'s
 * `NameField`, `mentor-profile-form.tsx` and `own-name-form.tsx` — and the
 * first two shared a copied `inputClass` string that predates `ui/field.tsx`:
 * no `min-h-11`, so the very first field a student or a mentor ever typed into
 * was the one field in the app whose height was whatever the inherited
 * line-height happened to make it, rather than the 44px floor. One `NameField`
 * below, on the shared `Input`, is what stops that coming back.
 *
 * The onboarding steps redirect on success rather than reporting one: their
 * actions end in `redirect()`, so the reader is already on their home page
 * before a tick could be read. `SaveState` is still mounted for the failures.
 */

/* ------------------------------------------------------------------ *
 * Shared fields
 * ------------------------------------------------------------------ */

/**
 * The one name field. `NameInput` carries the rule — first and last, 80
 * characters — so the browser stops what `parseNameField` would reject anyway.
 */
function NameField({ defaultValue }: { defaultValue: string }) {
  return (
    <Field label="Full name" required hint="First and last name.">
      <NameInput name="name" required defaultValue={defaultValue} />
    </Field>
  );
}

/**
 * The handle a mentor actually messages you on. Stored without the `@` —
 * `parseTelegramField` strips it — so the placeholder shows the bare form and
 * the hint says who reads it, which is the only reason a student is being asked.
 */
function TelegramField() {
  return (
    <Field
      label="Telegram username"
      required
      hint="How your mentors reach you between sessions."
    >
      <Input
        name="telegramUsername"
        type="text"
        required
        placeholder="username"
      />
    </Field>
  );
}

/* ------------------------------------------------------------------ *
 * Onboarding steps — /onboarding
 * ------------------------------------------------------------------ */

/**
 * A mentor's whole registration: their name.
 *
 * Google does not always supply one, and a mentor with no name is labelled by
 * email on every session row, chip and booking card their students read. It is
 * the same field as the Settings one below, asked once at the door.
 */
export function NameStepForm({ defaultName }: { defaultName: string }) {
  const [, action, save] = useSaveState(completeMentorProfile);

  return (
    <form action={action} className="space-y-4">
      <NameField defaultValue={defaultName} />
      <SubmitButton pendingText="Saving…" className="w-full">
        Continue
      </SubmitButton>
      <SaveState state={save} />
    </form>
  );
}

/**
 * First sign-in for a student staff registered: confirm the name, add the
 * Telegram handle. Their program was chosen for them, so there is nothing to
 * pick and nothing to approve — this step ends on their home.
 */
export function DetailsStepForm({ defaultName }: { defaultName: string }) {
  const [, action, save] = useSaveState(completeStudentProfile);

  return (
    <form action={action} className="space-y-4">
      <NameField defaultValue={defaultName} />
      <TelegramField />
      <SubmitButton pendingText="Saving…" className="w-full">
        Save and continue
      </SubmitButton>
      <SaveState state={save} />
    </form>
  );
}

/**
 * The self-signup: an email nobody registered, so the student says which
 * program they are in and waits for an admin to agree.
 *
 * The cohort select is keyed on the program, so switching program cannot leave
 * the previous program's cohort id in the hidden input the form submits —
 * `resolveEnrollment` would refuse it, but only after the student had filled
 * the form in twice.
 */
export function RegistrationStepForm({
  defaultName,
  programs,
}: {
  defaultName: string;
  programs: ProgramOption[];
}) {
  const [, action, save] = useSaveState(completeOnboarding);
  const [programId, setProgramId] = useState("");
  const cohorts = programs.find((p) => p.id === programId)?.cohorts ?? [];

  return (
    <form action={action} className="space-y-4">
      <NameField defaultValue={defaultName} />
      <TelegramField />

      {/* Not a `Field`: `Select` is a combobox built from buttons, and a
          <label> wrapping one has nothing to label. Its own `ariaLabel` names
          it instead. */}
      <div>
        <span className="block text-sm font-medium text-ink">
          Your program
          <span className="text-accent-ink"> *</span>
        </span>
        <div className="mt-1.5">
          <Select
            name="programId"
            ariaLabel="Your program"
            options={programs.map((p) => ({ value: p.id, label: p.name }))}
            onChange={setProgramId}
          />
        </div>
      </div>

      {cohorts.length > 0 && (
        <div>
          <span className="block text-sm font-medium text-ink">
            Your cohort
            <span className="text-accent-ink"> *</span>
          </span>
          <div className="mt-1.5">
            <Select
              key={programId}
              name="cohortId"
              ariaLabel="Your cohort"
              options={cohorts.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
        </div>
      )}

      <SubmitButton pendingText="Submitting…" className="w-full">
        Submit registration
      </SubmitButton>
      <SaveState state={save} />
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Settings rows — /settings
 * ------------------------------------------------------------------ */

/**
 * The name that labels you everywhere — chips, session rows, your students'
 * booking cards. Same field as the signup step, kept editable.
 */
export function OwnNameForm({ defaultName }: { defaultName: string }) {
  const id = useId();
  const [name, setName] = useState(defaultName);
  // The comparison needs no reset: the action revalidates, so a saved name
  // comes back as a new `defaultName` and this goes false on its own.
  const [, action, save] = useSaveState(updateOwnName, name !== defaultName);

  return (
    <SettingsRow
      label="Full name"
      htmlFor={id}
      control={
        <form action={action} className="flex flex-wrap items-end gap-2">
          <NameInput
            id={id}
            name="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="min-w-56 flex-1"
          />
          <SubmitButton pendingText="Saving…">Save</SubmitButton>
        </form>
      }
      state={<SaveState state={save} />}
    />
  );
}

/**
 * Square-crop, downscale, and re-encode a chosen image entirely in the browser.
 *
 * Doing it here rather than on the server is what keeps `sharp` (a native
 * dependency that has to build on Render) out of the project, and it means a
 * 6MB phone photo becomes ~30KB before it ever touches the network — well under
 * the 1MB server-action body limit.
 *
 * `imageOrientation: "from-image"` matters: without it, portrait photos from
 * phones arrive rotated, because the rotation lives in EXIF rather than in the
 * pixels.
 */
async function toSquareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    // Center crop to a square before scaling, so faces aren't squashed.
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_PX;
    canvas.height = AVATAR_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't process images.");
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_PX,
      AVATAR_PX
    );

    const encode = (type: string) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
    // Every current browser encodes WebP; the JPEG fallback covers the ones
    // that quietly return null instead of erroring.
    const blob = (await encode("image/webp")) ?? (await encode("image/jpeg"));
    if (!blob) throw new Error("This browser can't process images.");
    return blob;
  } finally {
    bitmap.close();
  }
}

/**
 * Your own profile picture: what you look like now, a button to replace it, and
 * one to drop back to your initials badge.
 *
 * A local preview goes up the moment the resize finishes, so the change reads
 * as instant even though the server round-trip and revalidation follow.
 */
export function AvatarForm({
  person,
}: {
  person: {
    id: string;
    name: string | null;
    email: string;
    avatarUpdatedAt: Date | null;
  };
}) {
  const [state, setState] = useState<ActionState>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const hasPicture = Boolean(preview ?? person.avatarUpdatedAt);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Let the same file be picked again after a failure.
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    setState(null);
    try {
      const resized = await toSquareImage(file);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(resized);
      });

      const body = new FormData();
      body.append("avatar", resized, "avatar.webp");
      setState(await setOwnAvatar(body));
    } catch (error) {
      setPreview(null);
      setState({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "That image couldn't be read. Try a PNG or JPEG.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setState(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setState(await removeOwnAvatar());
    setBusy(false);
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        {/* A local object URL for the picture just chosen — nothing for the
            next/image optimizer to fetch or improve. */}
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full bg-canvas object-cover"
          />
        ) : (
          <Avatar
            person={person}
            className="h-16 w-16 text-xl"
          />
        )}

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={buttonClasses(
                "secondary",
                "sm",
                busy ? "cursor-not-allowed opacity-50" : "cursor-pointer"
              )}
            >
              {busy ? "Working…" : hasPicture ? "Change picture" : "Upload picture"}
              <input
                type="file"
                accept={AVATAR_ACCEPT}
                disabled={busy}
                onChange={onPick}
                className="sr-only"
              />
            </label>
            {hasPicture && (
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={onRemove}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
      <SaveState state={saveStateFrom(state, busy)} />
    </div>
  );
}
