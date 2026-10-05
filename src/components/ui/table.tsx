import type { ComponentProps, ReactNode } from "react";

import { SortHeader, SortTh } from "@/components/ui/sort-header";
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
   * balance, a caseload's time left. It gets a faint brand band from the
   * heading to the last row, so the eye lands on it before it has read a
   * label. One per table; two key columns are none.
   */
  emphasis?: "key";
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
        // A real edge: the frame is the one place a table says where it
        // stops. Without it a white table on a pale page was rows floating
        // in nothing, and the header band had no box to sit at the top of.
        // `overflow-clip`, not `hidden`: it rounds off the last stripe and the
        // key band at the corners without becoming a scroll container, which
        // would unstick the header (the same reason `Section` uses it). Row
        // menus are portaled, so nothing that has to escape is clipped.
        framed && "overflow-clip rounded-xl bg-surface shadow-sm",
        className,
      )}
    >
      <table
        data-framed={framed ? "" : undefined}
        className="data-table block w-full text-left text-sm text-ink tabular-nums sm:table"
      >
        {/* Column bands. A `<col>` paints UNDER the rows, so the stripe and
            the hover wash still read across a key column — they blend with
            the band instead of covering it. Ignored by the stacked phone
            layout, where the table is not a table. */}
        <colgroup className="hidden sm:table-column-group">
          {columns.map((c, i) => (
            <col
              key={i}
              className={cn(c.emphasis === "key" && "bg-brand-soft/45")}
            />
          ))}
        </colgroup>
        <thead className="hidden sm:table-header-group">
          <tr>
            {columns.map((c, i) => (
              <SortTh
                key={i}
                sortKey={c.sort && c.label ? c.sort : undefined}
                className={cn(
                  // The band and its rule live on the cells, not the <thead>:
                  // a sticky cell paints its own background, a sticky group's
                  // background stays behind at the top of the table.
                  //
                  // A solid band a step off the card, a firmer rule under it,
                  // and the labels in semibold: three separate signals that
                  // this row NAMES the columns rather than being one of them.
                  // It was the card's own white with 13px grey labels on it,
                  // and read as a faint first row.
                  //
                  // `cn` only joins, so a key heading's band and ink REPLACE
                  // the ordinary ones rather than racing them in the CSS.
                  "sticky top-(--sticky-top) z-10 whitespace-nowrap border-b border-line-strong px-4 py-3 text-[0.75rem] font-semibold",
                  c.emphasis === "key"
                    ? "bg-[color-mix(in_oklab,var(--color-brand-soft)_80%,var(--color-head))] text-ink"
                    : "bg-head text-muted-fg",
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
    </div>
  );
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        // Every other row a step off the card. On a nine-figure-wide row the
        // hairline alone could not carry the eye from a name on the left to
        // its balance on the right; the stripe does, and the hover wash sits
        // over both so the row under the pointer is never in doubt.
        "block py-2 transition-colors hover:bg-brand-soft/55 sm:table-row sm:py-0 sm:even:bg-stripe sm:even:hover:bg-brand-soft/55",
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
   * figure the reader came for (`key`, semibold and a step larger), and the
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
        "block px-4 py-0.5 sm:table-cell sm:py-2",
        corner && "max-sm:absolute max-sm:right-1 max-sm:top-1 max-sm:p-0",
        // A right-aligned cell holds a figure, and a figure on two lines —
        // "45 / min", "15+ / hours" — reads as two values. The name column
        // gives way instead (`FILL_CELL`).
        align === "right" && "sm:whitespace-nowrap sm:text-right",
        tone === "key" && "text-[0.9375rem] font-semibold",
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
