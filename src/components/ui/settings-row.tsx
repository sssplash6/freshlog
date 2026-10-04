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
   * switch. Without it such a control sat wherever the label column ended,
   * floating in the middle of the row. Fields that want width leave it off.
   */
  trailing?: boolean;
  className?: string;
}) {
  return (
    // TWO ROW SHAPES, and both line up down a page.
    //
    //   A field row is a grid from `sm`: a fixed 13rem label column, then the
    //   control. Every field on a page therefore starts at the same x. The
    //   label column used to be as wide as its own text, so the picture, the
    //   name box and the Telegram box began at three different places, and on
    //   the program page five controls began at four.
    //
    //   A trailing row is the label and a compact control pinned to the right
    //   edge, at every width — a switch, a theme toggle, a value only read.
    //
    // Under `sm` a field row stacks: label, then the control at full width.
    <div
      className={cn(
        "gap-x-8 gap-y-2 border-b border-line py-3 last:border-b-0",
        trailing
          ? "flex items-center justify-between"
          : "flex flex-col sm:grid sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-start",
        className
      )}
    >
      <div className={cn("min-w-0", trailing && "flex-1")}>
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
      <div
        className={cn(
          "min-w-0",
          trailing && "flex max-w-[60%] shrink-0 flex-col items-end text-right"
        )}
      >
        {control}
        {state}
      </div>
    </div>
  );
}
