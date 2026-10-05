"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { RequiredMark } from "@/components/ui/required-mark";

/**
 * One segmented control, for the six that were built by hand.
 *
 * `attendance-picker.tsx`, `time-kind-picker.tsx`, `program-tabs.tsx`, the
 * profile switch, the mentor-hours filter pills and the task progress buttons
 * were six implementations of the same thing, and they disagreed about the
 * details that matter: three heights and two focus treatments.
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
  "flex w-full flex-wrap gap-0.5 rounded-xl bg-fill p-0.5 sm:w-fit";
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
  "inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-xs transition-colors";
/**
 * The tab track, and it is deliberately smaller than the form one.
 *
 * 44px is the rule for `SegmentedRadio`, and it stays: those are form fields,
 * and the popover comment below explains what a mis-tap costs there. A tab is
 * not that. Every use of `TabLinks` is a filter — Active/Archived, a program,
 * a period, a section of the page you are already reading — where a wrong tap
 * shows you the wrong list and you tap again. Nothing is written, nothing is
 * lost, so the target does not have to be paid for in height.
 *
 * It also hugs its content at every width instead of stretching to the full
 * row on a phone. Two words and a count are not a full-width control.
 */
/*
 * ONE ROW, ALWAYS. On a phone the track scrolls sideways rather than wrapping
 * (October 2026): three program names wrapped "Master's Program" onto a second
 * line under "All", and a two-row track reads as two controls. And on a phone
 * the tabs are a real 44px rather than 32px plus an invisible pseudo-element —
 * a scrolling track clips anything that pokes out of it, and DESIGN.md's 44px
 * rule is for exactly the phone.
 */
const TRACK_TAB =
  "flex w-fit max-w-full gap-0.5 rounded-lg bg-fill p-0.5 max-sm:scroll-x";
const SEGMENT_TAB =
  "inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs transition-colors sm:min-h-8";
// The thumb, raised off the grey track — iOS's segmented control. Its own
// token rather than `bg-surface`: in dark the surface IS the card, so a
// selected segment on a card was the card's colour on a lighter track and read
// as pressed IN rather than raised (October 2026). `thumb` is a step lighter
// than the track in both themes.
const ON = "bg-thumb font-semibold text-ink shadow-control";
const OFF = "font-medium text-muted-fg hover:text-ink";

/**
 * A value and the word for it. Nothing else.
 *
 * There was a `hint` here, rendered under the control for the chosen option —
 * "A no-show. The time is still charged, but tallied as missed." The reasoning
 * was that nobody remembers which of four attendance states spends a student's
 * hours. The owner cut every one of them: these controls are answered weekly
 * by people who know their own product, and an explanation that is on screen
 * every single time is furniture, not help. If a state needs explaining again
 * it belongs where the state is READ BACK — the chip on the logged row — not
 * under the button that sets it.
 */
export type SegmentedOption = {
  value: string;
  label: string;
};

export function SegmentedRadio({
  name,
  legend,
  options,
  defaultValue,
  required = false,
  dense = false,
  columns,
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
  /** Use a balanced two-by-two layout for four long choices. */
  columns?: 2;
  onChange?: (value: string) => void;
  className?: string;
}) {
  const initial =
    defaultValue && options.some((o) => o.value === defaultValue)
      ? defaultValue
      : options[0]?.value;
  const [value, setValue] = useState(initial);

  // The sliding pill. Server-rendered the active label carries its own
  // highlight; after hydration a measured pill takes over and GLIDES between
  // options — the iOS segmented control's signature. Geometry is measured,
  // not guessed, so it survives wrapping rows and the 2×2 grid alike.
  const trackRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const el = track.querySelector<HTMLElement>('[data-active="true"]');
      setPill(
        el
          ? {
              left: el.offsetLeft,
              top: el.offsetTop,
              width: el.offsetWidth,
              height: el.offsetHeight,
            }
          : null,
      );
    };
    const id = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  }, [value]);

  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend
        className={cn(
          "text-muted-fg",
          dense ? "text-xs font-medium" : "text-sm"
        )}
      >
        {legend}
        {required && <RequiredMark />}
      </legend>
      {/* The radios are real radios, visually hidden inside their labels. A
          set of buttons would need its own keyboard handling and would submit
          nothing; radios arrive with arrow-key navigation and form semantics
          already correct. */}
      <div
        ref={trackRef}
        className={cn(
          TRACK,
          "relative mt-1",
          columns === 2 && "grid grid-cols-2 gap-2 p-2 sm:w-full",
        )}
      >
        {pill && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 rounded-lg bg-thumb shadow-control transition-[transform,width,height] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={{
              transform: `translate(${pill.left}px, ${pill.top}px)`,
              width: pill.width,
              height: pill.height,
            }}
          />
        )}
        {options.map((option) => {
          const active = value === option.value;
          return (
            <label
              key={option.value}
              data-active={active}
              className={cn(
                dense ? SEGMENT_DENSE : SEGMENT,
                // The ring the real radio would draw, moved out to the pill
                // that is actually visible — the radio itself is `sr-only` and
                // clipped to a pixel, so its own outline has nowhere to land.
                //
                // `:focus-visible`, not `:focus-within`. Focus-within fires on
                // a mouse click as well, so choosing "Absent" with the pointer
                // left a blue ring sitting on the answer until you clicked
                // somewhere else — a keyboard affordance shown to somebody who
                // was not using the keyboard. A radio clicked with a mouse does
                // not match :focus-visible; one reached by Tab or arrow keys
                // does, which is the whole of what the ring is for. It matches
                // the rest of the app, which is :focus-visible throughout
                // (globals.css, and the star rating's peer-focus-visible).
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40",
                // `relative` so every label paints above the gliding pill —
                // an absolutely-positioned sibling would otherwise cover the
                // inactive options' text.
                "relative",
                // Once the measured pill exists it IS the highlight — the
                // label sheds its own background so the pill can be seen
                // gliding underneath.
                active ? (pill ? "font-semibold text-ink" : ON) : OFF
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
    <nav aria-label={label} className={cn(TRACK_TAB, className)}>
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
            className={cn(SEGMENT_TAB, active ? ON : OFF)}
          >
            {item.label}
            {item.count != null && (
              <span
                className="text-caption tabular-nums text-muted-fg"
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
