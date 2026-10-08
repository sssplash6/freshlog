"use client";

import { ChevronRightIcon, MoreVerticalIcon, PencilIcon } from "@/components/icons";
import { Eyebrow } from "@/components/ui/section";
import { Popover, type PopoverContents } from "@/components/ui/popover";
import { cn } from "@/lib/cn";

/**
 * The menu on one row: correct it, move it, call it off, remove it.
 *
 * Four files built this same control and then drifted. `allocation-`,
 * `assignment-`, `interview-` and `session-row-actions.tsx` each opened with
 * the identical block — two refs, `useAnchoredPosition({ align: "end" })`, a
 * `close` that also reset every confirm flag, and a mousedown-plus-Escape
 * effect keyed on `[open]` — copied to the character across roughly seventy
 * lines. Everything below that line was the row's own business; everything
 * above it was one component that had not been written yet.
 *
 * Copying it four times cost the usual things. Two of the four render a ⋮ and
 * two a widening pencil, which is a defensible distinction that nothing
 * recorded, so it was a coin toss which a new row got. All four sized the
 * trigger at 32px, under the 44px a thumb needs, on pages students and mentors
 * open on a phone. And none of the four had a keyboard contract at all: no
 * `aria-haspopup`, no `aria-controls`, focus neither contained nor returned.
 * Fixing that in one place is the point of the merge; fixing it in four was
 * why it stayed broken.
 *
 * The confirm flags went with the copies. A destructive step is `ConfirmInline`
 * now, and it resets itself for free: the panel only exists while it is open,
 * so closing the menu unmounts the confirm rather than remembering to clear it.
 *
 * The panel is portaled — see `lib/use-anchored-position.ts` for why it has to
 * be, and note the second thing that buys, since every one of these menus
 * holds a form: a portal is not a DOM descendant of the page, so a form in
 * here is not nested inside the form the page already has. That is illegal
 * HTML, and the browser resolves it by silently dropping the inner form's
 * fields. The four copies depended on this without saying so.
 */
export function RowActionMenu({
  trigger,
  label,
  children,
  contents = "fields",
  width = "lg",
  openOnArrival,
}: {
  /**
   * `"dots"` for a menu of several things, `"pencil"` for a row whose menu is
   * essentially one edit. Two shapes, chosen deliberately, so a column of
   * pencils reads as "these are editable" and a column of ⋮ does not.
   */
  trigger: "dots" | "pencil";
  /** The trigger's accessible name, and the panel's: "Edit this session". */
  label: string;
  children: React.ReactNode | ((api: { close: () => void }) => React.ReactNode);
  /** `"actions"` only when the panel holds no fields at all. See `Popover`. */
  contents?: PopoverContents;
  width?: "sm" | "md" | "lg" | "xl";
  /** See `Popover`: opens the panel once on arrival when this returns true. */
  openOnArrival?: () => boolean;
}) {
  return (
    // The menu is the last cell of a row, so it is pinned right and the panel
    // opens from that edge.
    <div className="flex justify-end">
      <Popover
        label={label}
        contents={contents}
        origin="end"
        width={width}
        openOnArrival={openOnArrival}
        // One box for both triggers, and the glyph is the only difference.
        // The pencil used to widen on hover to reveal the word "Edit" — a
        // control that changes size under the cursor, in a column of rows that
        // reflow when it does, and the widened chip ran into whatever was to
        // its right. `label` says "Edit this session" to assistive tech either
        // way, so the word was only ever teaching a pencil what a pencil means.
        triggerClassName={cn(
          // 44px on a phone, where a mis-tap opens the wrong row's menu, and
          // 28px from sm up, where the pointer is precise and a column of
          // 44px squares is louder than the rows it sits beside.
          //
          // 28 and not 36: a row's text line is about twenty pixels, so a 36px
          // control set the height of every row it sat in and left eight pixels
          // of empty band under the words — which is the gap that made a note
          // read as detached from the line above it. The icon is 16px, so 28
          // still leaves it six pixels of air on every side.
          "inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-fg transition sm:h-7 sm:w-7",
          // A grey fill under the pointer and while open — the ghost button's
          // shape. It was a brand tint plus a ring, which spent the selection
          // colour on a hover and put a blue halo on every row a cursor
          // crossed. Nothing sits there permanently: a border on every row of
          // the table at once says "pressable" nowhere.
          "hover:bg-fill hover:text-ink",
          "data-[open]:bg-fill data-[open]:text-ink",
        )}
        trigger={
          trigger === "dots" ? (
            <MoreVerticalIcon className="h-4 w-4" />
          ) : (
            <PencilIcon className="h-4 w-4" />
          )
        }
      >
        {children}
      </Popover>
    </div>
  );
}

/**
 * One band of the panel: an edit form, then the things that end the row.
 *
 * The rule it enforces is the hairline. All four copies wrote `mt-3 border-t
 * border-line pt-2.5` by hand between bands — except `session-row-actions`,
 * which wrote `mt-2.5` in one place and made the border conditional on whether
 * the band above it had rendered, because a rule under nothing is a rule at the
 * top of a panel. `first:` does that arithmetic correctly and forever, so long
 * as groups are direct children of the panel.
 */
export function RowActionGroup({
  label,
  fold = false,
  children,
  className,
}: {
  /** Names the band when it is not obvious from its control: "Progress". */
  label?: React.ReactNode;
  /**
   * Closed until asked for. A row's menu held three forms and four inputs at
   * once — correct, move, remove — when nearly every opening wants one of them
   * (October 2026 audit). The band's label becomes the control that opens it;
   * the main edit stays open and the rare ones are one tap away. Needs a `label`.
   */
  fold?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const band = cn(
    "mt-3 border-t border-line pt-3 first:mt-0 first:border-t-0 first:pt-0",
    className,
  );
  if (fold && label) {
    return (
      <details className={cn(band, "group/fold")}>
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-md text-xs font-medium text-muted-fg transition-colors hover:text-ink sm:min-h-7 [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 transition-transform group-open/fold:rotate-90" />
          {label}
        </summary>
        <div className="mt-2">{children}</div>
      </details>
    );
  }
  return (
    <div className={band}>
      {label && <Eyebrow className="mb-1.5">{label}</Eyebrow>}
      {children}
    </div>
  );
}
