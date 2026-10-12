import type { ComponentProps, ReactNode } from "react";

import { SortHeader, SortTh } from "@/components/ui/sort-header";
import { TableFrame } from "@/components/ui/table-frame";
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
  /** Extra classes for the heading cell — to hide it where its column is hidden. */
  className?: string;
  /**
   * The ONE column a reader opens this table for — a roster's remaining
   * balance, a caseload's time left. Its heading is in ink rather than grey,
   * and its cells pass `tone="key"`. One per table; two key columns are none.
   */
  emphasis?: "key";
};

/**
 * The shared data-table chrome: a quiet heading row, soft hairlines between rows,
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
  label,
  children,
  className,
}: {
  columns: Column[];
  framed?: boolean;
  /** What the table lists, for a screen reader's table navigation ("Students"). */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TableFrame
      className={cn(
        // A real edge: the frame is the one place a table says where it
        // stops. Without it a white table on a pale page was rows floating
        // in nothing, and the header band had no box to sit at the top of.
        // `overflow-clip`, not `hidden`: it rounds off the last row at the
        // corners without becoming a scroll container, which
        // would unstick the header (the same reason `Section` uses it). Row
        // menus are portaled, so nothing that has to escape is clipped.
        framed && "overflow-clip rounded-xl bg-surface shadow-sm",
        className,
      )}
    >
      <table
        aria-label={label}
        data-framed={framed ? "" : undefined}
        className="data-table block w-full text-left text-sm text-ink tabular-nums sm:table"
      >
        <thead className="hidden sm:table-header-group">
          <tr>
            {columns.map((c, i) => (
              <SortTh
                key={i}
                sortKey={c.sort && c.label ? c.sort : undefined}
                className={cn(
                  // A BAND, in small capitals (October 2026, second pass). The
                  // heading row was the card's own white with grey sentence-
                  // case labels, and at a glance it was one more row of the
                  // table — the owner's "unorganised": nothing said where the
                  // names of things stopped and the things began. The band is
                  // the `head` token the palette kept for exactly this, and
                  // it is on the cells because a sticky cell paints its own.
                  "sticky top-(--sticky-top) z-10 h-10 whitespace-nowrap border-b border-line bg-head px-4 text-xs font-semibold sm:first:pl-6 sm:last:pr-6",
                  c.emphasis === "key" ? "text-ink" : "text-muted-fg",
                  framed && "first:rounded-tl-xl last:rounded-tr-xl",
                  c.align === "right" && "text-right",
                  c.className,
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
                  // The same inline-flex box a sortable heading sits in, so a
                  // plain label and a sortable one share a baseline.
                  <span className="inline-flex items-center align-middle">{c.label}</span>
                )}
              </SortTh>
            ))}
          </tr>
        </thead>
        <tbody className="block divide-y divide-line sm:table-row-group">
          {children}
        </tbody>
      </table>
    </TableFrame>
  );
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        // No zebra: soft hairlines carry the eye across a row, and the hover
        // wash says which row is under the pointer.
        "block py-2 transition-colors hover:bg-brand-soft/45 sm:table-row sm:py-0",
        // A stacked row with a corner cell (see `Td`) is the anchor for it, and
        // its first line leaves room so a long name cannot run under the menu.
        "max-sm:relative max-sm:has-[td[data-corner]]:[&>td:first-child]:pr-12",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  align,
  label,
  corner,
  tone,
  className,
  children,
  ...props
}: ComponentProps<"td"> & {
  align?: "right";
  /**
   * A row's actions. Stacked on a phone, it rides in the row's top-right corner
   * instead of taking a line of its own — a ⋮ on a line by itself was a whole
   * row of height under every entry, in a list read by scrolling.
   */
  corner?: boolean;
  /** The column heading, shown above the value only while stacked. */
  label?: ReactNode;
  /**
   * Where this value sits in the row's hierarchy. A row has three levels and
   * no more: the person or thing it is about (`PersonCell`, semibold), the
   * figure the reader came for (`key`, semibold), and the
   * context around it (`muted` — dates, totals, "never"). Everything else is
   * regular ink. A row where every value was `font-medium` read as one flat
   * level, and nothing in it said where to look first.
   */
  tone?: "key" | "muted";
}) {
  return (
    <td
      data-corner={corner ? "" : undefined}
      className={cn(
        // The outer cells sit further in than the gaps between columns, so
        // a row's first name and last figure line up with the card's own
        // padding rather than crowding its edge.
        "block px-4 py-0.5 sm:table-cell sm:py-2 sm:first:pl-6 sm:last:pr-6",
        corner && "max-sm:absolute max-sm:right-1 max-sm:top-1 max-sm:p-0",
        // A right-aligned cell holds a figure, and a figure on two lines —
        // "45 / min", "15+ / hours" — reads as two values. The name column
        // gives way instead (`FILL_CELL`).
        align === "right" && "sm:whitespace-nowrap sm:text-right",
        tone === "key" && "font-semibold",
        tone === "muted" && "text-muted-fg",
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
