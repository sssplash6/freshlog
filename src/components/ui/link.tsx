import Link from "next/link";

import { ArrowUpRightIcon } from "@/components/icons";
import { buttonClasses, type ButtonSize } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * The two kinds of link. `ArrowLink` goes somewhere else in this app;
 * `ExternalLink` leaves, in a new tab. Both wear one text style: brand,
 * medium weight, the surrounding size, underlined on hover. Only the
 * `action` button still marks that it leaves, with an up-right arrow.
 *
 * Anywhere the app previously printed a literal "→" as text, use `ArrowLink`.
 * A glyph in a sentence is not a link and cannot be tabbed to.
 */

const LINK_TEXT = "font-medium text-brand hover:underline";

/** Internal navigation. The name is historical: it no longer draws an arrow. */
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
  const classes = cn(LINK_TEXT, "inline-flex min-h-11 items-center gap-1.5", className);

  return reloadDocument ? (
    <a href={href} className={classes}>
      {children}
    </a>
  ) : (
    <Link href={href} transitionTypes={["nav-forward"]} className={classes}>
      {children}
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
  /** Drawn as `quiet`; kept so callers compile. */
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
  const marker = variant === "action";
  const quiet = variant === "quiet" || variant === "chip";

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      className={cn(
        "group",
        variant === "inline" && cn(LINK_TEXT, "tap-target inline-flex items-center gap-1 py-1 align-middle"),
        quiet && cn(LINK_TEXT, "inline-flex min-h-11 items-center gap-1.5"),
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
