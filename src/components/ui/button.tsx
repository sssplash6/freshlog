import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "dangerSolid";
export type ButtonSize = "sm" | "md";

/** Brand (blue) = actions (DESIGN.md). No accent-colored buttons — orange is
 * reserved for hours/progress. Red only for destructive. */
const VARIANTS: Record<ButtonVariant, string> = {
  // Lit from above (`sheen`): a flat blue slab beside flat grey fills made the
  // one thing to press the dullest thing on the screen.
  primary:
    "sheen bg-brand text-on-brand hover:bg-brand-dark disabled:bg-fill disabled:bg-none disabled:text-disabled disabled:shadow-none",
  // A grey tinted fill with brand text — iOS's secondary button — not an
  // outlined brand button that INVERTS to solid blue on hover. The inverting
  // version shouted: a secondary action that turns into the loudest thing on
  // the row when the cursor crosses it is a secondary action pretending to be
  // the primary one. The fill is the same one fields sit in, so a form's
  // secondary action and its inputs read as one family, below the one blue
  // button that is the point of the screen.
  secondary: "bg-fill text-brand hover:bg-fill-strong disabled:bg-fill disabled:text-disabled",
  ghost: "text-brand hover:bg-fill disabled:bg-transparent disabled:text-disabled",
  // Quiet: the secondary's grey fill with red words, iOS's destructive
  // secondary. The outlined version was the only bordered button left, and a
  // red outline read louder than the primary it sat beside.
  danger: "bg-fill text-danger-ink hover:bg-fill-strong disabled:bg-fill disabled:text-disabled",
  // The second half of a two-step confirm: by then the destructive choice IS
  // the primary action, so it is filled, not outlined.
  dangerSolid:
    "bg-danger text-on-danger hover:bg-danger/90 disabled:bg-fill disabled:text-disabled",
};

/** Fixed, proportionate heights — sm for inline/table actions, md for the
 * primary actions on a view. Height is set here, not forced globally, so a
 * small label never sits in an oversized box. */
const SIZES: Record<ButtonSize, string> = {
  // xs is for controls inside a popover menu, where sm is already too tall.
  sm: "h-8 gap-1.5 px-3 text-xs",
  // 44px, the smallest reliable touch target. Students and mentors use
  // this app on a phone, and md is the size every primary action gets.
  // 15px, iOS's body size — the label of the thing you press is body text.
  md: "h-11 gap-2 px-4 text-body",
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
    // `press` (globals.css): colours ease and the face scales on the spring
    // under the finger — one acknowledgement, not the scale AND a dim.
    //
    // Disabled is a COLOUR per variant (above), not half opacity: a 50% blue
    // button read as a pale-blue live one, and its label fell to 1.66:1.
    // October 2026.
    "press inline-flex items-center justify-center whitespace-nowrap rounded-lg font-semibold disabled:cursor-not-allowed",
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
