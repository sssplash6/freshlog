"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Button, buttonClasses, type ButtonSize } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";

/**
 * A destructive action and the question it has to answer first.
 *
 * Eight of these were written by hand, and they are eight because the shape
 * kept being re-derived rather than reached for: `DangerButton` in
 * `program-settings-forms.tsx` (itself used three times), the void and the
 * delete on a session row, the removals on an allocation row, an assignment
 * row and a student's Corrections panel, the cancel on a meeting row, and
 * `remove-assignment-button.tsx`, a whole file for one of them.
 *
 * They agreed on the idea and on nothing else. Three visual shapes for the
 * first step — an outlined red button, a red text link, a `Button
 * variant="danger"`. Two for the second, since `remove-assignment-button` kept
 * its confirm outlined while every other one filled it. One asked no question
 * at all: `assignment-row-actions` went straight from "Remove" to "Yes,
 * remove", which is a two-step confirm with the step that carries the
 * information left out. Two disabled Cancel while the action was in flight and
 * six did not. And none of the eight moved focus, so a keyboard user pressed
 * Enter on "Remove", watched the button under their finger become a different
 * button, and had to go and find it again.
 *
 * The second step is filled red. It looks like the primary action because by
 * then it is the primary action — the reader has been asked, and this is the
 * answer they came for. `Button`'s `dangerSolid` exists for exactly this half.
 *
 * The confirm button takes focus when it appears and is described by the
 * question, so a screen reader announces the consequence together with the
 * button that causes it. Escape steps back rather than committing, and it
 * claims the key: inside a `RowActionMenu`, backing out of a confirm must not
 * also close the menu the confirm was in.
 *
 * This owns its own `<form>`, which is what lets `SubmitButton` read the
 * pending state — so it can never be rendered inside another form. Inside a
 * `RowActionMenu` that is already true, because the panel is portaled out of
 * the page's DOM.
 */
export function ConfirmInline({
  label,
  question,
  confirmLabel,
  action,
  values,
  disabledReason,
  cancelLabel = "Cancel",
  pendingLabel,
  pending = false,
  variant = "button",
  tone = "danger",
  size,
  className,
}: {
  /** The first step: what the action is, in the imperative. "Remove mentor". */
  label: React.ReactNode;
  /** What happens if they go on — the consequence, not "Are you sure?". */
  question: React.ReactNode;
  /** The second step. Names the act, so "Yes, delete it", never "OK". */
  confirmLabel: React.ReactNode;
  /** The server action, or the dispatch from `useActionState`. */
  action: ComponentProps<"form">["action"];
  /** Hidden fields naming what this acts on: `{ sessionId }`. */
  values?: Record<string, string>;
  /**
   * Why it can't be done. The action stays visible but disabled, so the reader
   * learns it exists and why this row is the exception: "Can't be removed:
   * they have logged sessions."
   */
  disabledReason?: React.ReactNode;
  /** "Keep it" reads better than "Cancel" against "Yes, cancel it". */
  cancelLabel?: string;
  /** While the action runs. Match the verb: "Voiding…", not "Removing…". */
  pendingLabel?: string;
  /** `useActionState`'s third value, so Cancel can't be clicked mid-flight. */
  pending?: boolean;
  /**
   * THE DESTRUCTIVE STYLE, in two sizes of the same idea — and nothing else
   * deletes anything in this app.
   *
   *   button  (default) a page-level destructive action: "Delete Global
   *           Admissions Program", "Remove student". Grey fill, red words, 44px
   *           — `Button variant="danger"` — beside the grey-fill/blue-words of
   *           a non-destructive peer such as Archive.
   *   quiet   a red word in a list row or a menu panel, where a column of
   *           filled buttons down a roster would be the loudest thing on it.
   *
   * Either way the second step is the same filled red confirm.
   */
  variant?: "button" | "quiet";
  /**
   * `danger` is the default because most confirms are destructive; `primary`
   * is for a claim that merely can't be undone — marking an interview done —
   * where a red button would say "this is a problem" about finishing a thing.
   */
  tone?: "danger" | "primary";
    /**
   * Defaults by variant, because the two live in different places. A standalone
   * `button` is a page control and gets 44px — it is the most consequential
   * button on the view, and at `sm` it was 32px, under the size a thumb can
   * reliably hit. A `quiet` one sits in a menu panel and matches its rows.
   */
  size?: ButtonSize;
  className?: string;
}) {
  const stepSize = size ?? (variant === "button" ? "md" : "sm");
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const labelRef = useRef<HTMLButtonElement>(null);
  // Focus only follows a step the reader took. Without this the effect below
  // would grab focus on mount, and a menu holding two confirms would fight
  // over it the moment it opened.
  const stepped = useRef(false);
  const reasonId = useId();

  useEffect(() => {
    if (!stepped.current) return;
    if (confirming) {
      // SubmitButton takes no ref, so the button is found rather than held.
      formRef.current
        ?.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.focus();
    } else {
      labelRef.current?.focus();
    }
  }, [confirming]);

  const step = (to: boolean) => {
    stepped.current = true;
    setConfirming(to);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Escape" || !confirming) return;
    // Claimed, so an enclosing Popover leaves its own Escape handling alone.
    e.preventDefault();
    step(false);
  };

  return (
    <form
      ref={formRef}
      action={action}
      onKeyDown={onKeyDown}
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {values &&
        Object.entries(values).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

      {confirming ? (
        <span className="rise-in flex flex-wrap items-center gap-2">
          {/* An alert, because it is new information the reader has to act
              on, and because `SubmitButton` takes no `aria-describedby` for it
              to be the button's description instead. */}
          <span role="alert" className="text-xs text-muted-fg">
            {question}
          </span>
          <SubmitButton
            variant={tone === "danger" ? "dangerSolid" : "primary"}
            size={stepSize}
            pendingText={pendingLabel}
          >
            {confirmLabel}
          </SubmitButton>
          <Button
            variant="ghost"
            size={stepSize}
            disabled={pending}
            onClick={() => step(false)}
          >
            {cancelLabel}
          </Button>
        </span>
      ) : (
        <>
          {/* A quiet first step is a red word, not a red box: in a 288px menu
              panel an outlined button beside the form's Save reads as one half
              of a pair of equals. It keeps a 40px box anyway — a 16px text
              link is not a target on a phone, which is where these menus are
              opened. Built from classes rather than `Button` + overrides,
              since two competing `text-*` utilities in one className are
              resolved by Tailwind's own ordering, not by the order written. */}
          <button
            ref={labelRef}
            type="button"
            disabled={Boolean(disabledReason)}
            aria-describedby={disabledReason ? reasonId : undefined}
            onClick={() => step(true)}
            className={
              variant === "quiet"
                ? cn(
                    "inline-flex min-h-10 items-center rounded-lg text-left text-[0.8125rem] font-medium transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50",
                    tone === "danger" ? "text-danger-ink" : "text-ink"
                  )
                : buttonClasses(tone === "danger" ? "danger" : "secondary", stepSize)
            }
          >
            {label}
          </button>
          {disabledReason && (
            <span id={reasonId} className="text-xs text-muted-fg">
              {disabledReason}
            </span>
          )}
        </>
      )}
    </form>
  );
}
