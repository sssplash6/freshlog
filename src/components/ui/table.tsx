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
  /**
   * Which way a FIRST click on this heading orders it. A figure opens at the
   * top — the biggest balance, the most hours taught — and a name opens A to Z.
   */
  sortDir?: "asc" | "desc";
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
 *
 * The header row is STICKY. A forty-row roster scrolled to its middle is a
 * column of numbers nobody can name, so the headings ride under the top bar
 * (`--sticky-top`, set in globals.css: the bar's height, or 0 where the rail
 * replaced the bar). Sticky needs no overflow container between it and the page,
 * which is why the wrapper no longer scrolls sideways: at six columns the
 * table fits, and the old `sm:overflow-x-auto` escape hatch contradicted the
 * "no table scrolls sideways" rule it sat under while silently disabling this.
 * The first and last heading cells carry the frame's top corners so the tinted
 * row does not poke square corners out of the rounded border.
 *
 * Figures use tabular numerals so a column of balances lines up digit by
 * digit.
 */
/**
 * For the one column that should take whatever width the others leave — the
 * person a row is about. An auto-layout table sizes a column to its widest
 * unbreakable content, and a truncating name is still its full width to the
 * table: a long email made the roster wider than its frame, squeezed "45 min"
 * onto two lines and pushed the last column out. A zero max-width lets this
 * column absorb the slack and the name truncate into it. The floor keeps it a
 * column: without one, a tablet gave the slack to the Program column and cut
 * every name to five letters, so the neighbours wrap instead. Pointer widths
 * only; the stacked phone row is a block.
 */
export const FILL_CELL = "sm:w-full sm:max-w-0 sm:min-w-36";

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
        framed && "rounded-xl bg-surface shadow-sm",
        className,
      )}
    >
      <table className="data-table block w-full text-left text-sm tabular-nums sm:table">
        <thead className="hidden text-xs font-medium text-muted-fg sm:table-header-group">
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                className={cn(
                  // The tint and hairline live on the cells, not the <thead>:
                  // a sticky cell paints its own background, a sticky group's
                  // background stays behind at the top of the table.
                  "sticky top-(--sticky-top) z-10 border-b border-line bg-surface/90 px-4 pb-2 pt-3 text-[0.75rem] font-medium backdrop-blur-md",
                  framed && "first:rounded-tl-xl last:rounded-tr-xl",
                  c.align === "right" && "text-right",
                )}
              >
                {c.sort && c.label ? (
                  <SortHeader
                    sortKey={c.sort}
                    align={c.align}
                    defaultDir={c.sortDir}
                  >
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
        "block py-2 transition-colors hover:bg-canvas/60 sm:table-row sm:py-0",
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
        "block px-4 py-0.5 sm:table-cell sm:py-2",
        // A right-aligned cell holds a figure, and a figure on two lines —
        // "45 / min", "15+ / hours" — reads as two values. The name column
        // gives way instead (`FILL_CELL`).
        align === "right" && "sm:whitespace-nowrap sm:text-right",
        className,
      )}
      {...props}
    >
      {label && (
        <span className="mr-2 text-xs font-medium text-muted-fg sm:hidden">
          {label}
        </span>
      )}
      {children}
    </td>
  );
}
