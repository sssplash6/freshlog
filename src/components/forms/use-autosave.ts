"use client";

import { useEffect, useRef } from "react";

import { useSaveState, type SaveState } from "@/components/ui/save-state";
import type { ActionState } from "@/lib/actions/shared";

type FormAction = (
  state: ActionState,
  formData: FormData,
) => Promise<ActionState>;

/** What the form would send, as a string — two of them are equal or they are not. */
function snapshot(form: HTMLFormElement): string {
  const parts: string[] = [];
  new FormData(form).forEach((value, key) => {
    parts.push(`${key}=${typeof value === "string" ? value : value.name}`);
  });
  return parts.join("&");
}

/**
 * A form that saves itself, in place of a Save button.
 *
 * Nobody opening a row's menu to correct a figure expects to then find the
 * button that makes the correction count: the edit is the intent, and a second
 * gesture to confirm it is a way to lose it. So the form submits when the edit
 * is finished — not on every keystroke, which would write (and notify about) a
 * grant of 1h, then 10h, then 100h on the way to typing "100".
 *
 * "Finished" is a choice or a departure:
 *   - a checkbox, radio or `<select>` changes: at once, it is a whole value;
 *   - focus leaves the FORM, not a field — tabbing from the minutes to the task
 *     picker that opens beside them is still one edit;
 *   - `flush()`, for controls that raise no `change` of their own (the date
 *     field's value is a hidden input).
 *
 * It sends only what differs from the last thing sent, so leaving a form
 * alone, or leaving it twice, writes nothing. A failure forgets what was sent,
 * so the same edit can be tried again from the "Try again" it shows.
 */
export function useAutosave(action: FormAction) {
  const [result, dispatch, save] = useSaveState(action);
  const formRef = useRef<HTMLFormElement>(null);
  const sent = useRef<string | null>(null);

  // What the form holds on arrival is what is already saved.
  useEffect(() => {
    if (formRef.current) sent.current = snapshot(formRef.current);
  }, []);

  function flush() {
    const form = formRef.current;
    // Silent: a half-typed required field is not an edit to scold, it is one
    // that has not been finished, and it saves when it is.
    if (!form || !form.checkValidity()) return;
    const now = snapshot(form);
    if (now === sent.current) return;
    sent.current = now;
    form.requestSubmit();
  }

  // The result of the last send, read after it lands. A failed one is unsent.
  useEffect(() => {
    if (result && !result.ok) sent.current = null;
  }, [result]);

  const formProps = {
    ref: formRef,
    action: dispatch,
    onChange(event: React.FormEvent<HTMLFormElement>) {
      const target = event.target as HTMLInputElement;
      if (
        target.type === "checkbox" ||
        target.type === "radio" ||
        target.tagName === "SELECT"
      ) {
        flush();
      }
    },
    // Enter in a lone field submits the form by itself; note it, or leaving
    // the field next would send the same thing twice.
    onSubmit(event: React.FormEvent<HTMLFormElement>) {
      sent.current = snapshot(event.currentTarget);
    },
    onBlur(event: React.FocusEvent<HTMLFormElement>) {
      const next = event.relatedTarget as Node | null;
      if (next && event.currentTarget.contains(next)) return;
      flush();
    },
  };

  const state: SaveState =
    save.kind === "failed"
      ? {
          ...save,
          retry: () => {
            sent.current = null;
            flush();
          },
        }
      : save.kind === "saving"
        ? { kind: "saving", shown: true }
        : save;

  return { formProps, flush, save: state };
}
