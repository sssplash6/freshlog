import { cn } from "@/lib/cn";

const LABEL = "block text-[0.9375rem] font-medium text-ink";

/**
 * One labelled setting: what it is, what it is for, the control, and what that
 * control last did.
 *
 * Five surfaces built this by hand and none of them agreed. The name field, the
 * booking links, the student folder and the program rename each wrote their own
 * `flex flex-wrap items-end gap-2` around a bare `<span className="text-muted-fg">`
 * for a label, and the digest toggle wrote a sixth. Two of the five put their
 * help text above the field and three below; two labelled the input properly
 * and two left it to a placeholder.
 *
 * The description sits UNDER the label rather than under the control, because a
 * sentence explaining what a field does is worth least once the field is
 * already filled in and read.
 *
 * `state` is the row's own `SaveState`. Every row saves independently (§5.8),
 * so the indicator belongs to the row and never to the page.
 */
export function SettingsRow({
  label,
  htmlFor,
  description,
  control,
  state,
  trailing = false,
  className,
}: {
  label: React.ReactNode;
  /**
   * The control's `id`. Optional only because a row's control is sometimes a
   * whole `<form>` or a group of fields, which no single `for` can point at —
   * those label their own fields instead.
   */
  htmlFor?: string;
  description?: React.ReactNode;
  control: React.ReactNode;
  /** The row's `SaveState`, rendered under the control. */
  state?: React.ReactNode;
  /**
   * A compact control — a switch, a short toggle, a value that is only read —
   * pinned to the row's right edge, the way an iOS Settings row carries its
   * switch. Without it such a control sat wherever the 16rem column began,
   * floating in the middle of the row. Fields that want width leave it off.
   */
  trailing?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-x-8 gap-y-2 border-b border-line py-3 last:border-b-0 sm:flex-row sm:justify-between",
        trailing ? "max-sm:flex-row max-sm:items-center sm:items-center" : "sm:items-start",
        className
      )}
    >
      <div className="min-w-0 sm:max-w-xs">
        {htmlFor ? (
          <label htmlFor={htmlFor} className={LABEL}>
            {label}
          </label>
        ) : (
          <div className={LABEL}>{label}</div>
        )}
        {description && (
          <p className="mt-0.5 text-[0.8125rem] text-muted-fg">{description}</p>
        )}
      </div>
      {/* A trailing control hugs the right edge at every width. Otherwise the
          control column keeps a floor of 16rem so a stack of rows lines up
          down the page, and takes the full width below `sm`, where there is no
          column to line up with. */}
      <div
        className={cn(
          "min-w-0",
          trailing
            ? "flex flex-col items-end text-right"
            : "sm:min-w-64 sm:flex-1"
        )}
      >
        {control}
        {state}
      </div>
    </div>
  );
}
