"use client";

import { useMemo, useRef, useState } from "react";

import { CalendarIcon, ChevronDownIcon } from "@/components/icons";
import { Popover } from "@/components/ui/popover";
import { inputClasses } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  DAY,
  addMonths,
  isoOf,
  monthGrid,
  msOf,
  startOfMonth,
} from "@/lib/calendar";
import { formatDate, MONTHS } from "@/lib/format";
import { programToday } from "@/lib/when";

/**
 * A date, picked from our own calendar.
 *
 * `<input type="date">` cannot be styled. Not "is awkward to style" — the
 * calendar it opens is browser chrome, drawn outside the page, and no
 * stylesheet reaches it. So every date in this product was chosen from a panel
 * in somebody else's blue, in somebody else's typeface, with a "Clear" and a
 * "Today" we did not write, laid out US-first on a week that starts on Monday
 * here. It was the one surface in the app that did not belong to it.
 *
 * What it keeps from the native control, because these are the parts worth
 * having: a `name` that posts `YYYY-MM-DD` exactly as before, so no action or
 * validator changes, and `min` and `max` as real bounds — a day outside them
 * cannot be clicked, cannot be reached with an arrow key, and the month arrows
 * stop at the month the bound falls in.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not accept typing. A text field
 * that parses dates has to answer "03/04" — and the answer is different in two
 * of the countries this is used in. Every date here is picked from a month
 * that names itself.
 *
 * The month arithmetic lives in `lib/calendar.ts`, where it is tested: it is
 * UTC throughout, in the `YYYY-MM-DD` strings the rest of the app speaks.
 */

