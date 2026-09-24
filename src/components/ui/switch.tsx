"use client";

import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/**
 * A boolean preference in the shape a phone already knows — the iOS switch.
 *
 * A real `<input type="checkbox">` underneath, so form submission, labels,
 * keyboard and screen readers all behave exactly as with a checkbox; the two
 * spans only draw over it. The off track is `line` grey, the on track is
 * `brand` — the app's action colour, standing in for iOS's green.
 *
 * The knob stretches a little while the finger is on it (`active:w-8`), the
 * half-second of physicality every UISwitch has. It submits nothing on its
 * own: callers either wrap it in a form with a Save button or pass an
 * `onChange` that calls `form.requestSubmit()` for the flip-and-done feel.
 */
export function Switch({
  className,
  onChange,
  ...props
}: Omit<ComponentProps<"input">, "type">) {
  return (
    <span
      className={cn(
        "relative inline-flex h-8 w-[3.25rem] shrink-0 items-center",
        className,
      )}
    >
      <input
        type="checkbox"
        {...props}
        onChange={(e) => {
          // The tick a UISwitch gives — Android only; iOS ignores vibrate.
          navigator.vibrate?.(4);
          onChange?.(e);
        }}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      {/* Track */}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-line transition-colors duration-200 peer-checked:bg-brand peer-disabled:opacity-50 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand"
      />
      {/* Knob — iOS widens it slightly while held. */}
      <span
        aria-hidden="true"
        className="absolute left-0.5 top-0.5 h-7 w-7 rounded-full bg-white shadow-md transition-[transform,width] duration-200 peer-checked:translate-x-5 peer-active:w-8 peer-checked:peer-active:w-8 peer-disabled:opacity-80"
      />
    </span>
  );
}
