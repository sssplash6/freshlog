import type { ComponentProps, ReactNode } from "react";

import { SortHeader } from "@/components/ui/sort-header";
import { cn } from "@/lib/cn";

export type Column = {
  label?: ReactNode;
  align?: "right";
  /**
   * The `?sort=` key this column orders by. Present turns the heading into a
   * `SortHeader`; the page reads the parameter back with `readSort`/`applySort`
   * from `lib/sort.ts`. Absent leaves a plain label, which is what a column
   * nobody would ever order by should look like.
   */
  sort?: string;
};

/**
 * The shared data-table chrome: hairline header on a mist tint, divided rows,
 * and — below `sm` — no table at all.
 *
 * A phone cannot show nine columns. It could scroll them sideways, and that is
 * what this did: the student's name stayed visible while their time, their
 * deadline and every action sat off the right edge, reachable only by a swipe
 * nothing on screen suggested. So under `sm` each row becomes a small stack of
 * labelled lines — every field on screen, in reading order, no swipe. Above it,
 * the same table as always.
 *
 * That is why `Td` takes a `label`: it is the column heading, repeated per cell,
 * which is the only way a stacked row can say what its values mean once the
 * header row is gone.
 */
export function Table({
  columns,
  framed = true,
  children,
  className,
}: {
  columns: Column[];
  framed?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sm:overflow-x-auto",
        framed && "rounded-xl border border-line bg-surface",
        className,
      )}
    >
      <table className="block w-full text-left text-sm sm:table">
        <thead className="hidden border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted-fg sm:table-header-group">
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                className={cn(
                  "px-4 py-3 font-medium",
                  c.align === "right" && "text-right",
                )}
              >
                {c.sort && c.label ? (
                  <SortHeader sortKey={c.sort} align={c.align}>
                    {c.label}
                  </SortHeader>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block divide-y divide-line/60 sm:table-row-group">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "block py-2 transition-colors hover:bg-canvas sm:table-row sm:py-0",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  align,
  label,
  className,
  children,
  ...props
}: ComponentProps<"td"> & {
  align?: "right";
  /** The column heading, shown above the value only while stacked. */
  label?: ReactNode;
}) {
  return (
    <td
      className={cn(
        "block px-4 py-1 sm:table-cell sm:py-3",
        align === "right" && "sm:text-right",
        className,
      )}
      {...props}
    >
      {label && (
        <span className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-muted-fg sm:hidden">
          {label}
        </span>
      )}
      {children}
    </td>
  );
}
