"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const TOAST_MS = 4000;
/** Long enough to read the message AND reach the button. */
const TOAST_WITH_ACTION_MS = 6000;
const FAILED = "Couldn’t save. Try again.";
const EVENT = "app-toast";

type ToastInput = {
  message: string;
  /** `error` is announced assertively and never auto-hides under a pointer. */
  tone?: "info" | "error";
  /**
   * One follow-up the toast offers — almost always Undo. Present only for an
   * action whose inverse exists and is safe to run from here: voiding a
   * session (restored by `restoreSession`), hiding an attention row (restored
   * by `restoreStatus`). A destructive action with no inverse gets a
   * `ConfirmInline` BEFORE it runs instead of a toast after.
   */
  action?: { label: string; run: () => unknown | Promise<unknown> };
};

type Toast = ToastInput & { id: number };

/**
 * Say something briefly, from anywhere on the client.
 *
 * A window event rather than a context: the callers are leaf forms scattered
 * through server-rendered pages, and threading a provider through every one of
 * them would buy nothing a single listener does not.
 */
export function toast(input: ToastInput) {
  window.dispatchEvent(new CustomEvent<ToastInput>(EVENT, { detail: input }));
}

/**
 * The one place a transient message appears: a dark translucent capsule at the
 * bottom centre, the way iOS shows one.
 *
 * Two jobs. It is the safety net for failed mutations — a rejected server
 * action that isn't caught inline surfaces as an unhandled rejection, and this
 * turns it into "that didn't save" — and it is where a reversible action says
 * it happened and offers to take it back.
 *
 * Two live regions, mounted from the first render and never unmounted, for the
 * reason `SaveState` gives: a region that appears WITH its message is announced
 * inconsistently, a region that was already there when the text arrived is
 * announced every time.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [paused, setPaused] = useState(false);
  const nextId = useRef(0);

  const push = useCallback((input: ToastInput) => {
    const id = ++nextId.current;
    setToasts((prev) => {
      if (prev.some((t) => t.message === input.message && !t.action)) return prev;
      return [...prev.slice(-2), { ...input, id }];
    });
  }, []);

  useEffect(() => {
    function onUnhandled() {
      push({ message: FAILED, tone: "error" });
    }
    function onToast(e: Event) {
      push((e as CustomEvent<ToastInput>).detail);
    }
    window.addEventListener("unhandledrejection", onUnhandled);
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandled);
      window.removeEventListener(EVENT, onToast);
    };
  }, [push]);

  // The oldest leaves on a timer — held while a pointer or focus is on the
  // stack, so an Undo cannot vanish from under the finger reaching for it.
  useEffect(() => {
    if (toasts.length === 0 || paused) return;
    const first = toasts[0];
    const timer = setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== first.id)),
      first.action ? TOAST_WITH_ACTION_MS : TOAST_MS,
    );
    return () => clearTimeout(timer);
  }, [toasts, paused]);

  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  const polite = toasts.filter((t) => t.tone !== "error");
  const urgent = toasts.filter((t) => t.tone === "error");

  return (
    <div
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      // Clear of the bottom tab bar (~56px + the home-indicator inset) on a
      // phone; 24px off the bottom edge where the bar is gone.
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6"
    >
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
        {polite.map((t) => (
          <ToastCapsule key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
      <div role="alert" aria-live="assertive" className="flex flex-col items-center gap-2">
        {urgent.map((t) => (
          <ToastCapsule key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </div>
  );
}

function ToastCapsule({
  toast: t,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div
      className={
        // `bg-ink` inverts with the theme on its own — near-black capsule in
        // light, near-white in dark — which is exactly how a system banner
        // reads against either ground. Translucent and blurred like the bars.
        "toast-in pointer-events-auto flex min-h-11 max-w-md items-center gap-3 rounded-full bg-ink/90 py-1.5 pl-5 pr-1.5 text-sm text-canvas shadow-lg backdrop-blur-xl backdrop-saturate-150"
      }
    >
      {t.tone === "error" && (
        <span aria-hidden="true" className="font-semibold text-danger-line">
          !
        </span>
      )}
      <span className="min-w-0">{t.message}</span>
      {t.action ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await t.action!.run();
              onDismiss();
            } catch {
              setBusy(false);
              toast({ message: FAILED, tone: "error" });
            }
          }}
          className="min-h-9 shrink-0 cursor-pointer rounded-full px-3 text-sm font-semibold text-brand-soft transition-colors hover:bg-canvas/10 disabled:opacity-60"
        >
          {busy ? "Undoing…" : t.action.label}
        </button>
      ) : (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-canvas/70 transition-colors hover:bg-canvas/10 hover:text-canvas"
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );
}
