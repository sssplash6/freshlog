import Link from "next/link";

import { ArrowRightIcon, ArrowUpRightIcon } from "@/components/icons";
import { buttonClasses, type ButtonSize } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * The two kinds of link, so the reader can tell them apart before clicking.
 *
 * `ArrowLink` goes somewhere else in this app: arrow points right, and it
 * slides on hover. `ExternalLink` leaves: arrow points up-right and the tab is
 * new. That distinction was being made by hand in nine places, three of which
 * had grown into their own components — `arrow-link.tsx`, `telegram-handle.tsx`
 * and `student-folder-link.tsx`, the last two identical but for their icon and
 * label.
 *
 * Anywhere the app previously printed a literal "→" as text, use `ArrowLink`.
 * A glyph in a sentence is not a link and cannot be tabbed to.
 */

/** Internal navigation. */
export function ArrowLink({
  href,
  children,
  className,
  reloadDocument = false,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  reloadDocument?: boolean;
}) {
  const classes = cn(
    "group inline-flex min-h-11 items-center gap-1.5 font-semibold text-brand hover:text-brand-dark",
    className
  );
  const contents = (
    <>
      {children}
      <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </>
  );

  return reloadDocument ? (
    <a href={href} className={classes}>
      {contents}
    </a>
  ) : (
    <Link href={href} transitionTypes={["nav-forward"]} className={classes}>
      {contents}
    </Link>
  );
}

export type ExternalVariant =
  /**
   * Inside a sentence — a contact in a person's subtitle line.
   *
   * Inherits the surrounding size so the line keeps its rhythm, which is the
   * point: these were 36px bordered pills wedged into a 15px prose line,
   * pushing it open and breaking the sentence around them.
   */
  | "inline"
  /**
   * Its own line, under a row or beside a figure. The default.
   *
   * Tall enough to tap: the anchors this replaced were 17-20px, and "Join the
   * meeting" is a thing a student reaches for on a phone while a call is
   * already starting.
   */
  | "quiet"
  /** A grey-filled pill, for a table cell where a bare link would not read as one. */
  | "chip"
  /** The primary thing to do on the view — booking a session, joining a call. */
  | "action";

export function ExternalLink({
  href,
  icon,
  children,
  variant = "quiet",
  size = "md",
  title,
  className,
}: {
  href: string;
  /** What this link reaches: Telegram, a folder, a calendar. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  variant?: ExternalVariant;
  /** `action` only. */
  size?: ButtonSize;
  title?: string;
  className?: string;
}) {
  // The chip's own icon already says what it reaches, and it is the only
  // variant in a table cell, where a second glyph beside a truncating name is
  // the noise this file exists to remove. Inline links sit mid-sentence, where
  // an arrow reads as punctuation. Both say where they go with `title`.
  const marker = variant === "quiet" || variant === "action";

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      className={cn(
        "group",
        variant === "inline" &&
          "tap-target inline-flex items-center gap-1 py-1 align-middle font-medium text-brand hover:underline",
        variant === "quiet" &&
          "inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-brand hover:underline",
        variant === "chip" &&
          "inline-flex min-h-9 items-center gap-1.5 rounded-full bg-fill px-3 text-xs font-medium text-brand transition-colors hover:bg-fill-strong",
        variant === "action" && buttonClasses("primary", size),
        className
      )}
    >
      {icon}
      {children}
      {marker && (
        <ArrowUpRightIcon className="h-4 w-4 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      )}
    </a>
  );
}
