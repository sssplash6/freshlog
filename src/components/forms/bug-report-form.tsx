"use client";

import { useActionState, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { reportBug } from "@/lib/actions/bugs";
import {
  BUG_DESCRIPTION_MAX,
  BUG_SHOT_ACCEPT,
  BUG_SHOT_MAX_BYTES,
  BUG_SHOT_MAX_EDGE,
  BUG_TITLE_MAX,
} from "@/lib/bugs";

/**
 * Scale a screenshot down and re-encode it as WebP in the browser, as avatars
 * are, so a retina capture becomes a few hundred KB before it touches the
 * network — under the 1MB server-action body limit — and no native image
 * dependency is needed on the server. Each failed attempt shrinks it further.
 *
 * The server re-checks size and format; this is a convenience, not a guarantee.
 */
async function toScreenshot(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    let scale = Math.min(1, BUG_SHOT_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 4; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser can't process images.");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const encode = (type: string) =>
        new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.8));
      const blob = (await encode("image/webp")) ?? (await encode("image/jpeg"));
      if (blob && blob.size <= BUG_SHOT_MAX_BYTES) return blob;
      scale *= 0.7;
    }
    throw new Error("That image is too large to attach.");
  } finally {
    bitmap.close();
  }
}

/**
 * Report a bug: what went wrong, and optionally a picture of it. The page the
 * reader came from rides along as a hidden field — the server decides whether
 * it is one of ours.
 */
export function ReportBugForm({ from }: { from: string | null }) {
  const [state, action] = useActionState(reportBug, null);
  const [shot, setShot] = useState<Blob | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    setShotError(null);
    setShot(null);
    if (!file) return;
    try {
      setShot(await toScreenshot(file));
    } catch (error) {
      setShotError(error instanceof Error ? error.message : "That image couldn't be attached.");
    }
  }

  // The resized blob goes in here, not the picker's raw file: the picker has no
  // `name`, so nothing it holds is submitted.
  function submit(data: FormData) {
    data.delete("screenshot");
    if (shot) data.set("screenshot", shot, "screenshot.webp");
    return action(data);
  }

  const failed = state && !state.ok ? state : null;
  const fieldError = (name: string) => (failed?.field === name ? failed.error : undefined);

  return (
    <form action={submit} className="max-w-xl space-y-4 rounded-xl bg-surface p-4 shadow-sm sm:p-5">
      <input type="hidden" name="from" value={from ?? ""} />

      <Field label="What went wrong?" required error={fieldError("title")}>
        <Input
          name="title"
          measure="md"
          required
          maxLength={BUG_TITLE_MAX}
          defaultValue={failed?.values?.title ?? ""}
        />
      </Field>

      <Field label="Tell us more" required error={fieldError("description")}>
        <Textarea
          name="description"
          measure="lg"
          required
          rows={6}
          maxLength={BUG_DESCRIPTION_MAX}
          defaultValue={failed?.values?.description ?? ""}
        />
      </Field>

      {/* The same picker as a profile picture: a button-shaped label over a
          visually hidden input. */}
      <Field label="Screenshot (optional)" error={shotError ?? undefined}>
        <span className={buttonClasses("secondary", "md", "cursor-pointer")}>
          {shot ? "Replace" : "Choose image"}
        </span>
        <input
          type="file"
          accept={BUG_SHOT_ACCEPT}
          onChange={(event) => void pick(event.target.files?.[0])}
          className="sr-only"
        />
      </Field>

      {/* Tied to the blob that will actually be sent, not to the file picker.
          React resets the picker when a refused submission settles, so it says
          "No file chosen" while the resized image is still held here — and
          would be sent again. This row is the truth, and the way to drop it. */}
      {shot && (
        <p className="flex flex-wrap items-center gap-x-3 text-sm text-ink">
          <span>Screenshot attached</span>
          <button
            type="button"
            onClick={() => setShot(null)}
            className="min-h-11 font-semibold text-brand hover:text-brand-dark"
          >
            Remove
          </button>
        </p>
      )}

      {failed && !failed.field && (
        <p role="alert" className="text-sm text-danger-ink">
          {failed.error}
        </p>
      )}

      <SubmitButton pendingText="Sending…">Send report</SubmitButton>
    </form>
  );
}
