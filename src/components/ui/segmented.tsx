"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/cn";

/**
 * One segmented control, for the six that were built by hand.
 *
 * `attendance-picker.tsx`, `time-kind-picker.tsx`, `program-tabs.tsx`, the
 * profile switch, the mentor-hours filter pills and the task progress buttons
 * were six implementations of the same thing, and they disagreed about the
 * details that matter: three heights, two focus treatments, and only two of
 * the six explained the consequence of the option you had picked.
 *
 * Two shapes, because there are genuinely two jobs:
 *
 *   SegmentedRadio  a form field — one of N, submitted with the form
 *   TabLinks        navigation — one of N, each its own URL
 *
 * They look alike on purpose. They are the same gesture; only the consequence
 * differs, and conflating a filter with a form field is how a "filter" ends up
 * inside a `<form>` that submits it as data.
 */

/** The shared shell, so the two shapes cannot drift apart again. */
const TRACK =
  "flex w-full flex-wrap gap-1 rounded-xl border border-line bg-canvas p-1 sm:w-fit";
/** 44px: students and mentors use this on a phone. */
const SEGMENT =
  "inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-3.5 text-sm transition-colors sm:flex-none";
/**
 * Narrower, for the correction popover, where four options and a form have to
 * fit a 320px panel.
 *
 * Narrower and NOT shorter. The version this replaces dropped to 36px in the
 * popover, and the popover is where a mentor fixes a session they got wrong —
 * the one place a mis-tap costs the most. Padding and type give back the width;
 * the target stays 44px.
 */
const SEGMENT_DENSE =
  "inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] transition-colors";
const ON = "bg-surface font-semibold text-ink shadow-sm";
const OFF = "font-medium text-muted-fg hover:text-ink";

export type SegmentedOption = {
  value: string;
  label: string;
  /**
   * What choosing this one means, in eight words or fewer — "No-show still
   * charges time."
   *
   * Shown under the control for the CHOSEN option only. The alternative is
   * expecting a mentor to remember which of four attendance states spends a
   * student's hours, which is exactly the thing nobody remembers.
   */
  hint?: string;
};

export function SegmentedRadio({
  name,
  legend,
  options,
  defaultValue,
  required = false,
  dense = false,
  onChange,
  className,
}: {
  name: string;
  legend: React.ReactNode;
  options: SegmentedOption[];
  defaultValue?: string;
  required?: boolean;
  /** Tighter horizontally, for a popover. Never shorter — see SEGMENT_DENSE. */
  dense?: boolean;
  onChange?: (value: string) => void;
  className?: string;
}) {
  const initial =
    defaultValue && options.some((o) => o.value === defaultValue)
      ? defaultValue
      : options[0]?.value;
  const [value, setValue] = useState(initial);
  const chosen = options.find((o) => o.value === value);

  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend
        className={cn(
          "text-muted-fg",
          dense ? "text-xs font-medium" : "text-sm"
        )}
      >
        {legend}
        {required && <span className="text-accent-ink"> *</span>}
      </legend>
      {/* The radios are real radios, visually hidden inside their labels. A
          set of buttons would need its own keyboard handling and would submit
          nothing; radios arrive with arrow-key navigation and form semantics
          already correct. */}
      <div className={cn(TRACK, "mt-1")}>
        {options.map((option) => {
          const active = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                dense ? SEGMENT_DENSE : SEGMENT,
                "focus-within:ring-2 focus-within:ring-brand/40",
                active ? ON : OFF
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={active}
                onChange={() => {
                  setValue(option.value);
                  onChange?.(option.value);
                }}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
      {chosen?.hint && (
        <p className="mt-1.5 text-xs text-muted-fg">{chosen.hint}</p>
      )}
    </fieldset>
  );
}

export type TabItem = { href: string; label: string; count?: number };

/**
 * Navigation between views of one thing.
 *
 * Longest matching href wins, the same rule the app nav uses, so a deeper page
 * under a tab keeps that tab lit instead of falling back to the first one.
 *
 * Query parameters count, and they have to: a filter like `/mentor?program=X`
 * shares its pathname with every sibling and with the "All" tab, so matching on
 * the path alone made all of them match and handed the highlight to whichever
 * program happened to have the longest id. An item matches when its path
 * matches AND every parameter it names holds that value — so "All", which
 * names none, matches everywhere and loses the longest-href tie-break to a
 * specific one whenever a specific one is set.
 */
export function TabLinks({
  items,
  label,
  className,
}: {
  items: TabItem[];
  /** Names the group for a screen reader: "Program sections". */
  label: string;
  className?: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = items.reduce<TabItem | null>((best, item) => {
    const [path, query = ""] = item.href.split("?");
    if (pathname !== path && !pathname.startsWith(`${path}/`)) return best;
    for (const [key, value] of new URLSearchParams(query)) {
      if (params.get(key) !== value) return best;
    }
    if (!best || item.href.length > best.href.length) return item;
    return best;
  }, null);

  return (
    <nav aria-label={label} className={cn(TRACK, className)}>
      {items.map((item) => {
        const active = item === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            // A tab is a different slice of the page you are already reading,
            // not a different page. Next scrolls to the top on every
            // navigation, so switching program threw a mentor back to the
            // masthead and made them find the table again — the table they
            // were looking at when they asked the question.
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(SEGMENT, active ? ON : OFF)}
          >
            {item.label}
            {item.count != null && (
              <span
                className={cn(
                  "text-xs tabular-nums",
                  active ? "text-muted-fg" : "text-muted-fg/70"
                )}
              >
                {item.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
