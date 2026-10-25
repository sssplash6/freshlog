"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";
import { inputClasses } from "@/components/ui/field";

type Parts = { hours: string; minutes: string };

/** "90" → 1 h 30 min. An empty or unreadable total is two empty boxes. */
export function splitMinutes(total: string | number | undefined): Parts {
  const n = Number(total);
  if (total === undefined || total === "" || !Number.isInteger(n) || n < 0) {
    return { hours: "", minutes: "" };
  }
  const hours = Math.floor(n / 60);
  return { hours: hours > 0 ? String(hours) : "", minutes: String(n % 60) };
}

/** Both boxes as one whole number of minutes; "" while neither holds anything. */
export function joinMinutes({ hours, minutes }: Parts): string {
  if (!hours && !minutes) return "";
  return String(Number(hours || 0) * 60 + Number(minutes || 0));
}

/**
 * How long something took, as hours and minutes.
 *
 * Two boxes, posted as ONE field: a hidden input under `name` carries the
 * total in minutes, so every action that reads `minutes` reads it unchanged.
 * Either box may be left empty — "90" in Minutes alone still means 90 — so a
 * mentor who thinks in minutes types what they always typed.
 *
 * Pass `value` to own the total from outside (a preset writes it, and the
 * boxes re-split it); leave it out and `defaultValue` seeds them once.
 *
 * Each box is `inputClasses`, `min-h-11` included, so the pair stands as tall
 * as a `Select` beside it.
 *
 * The boxes have no `name` of their own, so a form's data holds the total and
 * nothing else. `data-autosave-field` is what an autosaving form reads to know
 * which field the edit was to.
 */
export function DurationField({
  name = "minutes",
  id,
  value,
  defaultValue,
  onChange,
  invalid,
  className,
}: {
  name?: string;
  /** Goes on the Hours box, for a `<label htmlFor>` above the pair. */
  id?: string;
  value?: string;
  defaultValue?: string | number;
  onChange?: (total: string) => void;
  invalid?: boolean;
  className?: string;
}) {
  const [parts, setParts] = useState(() => splitMinutes(value ?? defaultValue));
  // A total set from outside that the boxes do not already add up to: show it.
  if (value !== undefined && value !== joinMinutes(parts)) {
    setParts(splitMinutes(value));
  }
  const total = joinMinutes(parts);

  function set(part: keyof Parts, raw: string) {
    const next = { ...parts, [part]: raw.replace(/\D/g, "") };
    setParts(next);
    onChange?.(joinMinutes(next));
  }

  const box = (part: keyof Parts, unit: string, label: string, boxId?: string) => (
    <div className="relative min-w-0">
      {/* Text with a numeric keypad, not `type="number"`: the number input
          drew spinner arrows on focus and took a scroll-wheel nudge as an
          edit. The unit sits in the box, so "90" can only mean what it says. */}
      <input
        id={boxId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={label}
        data-autosave-field={name}
        value={parts[part]}
        onChange={(event) => set(part, event.target.value)}
        // A pasted "1.5" used to lose its point and become 15 — ten times
        // what was meant. Anything that is not a whole number is refused at
        // the paste instead of being quietly reshaped into a different one.
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text").trim();
          if (!/^\d+$/.test(pasted)) event.preventDefault();
        }}
        aria-invalid={invalid || undefined}
        className={cn(
          inputClasses,
          "pr-12 tabular-nums",
          invalid && "border-danger-line bg-danger-soft/40"
        )}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-muted-fg"
      >
        {unit}
      </span>
    </div>
  );

  return (
    <div className={cn("grid grid-cols-2 gap-2", className)}>
      {box("hours", "h", "Hours", id)}
      {box("minutes", "min", "Minutes")}
      <input type="hidden" name={name} value={total} />
    </div>
  );
}
