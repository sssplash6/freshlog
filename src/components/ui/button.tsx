import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "dangerSolid";
export type ButtonSize = "xs" | "sm" | "md";

/** Brand (blue) = actions (DESIGN.md). No accent-colored buttons — orange is
 * reserved for hours/progress. Red only for destructive. */
const VARIANTS: Record<ButtonVariant, string> = {
  // Flat. iOS's filled button has no drop shadow, and a shadow under the one
  // blue thing on the screen was the web-button tell beside flat grey fills.
  primary: "bg-brand text-on-brand hover:bg-brand-dark",
  // A grey tinted fill with brand text — iOS's secondary button — not an
  // outlined brand button that INVERTS to solid blue on hover. The inverting
  // version shouted: a secondary action that turns into the loudest thing on
  // the row when the cursor crosses it is a secondary action pretending to be
  // the primary one. The fill is the same one fields sit in, so a form's
  // secondary action and its inputs read as one family, below the one blue
  // button that is the point of the screen.
  secondary: "bg-fill text-brand hover:bg-fill-strong",
  ghost: "text-brand hover:bg-fill",
  // Quiet: the secondary's grey fill with red words, iOS's destructive
  // secondary. The outlined version was the only bordered button left, and a
  // red outline read louder than the primary it sat beside.
  danger: "bg-fill text-danger-ink hover:bg-fill-strong",
  // The second half of a two-step confirm: by then the destructive choice IS
  // the primary action, so it is filled, not outlined.
  dangerSolid: "bg-danger text-on-danger hover:bg-danger/90",
};

/** Fixed, proportionate heights — sm for inline/table actions, md for the
 * primary actions on a view. Height is set here, not forced globally, so a
 * small label never sits in an oversized box. */
const SIZES: Record<ButtonSize, string> = {
  // xs is for controls inside a popover menu, where sm is already too tall.
  xs: "h-7 gap-1 px-2.5 text-xs",
  sm: "h-8 gap-1.5 px-3 text-[0.8125rem]",
  // 44px, the smallest reliable touch target. Students and mentors use
  // this app on a phone, and md is the size every primary action gets.
  // 15px, iOS's body size — the label of the thing you press is body text.
  md: "h-11 gap-2 px-4 text-[0.9375rem]",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(
    // rounded-lg — 12px on this app's scale (globals.css): at 44px tall an 8px
    // corner reads as a rectangle with the corners knocked off, and 12px
    // softens it without becoming a pill — a pill reads as a status, and these
    // are the things you press.
    //
    // `active:opacity-80`: the dim a UIButton gives under the finger, which a
    // hover colour cannot — a phone has no hover.
    "inline-flex items-center justify-center whitespace-nowrap rounded-lg font-semibold transition active:opacity-80 disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      {...props}
    />
  );
}

type LinkButtonProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/** A link that looks like a button (navigation that should read as an action). */
export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: LinkButtonProps) {
  return (
    <Link
      /* "Log a session", "Allocate time" — every LinkButton drills into a
         page, so it pushes forward. A caller that means otherwise can pass
         its own transitionTypes. */
      transitionTypes={["nav-forward"]}
      className={buttonClasses(variant, size, className)}
      {...props}
    />
  );
}
