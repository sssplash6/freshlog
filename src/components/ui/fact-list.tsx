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
        <div
          key={i}
          className="flex flex-col gap-x-6 gap-y-1 py-2 sm:flex-row sm:items-baseline"
        >
          <dt className="text-xs font-semibold uppercase tracking-[0.07em] text-muted-fg sm:w-40 sm:shrink-0">
            {fact.label}
          </dt>
          <dd className="min-w-0 flex-1 text-[0.9375rem] text-ink">{fact.value}</dd>
          {fact.change && (
            <dd className="shrink-0 text-sm sm:text-right">{fact.change}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}