/** Monday first — `weekday()` in lib/calendar.ts is what makes it so. */
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function DateField({
  name,
  defaultValue,
  min,
  max,
  required = false,
  onChange,
  invalid = false,
  id,
  className,
  label = "Date",
}: {
  name: string;
  /** `YYYY-MM-DD`. */
  defaultValue?: string;
  min?: string;
  max?: string;
  /**
   * No "Clear", because empty is not an answer. The caller supplies a default
   * and the server does the refusing — see the hidden input below.
   */
  required?: boolean;
  /** Told the new `YYYY-MM-DD` — a form that keeps a draft needs to hear it. */
  onChange?: (value: string) => void;
  /** Drawn like the other fields' error state; the caller owns the message. */
  invalid?: boolean;
  id?: string;
  className?: string;
  /** What the trigger announces as, when "Date" is not specific enough. */
  label?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");

  const lo = msOf(min);
  const hi = msOf(max);
  const chosen = msOf(value);

  // The PROGRAM's today, not the browser's. A mentor in Tashkent opening this
  // at 01:00 is on a day the browser's UTC clock has not reached, and "Today"
  // has to mean the same day here as it does on the form's `max` and on every
  // other date this app prints.
  const today = msOf(programToday());

  return (
    <>
      {/*
        The value the form posts, and the only thing the server sees.

        Deliberately NOT carrying `required`. A hidden input is barred from
        constraint validation, and the usual workaround — a visually-hidden
        text input — is worse than it looks: Chrome refuses to submit a form
        whose invalid control it cannot focus and reports nothing, so the
        button goes dead with no message anywhere. That is the worst failure a
        form has, and it would be traded for a case that cannot arise: a
        required field opens on a default and is never offered a "Clear".

        What actually guards this is the server, which refuses a missing date
        and names the field, the same as it does for every other value here.
      */}
      <input type="hidden" id={id} name={name} value={value} />

      <Popover
        label={label}
        contents="fields"
        origin="start"
        width="lg"
        triggerClassName={cn(
          inputClasses,
          "flex items-center justify-between gap-2 text-left",
          !value && "text-muted-fg",
          invalid && "border-danger-line bg-danger-soft/40",
          className
        )}
        trigger={
          <>
            <span>{chosen === null ? "Pick a date" : human(chosen)}</span>
            <CalendarIcon className="h-4 w-4 shrink-0 text-muted-fg" />
          </>
        }
      >
        {({ close }) => (
          <Calendar
            chosen={chosen}
            today={today}
            lo={lo}
            hi={hi}
            required={required}
            onPick={(ms) => {
              const next = ms === null ? "" : isoOf(ms);
              setValue(next);
              onChange?.(next);
              close();
            }}
          />
        )}
      </Popover>
    </>
  );
}

/**
 * "September 17", the year only when it is not this one — `formatDate`, so
 * the field reads the date the way every row it lands in will. It said
 * "17 September 2026" here and "September 17" everywhere else.
 */
function human(ms: number): string {
  return formatDate(new Date(ms));
}

function Calendar({
  chosen,
  today,
  lo,
  hi,
  required,
  onPick,
}: {
  chosen: number | null;
  today: number | null;
  lo: number | null;
  hi: number | null;
  required: boolean;
  onPick: (ms: number | null) => void;
}) {
  // The month on screen. Opens on the chosen date, else on today, else on
  // whichever end of the allowed range is nearest — a picker bounded to last
  // month should not open on a month where every cell is dead.
  const [month, setMonth] = useState(() =>
    startOfMonth(chosen ?? today ?? hi ?? lo ?? Date.now())
  );
  const gridRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => monthGrid(month), [month]);
  const shown = new Date(month).getUTCMonth();

  const outOfRange = (ms: number) =>
    (lo !== null && ms < lo) || (hi !== null && ms > hi);

  // The one cell in the tab order. Everything else is reached with an arrow,
  // which is what stops a calendar being 42 stops between the field above it
  // and the button below.
  const roving =
    days.find((ms) => ms === chosen && !outOfRange(ms)) ??
    days.find((ms) => ms === today && !outOfRange(ms)) ??
    days.find((ms) => new Date(ms).getUTCMonth() === shown && !outOfRange(ms)) ??
    days[0];

  /** Move focus by `step` days, paging the month when it leaves the grid. */
  const move = (from: number, step: number) => {
    const to = from + step * DAY;
    if (lo !== null && to < lo) return;
    if (hi !== null && to > hi) return;
    if (to < days[0] || to > days[41]) setMonth(startOfMonth(to));
    // After a month change the button does not exist yet, so the focus waits
    // for the render that creates it.
    requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLButtonElement>(`[data-day="${isoOf(to)}"]`)
        ?.focus();
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const from = msOf(
      (e.target as HTMLElement).getAttribute?.("data-day") ?? undefined
    );
    if (from === null) return;
    const step =
      e.key === "ArrowLeft"
        ? -1
        : e.key === "ArrowRight"
          ? 1
          : e.key === "ArrowUp"
            ? -7
            : e.key === "ArrowDown"
              ? 7
              : e.key === "PageUp"
                ? -28
                : e.key === "PageDown"
                  ? 28
                  : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    move(from, step);
  };

  const step = (n: number) => setMonth((m) => addMonths(m, n));
  // A month with nothing pickable in it is a month there is no point paging
  // to, so the arrow stops at the month the bound falls in rather than at the
  // bound itself.
  const canBack = lo === null || month > startOfMonth(lo);
  const canNext = hi === null || month < startOfMonth(hi);

  return (
    <div className="text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-ink">
          {MONTHS[shown]} {new Date(month).getUTCFullYear()}
        </span>
        <span className="flex items-center gap-1">
          <Step label="Previous month" onClick={() => step(-1)} disabled={!canBack}>
            <ChevronDownIcon className="h-4 w-4 rotate-90" />
          </Step>
          <Step label="Next month" onClick={() => step(1)} disabled={!canNext}>
            <ChevronDownIcon className="h-4 w-4 -rotate-90" />
          </Step>
        </span>
      </div>

      <div className="grid grid-cols-7 text-center text-[0.75rem] font-medium text-muted-fg">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
      </div>

      {/* `role="grid"` is load-bearing: `Popover` hands arrow keys to whatever
          owns them, and this owns them — up and down are a week here, not the
          next item in a list. */}
      <div
        ref={gridRef}
        role="grid"
        aria-label="Choose a day"
        onKeyDown={onKeyDown}
        className="grid grid-cols-7 gap-0.5"
      >
        {days.map((ms) => {
          const inMonth = new Date(ms).getUTCMonth() === shown;
          const dead = outOfRange(ms);
          const on = ms === chosen;
          return (
            <button
              key={ms}
              type="button"
              data-day={isoOf(ms)}
              disabled={dead}
              tabIndex={ms === roving ? 0 : -1}
              aria-current={ms === today ? "date" : undefined}
              aria-pressed={on}
              onClick={() => onPick(ms)}
              className={cn(
                "flex h-9 items-center justify-center rounded-lg text-[0.8125rem] tabular-nums transition-colors",
                dead
                  ? "cursor-not-allowed text-muted-fg/35"
                  : on
                    ? "bg-brand font-semibold text-white"
                    : cn(
                        "hover:bg-brand-soft hover:text-brand",
                        inMonth ? "text-ink" : "text-muted-fg/60"
                      ),
                // Today is a ring rather than a fill, so it never competes with
                // the day that is actually chosen.
                !on && ms === today && "ring-1 ring-brand/50"
              )}
            >
              {new Date(ms).getUTCDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
        <button
          type="button"
          onClick={() => today !== null && !outOfRange(today) && onPick(today)}
          disabled={today === null || outOfRange(today)}
          className="rounded-lg px-2 py-1 text-xs font-medium text-brand hover:bg-brand-soft disabled:text-muted-fg/50 disabled:hover:bg-transparent"
        >
          Today
        </button>
        {/* Only when empty is an answer. A required date has no "Clear", and
            offering one is offering a state the form will refuse. */}
        {!required && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="rounded-lg px-2 py-1 text-xs font-medium text-muted-fg hover:bg-canvas hover:text-ink"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function Step({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-fg transition-colors hover:bg-canvas hover:text-ink disabled:cursor-not-allowed disabled:text-muted-fg/30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
