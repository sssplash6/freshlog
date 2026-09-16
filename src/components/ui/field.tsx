"use client";

import { useState, type ComponentProps } from "react";

import { cn } from "@/lib/cn";
import { FULL_NAME_RE, NAME_MAX } from "@/lib/actions/shared";

/** The one text-field look, shared by Input, Textarea and the native Select. */
export const inputClasses =
  "min-h-11 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[0.9375rem] text-ink transition-colors placeholder:text-muted-fg hover:border-brand/40 focus:border-brand focus:outline-none";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputClasses, className)} {...props} />;
}

/**
 * The one name input, everywhere a person's name is typed: your own, a
 * mentor's, a student's.
 *
 * It carries the browser half of `parseNameField` — the same two-word rule, the
 * same 80-character cap — so the box refuses in place instead of the server
 * refusing after a round trip. `pattern` is fed the shared regex's own source
 * rather than a second copy of it, which is what stops the two drifting; the
 * server still checks, because a pattern is a courtesy and not a gate.
 *
 * `title` is what Chrome and Safari print under the field when the pattern
 * fails, so it has to be the sentence, not a label.
 */
export function NameInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <Input
      type="text"
      autoComplete="name"
      maxLength={NAME_MAX}
      // The anchors are implicit in `pattern`; keeping them in the source would
      // make it `^^…$$` and match nothing.
      pattern={FULL_NAME_RE.source.replace(/^\^|\$$/g, "")}
      title="First and last name, please — not just one word."
      className={className}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(inputClasses, "resize-y leading-relaxed", className)}
      {...props}
    />
  );
}

/**
 * A field that grows downward as it is typed into.
 *
 * The owner's words: when he types, the text should go down — not sit in a box
 * of fixed width while the start of the sentence slides out of view. A
 * one-line `<input>` cannot do that: it scrolls horizontally by definition, so
 * anyone writing more than about forty characters loses the beginning of their
 * own sentence while they are still writing it. Every meeting note, session
 * note and task purpose in this app was one.
 *
 * It grows by LAYOUT, not by measurement. The textarea and an invisible copy of
 * its own text are stacked in the same grid cell, so the copy — which wraps
 * like any other text — sets the height and the textarea fills it. No refs, no
 * `scrollHeight` read, nothing that runs during a render pass or has to be
 * re-run when the width changes; a resize just re-wraps the copy and the box
 * follows. `field-sizing: content` will do this natively one day and is set as
 * a progressive enhancement, but it does not exist in Safari yet.
 *
 * The trailing space in the mirror matters: a value ending in a newline has to
 * still reserve the line the caret is sitting on.
 */
export function GrowingField({
  className,
  defaultValue,
  value: controlled,
  onChange,
  ...props
}: ComponentProps<"textarea">) {
  // Uncontrolled by default, which is every caller but one. Pass `value` and
  // the parent owns it instead — dictation needs to push text INTO this box,
  // and a field that only ever reads its own keystrokes cannot be written to.
  const [own, setOwn] = useState(String(defaultValue ?? ""));
  const value = controlled !== undefined ? String(controlled) : own;

  return (
    <div className="grid w-full">
      <textarea
        {...props}
        rows={1}
        value={value}
        onChange={(event) => {
          if (controlled === undefined) setOwn(event.target.value);
          onChange?.(event);
        }}
        className={cn(
          inputClasses,
          "col-start-1 row-start-1 resize-none overflow-hidden leading-relaxed [field-sizing:content]",
          className
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          inputClasses,
          "invisible col-start-1 row-start-1 whitespace-pre-wrap break-words leading-relaxed",
          className
        )}
      >
        {value + " "}
      </span>
    </div>
  );
}

/**
 * Label-above field wrapper (DESIGN.md: label above input, inline result
 * below). Wraps its control in a <label> so the association is automatic;
 * hint and error render underneath.
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="block text-sm font-medium text-ink">
        {label}
        {required && <span className="text-accent-ink"> *</span>}
      </span>
      {children}
      {hint && !error && (
        <span className="block text-xs text-muted-fg">{hint}</span>
      )}
      {error && (
        <span role="alert" className="block text-xs text-danger-ink">
          {error}
        </span>
      )}
    </label>
  );
}
