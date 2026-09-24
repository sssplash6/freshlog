"use client";

import { useActionState, useEffect, useState } from "react";

import { CheckIcon } from "@/components/icons";
import type { ActionState } from "@/lib/actions/shared";
import { cn } from "@/lib/cn";

/**
 * Everything a form is allowed to say about itself, as one closed set.
 *
 * This replaces `forms/action-feedback.tsx`, which knew only two of these six:
 * it printed a success message or an error and had no word for "in flight" or
 * "you have typed something and not saved it". Forty call sites shared it, and
 * every one of them that wanted to say more said it by hand — the mentor list
 * disabled its own Cancel button off a separate `pending`, the schedule form
 * kept its own copy of the last result so a collapsed panel could still show
 * it. One set of states, derived once, is what stops that recurring.
 *
 * `at` is optional because a surface that keeps its own result rather than a
 * `useActionState` one (the avatar picker, which is a file input and not a
 * form) has no dispatch to stamp. The tick still lands; only the clock is
 * missing.
 */
export type SaveState =
  | { kind: "idle" }
  /** An inline editor is open on a value that has not been touched yet. */
  | { kind: "editing" }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "saved"; at?: Date; message?: string }
  | { kind: "failed"; error: string; retry?: () => void };

/** The shape every server action in this app has, so the hook can name it. */
type FormAction = (
  state: ActionState,
  formData: FormData
) => Promise<ActionState>;

/**
 * An action result plus what is happening to it, as one state.
 *
 * Precedence, in order: in flight beats everything, then a failure, then
 * unsaved edits, then a success. A failure outranks unsaved edits on purpose —
 * the error is why the reader is editing again, so it stays until they
 * resubmit.
 */
export function saveStateFrom(
  result: ActionState,
  pending: boolean,
  { at, unsaved = false }: { at?: Date | null; unsaved?: boolean } = {}
): SaveState {
  if (pending) return { kind: "saving" };
  if (result && !result.ok) return { kind: "failed", error: result.error };
  if (unsaved) return { kind: "unsaved" };
  if (result?.ok) {
    return { kind: "saved", at: at ?? undefined, message: result.message };
  }
  return { kind: "idle" };
}

/**
 * `useActionState` with the save state derived alongside it.
 *
 * `unsaved` is the caller's own comparison of what is on screen against what
 * was last saved. It resolves itself without any bookkeeping here: every one of
 * these actions revalidates, so the saved value arrives back as a new prop and
 * the comparison goes false on its own.
 */
export function useSaveState(
  action: FormAction,
  unsaved = false
): [ActionState, (formData: FormData) => void, SaveState] {
  const [result, dispatch, pending] = useActionState(action, null);

  // Stamped when the result changes, not in an effect: an effect that sets
  // state runs a second render pass for a value the first pass could already
  // have had, which is the cascade `react-hooks/set-state-in-effect` warns
  // about. Guarded by the identity check, so it runs once per result.
  const [seen, setSeen] = useState<{ result: ActionState; at: Date | null }>({
    result: null,
    at: null,
  });
  if (seen.result !== result) {
    setSeen({ result, at: result?.ok ? new Date() : null });
  }

  // The save's felt acknowledgement: the check draws itself in render, and on
  // Android the device ticks under the thumb. iOS ignores vibrate entirely.
  useEffect(() => {
    if (result?.ok) navigator.vibrate?.(6);
  }, [result]);

  useUnsavedChanges(unsaved);

  return [
    result,
    dispatch,
    saveStateFrom(result, pending, { at: seen.at, unsaved }),
  ];
}

/**
 * Warn before the tab closes on an edit that was never saved.
 *
 * Reloads, closes and links off the app only. There is no global hook for
 * in-app navigation in this router — `<Link>` exposes `onNavigate` per link,
 * and the alternative (a document-wide click interceptor) would also swallow
 * clicks on links this hook has never heard of. That is a smaller gap than it
 * looks, because §5.8's rule is that every row saves independently: the window
 * in which anything is unsaved is one field wide.
 */
export function useUnsavedChanges(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;
    // `preventDefault()` alone is the current spec. The old `returnValue`
    // string is deprecated and no browser has shown custom text for years.
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
}

/** The reader's own wall clock — the server's would be a different city. */
function clock(at: Date): string {
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * The one save indicator, inline under the control it belongs to.
 *
 * Success is a tick in ink rather than green text: green was the only place in
 * the app where "it worked" wore a colour, and a palette with two status hues
 * should not spend one on the expected outcome.
 *
 * `saving` and `editing` render nothing, and that is deliberate. Every save in
 * this app is started by a `SubmitButton`, which already swaps to its pending
 * text and spins while the action is in flight; a second "Saving…" underneath
 * is the same fact twice, and it makes the form jump for the ~200ms it is
 * true. What `saving` does do is clear the previous tick or error, so a stale
 * "✓ Saved 12:04" can never sit under a save that is still going.
 *
 * Both live regions are mounted from the start, empty. A region that appears
 * at the same moment as its text is not reliably announced — several screen
 * readers only watch regions that were already there — which is why the old
 * component's `role="status"` was announced inconsistently. The `rise-in` moves
 * to the inner span, which is the thing that actually mounts.
 */
export function SaveState({
  state,
  className,
}: {
  state: SaveState;
  className?: string;
}) {
  const saved = state.kind === "saved" ? state : null;
  const failed = state.kind === "failed" ? state : null;
  const shown = Boolean(saved || failed) || state.kind === "unsaved";

  return (
    <div className={cn(shown && "mt-2", className)}>
      <p role="status">
        {saved && (
          <span className="rise-in flex flex-wrap items-baseline gap-x-1.5 text-sm text-ink">
            <CheckIcon className="check-draw h-3.5 w-3.5 shrink-0 translate-y-0.5" />
            {saved.message ?? "Saved"}
            {saved.at && (
              <span className="tabular-nums text-muted-fg">
                {clock(saved.at)}
              </span>
            )}
          </span>
        )}
        {state.kind === "unsaved" && (
          <span className="rise-in text-sm text-muted-fg">
            Unsaved changes
          </span>
        )}
      </p>
      <p role="alert">
        {failed && (
          <span className="rise-in flex flex-wrap items-baseline gap-x-3 text-sm text-danger-ink">
            {failed.error}
            {failed.retry && (
              <button
                type="button"
                onClick={failed.retry}
                // 44px on a control that only ever appears next to bad news,
                // which is the worst moment to hand someone a small target.
                className="inline-flex min-h-11 items-center font-semibold underline"
              >
                Try again
              </button>
            )}
          </span>
        )}
      </p>
    </div>
  );
}
