"use client";

import { MoreVerticalIcon, PencilIcon } from "@/components/icons";
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
  verb,
  children,
  contents = "fields",
  width = "lg",
}: {
  /**
   * `"dots"` for a menu of several things, `"pencil"` for a row whose menu is
   * essentially one edit. Two shapes, chosen deliberately, so a column of
   * pencils reads as "these are editable" and a column of ⋮ does not.
   */
  trigger: "dots" | "pencil";
  /** The trigger's accessible name, and the panel's: "Edit this session". */
  label: string;
  /** The word a pencil reveals on hover or focus — "Edit", "Change". */
  verb?: string;
  children: React.ReactNode | ((api: { close: () => void }) => React.ReactNode);
  /** `"actions"` only when the panel holds no fields at all. See `Popover`. */
  contents?: PopoverContents;
  width?: "sm" | "md" | "lg";
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
        triggerClassName={cn(
          // 44px on a phone, where a mis-tap opens the wrong row's menu, and
          // 36px from sm up, where the pointer is precise and a column of
          // 44px squares is louder than the rows it sits beside.
          "group inline-flex h-11 items-center justify-center rounded-lg text-muted-fg transition",
          // The tint says "target" and the ring says "pressable" — a border
          // sitting there permanently would say it on every row of the table at
          // once, which is the same as saying it nowhere.
          "hover:bg-brand-soft hover:text-brand hover:ring-2 hover:ring-brand/15",
          "data-[open]:bg-brand-soft data-[open]:text-brand data-[open]:ring-2 data-[open]:ring-brand/15",
          trigger === "dots"
            ? "w-11 sm:h-9 sm:w-9"
            : "gap-1.5 whitespace-nowrap px-2.5 text-[0.8125rem] font-medium sm:h-9",
        )}
        trigger={
          trigger === "dots" ? (
            <MoreVerticalIcon className="h-4 w-4" />
          ) : (
            <>
              <PencilIcon className="h-4 w-4 shrink-0" />
              {verb && (
                // The word is what teaches the icon; once learned the icon is
                // enough, and a column of pencils is quieter than a column of
                // buttons. Hidden from assistive tech because `label` already
                // says this, at more length.
                <span
                  aria-hidden="true"
                  className="max-w-0 overflow-hidden opacity-0 transition-all duration-150 ease-out group-hover:max-w-24 group-hover:opacity-100 group-focus-visible:max-w-24 group-focus-visible:opacity-100 group-data-[open]:max-w-24 group-data-[open]:opacity-100 motion-reduce:transition-none"
                >
                  {verb}
                </span>
              )}
            </>
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
  children,
  className,
}: {
  /** Names the band when it is not obvious from its control: "Progress". */
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-3 border-t border-line pt-2.5 first:mt-0 first:border-t-0 first:pt-0",
        className,
      )}
    >
      {label && <Eyebrow className="mb-1.5">{label}</Eyebrow>}
      {children}
    </div>
  );
}
