import { cn } from "@/lib/cn";

export type Fact = {
  label: React.ReactNode;
  value: React.ReactNode;
  /**
   * The inline **Change** control — a link to where the value is edited, or the
   * editor itself once it is open, with its own `SaveState` under it.
   *
   * A fact with no `change` is one nobody can edit from here, and it says so by
   * having nothing to press rather than by disabling something.
   */
  change?: React.ReactNode;
};

/**
 * Label/value facts about one thing: the enrollment, the sign-in address, the
 * folder, the program.
 *
 * A GOV.UK summary list rather than a form, because that is what these are.
 * The student page carried three panels of them — corrections, folder, details
 * — each a `<form>` with a Save button per field, so reading a student's email
 * meant reading it out of an `<input>`. A fact is text until someone asks to
 * change it; only then does a control appear.
 *
 * `<dl>` with a wrapper `<div>` per row is the shape the HTML spec added
 * exactly for this: it keeps each label bound to its own value when the rows
 * stack, which a flat run of `<dt>`/`<dd>` does not.
 */
export function FactList({
  items,
  className,
}: {
  items: Fact[];
  className?: string;
}) {
  return (
    <dl className={cn("divide-y divide-line", className)}>
      {items.map((fact, i) => (
        // The index is the key: a fact list is a fixed run written out at the
        // call site, never a reordered or filtered collection.
        //
        // iOS Settings' row: label muted on the left, value in ink, the edit
        // control trailing on the right edge. A grid rather than flex so the
        // pencil stays on the row's right at every width — stacked below `sm`
        // it used to drop to a line of its own under the value, where it read
        // as belonging to the next fact. Below `sm` the label sits over the
        // value (an email address does not fit beside a label at 390px); from
        // `sm` up the three share one line.
        <div
          key={i}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto]"
        >
          <dt className="col-start-1 row-start-1 text-xs text-muted-fg sm:text-body">
            {fact.label}
          </dt>
          <dd className="col-start-1 row-start-2 min-w-0 break-words text-body text-ink sm:col-start-2 sm:row-start-1">
            {fact.value}
          </dd>
          {fact.change && (
            <dd className="col-start-2 row-span-2 row-start-1 justify-self-end text-sm sm:col-start-3 sm:row-span-1">
              {fact.change}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
