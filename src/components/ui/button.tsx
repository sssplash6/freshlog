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
  primary: "bg-brand text-on-brand shadow-sm hover:bg-brand-dark",
  // A white chip with a hairline, not an outlined brand button that INVERTS to
  // solid blue on hover. The inverting version shouted: a secondary action that
  // turns into the loudest thing on the row when the cursor crosses it is a
  // secondary action pretending to be the primary one. This is the shape the
  // cards around it already have.
  secondary:
    "border border-line bg-surface text-brand shadow-sm hover:bg-canvas hover:border-brand/40",
  ghost: "text-brand hover:bg-brand-soft",
  danger: "border border-danger-line text-danger-ink hover:bg-danger-soft",
  // The second half of a two-step confirm: by then the destructive choice IS
  // the primary action, so it is filled, not outlined.
  dangerSolid: "bg-danger text-on-danger shadow-sm hover:bg-danger/90",
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
  md: "h-11 gap-2 px-4 text-sm",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(
    // rounded-xl, not rounded-lg: at 44px tall an 8px corner reads as a
    // rectangle with the corners knocked off. 12px softens it without becoming
    // a pill — a pill reads as a status, and these are the things you press.
    //
    // `transition`, not `transition-colors`: the buttons carry a shadow and a
    // border that changes on hover now, and `transition-colors` animates
    // neither — so the colour eased while the elevation snapped.
    "inline-flex items-center justify-center whitespace-nowrap rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
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
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}
