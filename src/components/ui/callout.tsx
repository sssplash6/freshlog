import { AlertIcon, InfoIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { Status } from "@/lib/status";

/**
 * A notice that takes a whole line of the page.
 *
 * Deliberately expensive to use: a callout is the loudest thing on a screen, so
 * the design allows at most ONE per page, reserved for a state that BLOCKS the
 * reader — a student awaiting approval, a mentor who cannot log because time
 * expired, a staff account with no program. Everything else that used to be a
 * callout is a chip on the row it is about, or a line in the attention list.
 *
 * The student home used to stack three of these under a hero.
 *
 * Three tones, down from four, and the fourth is why: `brand` rendered ORANGE
 * (`border-accent/40 bg-accent-soft`), so an informational notice wore the
 * colour that means hours. It is now `info`, and it is not tinted at all — a
 * neutral surface with a blue icon, because "here is something to know" does
 * not need a coloured background to be read.
 *
 * Every tone carries an icon, so the tone is never the only signal.
 *
 * No border on any tone. A callout is a card on the grouped page like every
 * other, and a card here is a fill and nothing around it: info is the white
 * surface, warn and danger are their soft tints, and the tint alone separates
 * them from the grey ground.
 */
export type CalloutTone = "info" | "warn" | "danger";

const SURFACE: Record<CalloutTone, string> = {
  info: "bg-surface shadow-sm",
  warn: "bg-warn-soft",
  danger: "bg-danger-soft",
};

const BODY: Record<CalloutTone, string> = {
  info: "text-muted-fg",
  warn: "text-warn-ink",
  danger: "text-danger-ink",
};

const TITLE: Record<CalloutTone, string> = {
  info: "text-ink",
  warn: "text-warn-ink",
  danger: "text-danger-ink",
};

const ICON: Record<CalloutTone, typeof InfoIcon> = {
  info: InfoIcon,
  warn: AlertIcon,
  danger: AlertIcon,
};

// Info is grey: brand blue is for things you press (DESIGN.md), and an "i"
// in the action colour beside text that does nothing read as a link. October
// 2026.
const ICON_COLOR: Record<CalloutTone, string> = {
  info: "text-muted-fg",
  warn: "text-warn-ink",
  danger: "text-danger-ink",
};

export function Callout({
  tone = "info",
  title,
  children,
  action,
  row,
  className,
}: {
  tone?: CalloutTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  /** One line, action on the right — the "ready for your next session?" shape. */
  row?: boolean;
  className?: string;
}) {
  const Icon = ICON[tone];

  if (row) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-body sm:px-5",
          SURFACE[tone],
          BODY[tone],
          className
        )}
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <Icon className={cn("h-4 w-4 shrink-0 translate-y-0.5", ICON_COLOR[tone])} />
          <div>
            {title && <span className={cn("font-medium", TITLE[tone])}>{title} </span>}
            {children}
          </div>
        </div>
        {action}
      </div>
    );
  }

  return (
    <div className={cn("flex gap-2.5 rounded-xl px-4 py-3 sm:px-5", SURFACE[tone], className)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", ICON_COLOR[tone])} />
      <div className="min-w-0">
        {title && (
          <div className={cn("text-body font-semibold", TITLE[tone])}>{title}</div>
        )}
        {children && (
          <div className={cn("text-xs", BODY[tone], title && "mt-0.5")}>{children}</div>
        )}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

/**
 * A callout built from a blocked status, which is the only kind of state
 * allowed to become one. Keeps the wording and the tone in the model's hands
 * rather than at the call site.
 */
export function StatusCallout({
  status,
  action,
  className,
}: {
  status: Status;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Callout
      tone={status.severity === "problem" ? "danger" : status.severity === "attention" ? "warn" : "info"}
      title={status.label}
      action={action}
      className={className}
    >
      {status.explanation}
    </Callout>
  );
}
