"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { useAnchoredPosition } from "@/lib/use-anchored-position";

/**
 * A panel anchored to the control that opened it — a menu, an account card, a
 * correction form on one table row.
 *
 * Three mechanisms did this job before, and each got a different subset of it
 * right. Two hand-styled `<details>` in `app-shell.tsx`, which is a disclosure
 * pressed into service as a menu: it never closes when you click the page
 * behind it, it never closes on Escape, and its `absolute` panel is cropped by
 * the first ancestor that hides overflow. A per-file portal copied into four
 * `*-row-actions.tsx` files, seventeen identical lines of
 * outside-click-and-Escape apiece. And `select.tsx`, which is the only one of
 * the three that thought about a keyboard.
 *
 * What the four copies all missed is the same three things, and they are the
 * reason this file exists rather than a shared `useDismiss` hook:
 *
 *   Focus never came back. Escape closed the panel and left focus on a node
 *   that had just been unmounted, which puts it on <body> — so the next Tab
 *   started from the top of the page, not from the row you were working on.
 *
 *   Focus was never contained. The panel is portaled to the end of <body>, so
 *   tabbing off its last field did not return to the table: it ran out of the
 *   document entirely, into the browser's own chrome.
 *
 *   The trigger claimed nothing. `aria-expanded` with no `aria-haspopup` and no
 *   `aria-controls` announces as "button, expanded" — expanded into what is
 *   left for the reader to guess.
 *
 * `contents` picks which ARIA shape the panel takes, and it is not decoration.
 * `"actions"` is a real `role="menu"`, which is right for a list of things to
 * do and wrong for anything else: a menu puts assistive tech into application
 * mode, where a text field inside it stops behaving like a text field. Every
 * one of the four row menus holds a form, so those are `"fields"` — a
 * non-modal `role="dialog"`, which keeps forms working and still gets a name
 * announced when focus enters. The interaction is identical either way; only
 * the announcement differs.
 *
 * Dismissal is deliberately quiet: no backdrop, no scroll lock, nothing behind
 * it inert. This is a menu, not a modal — the page underneath stays readable
 * and clickable, and clicking it is how you close this.
 */

/** Everything a Tab can land on inside a panel, in document order. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Controls that own the arrow keys already: a caret moves in a text field, a
 * number input steps, a date input walks its segments, a radio group moves
 * between its own options (which `SegmentedRadio` relies on, and it is inside
 * the session correction panel), `Select` runs the whole combobox contract off
 * them, and a calendar grid reads up and down as a WEEK rather than as the
 * next item in a list. Roving focus must never take arrows from one of these,
 * so the menu's own arrow handling applies only outside them. A checkbox is
 * the one input with nothing to do with an arrow, so it joins the roving.
 */
const OWNS_ARROWS =
  'input:not([type="checkbox"]),textarea,select,[role="combobox"],[role="grid"]';

/** Panel widths: the app-shell menus at w-60, and the row menus at w-72 / w-80. */
const WIDTHS = {
  sm: "w-60",
  md: "w-72",
  lg: "w-80",
} as const;

/**
 * Tall enough for a correction form, short enough to leave the trigger's row
 * visible. Past this the panel scrolls; without it a menu on the last row of a
 * long table opens off the bottom of the screen.
 */
const MAX_HEIGHT = 440;

export type PopoverContents = "actions" | "fields";

function focusablesIn(panel: HTMLElement): HTMLElement[] {
  // offsetParent is a layout read, which is why this only ever runs from an
  // event handler or an effect — never during render.
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null,
  );
}

export function Popover({
  trigger,
  label,
  children,
  contents = "actions",
  origin = "end",
  width = "md",
  triggerClassName,
  className,
}: {
  /** What goes inside the trigger button — an icon, or an icon and a word. */
  trigger: React.ReactNode;
  /** Names the trigger and, for `contents="fields"`, the panel too. */
  label: string;
  /**
   * The panel. As a function it is handed `close`, for an item that should
   * dismiss the menu it lives in — picking a destination, opening a form
   * elsewhere on the page.
   */
  children: React.ReactNode | ((api: { close: () => void }) => React.ReactNode);
  /** `"actions"` for a list of things to do, `"fields"` for anything with a form in it. */
  contents?: PopoverContents;
  /** Which edge lines up with the trigger's. Row actions sit at the right of a table. */
  origin?: "start" | "end";
  width?: keyof typeof WIDTHS;
  /** Classes for the trigger button. Include `group` to style its contents by state. */
  triggerClassName?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Whether the close that is about to happen was ours. Kept in state rather
  // than a ref so `close` captures nothing but setters — it is handed to
  // `children` during render, and a function that reads a ref must not be.
  const [restoring, setRestoring] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const anchored = useAnchoredPosition(open, triggerRef, panelRef, {
    align: origin,
    maxHeight: MAX_HEIGHT,
  });
  // The boolean, not the object: `anchored` is replaced on every scroll, and an
  // effect that depends on it would keep re-running while the page moves.
  const measured = anchored !== null;

  const close = useCallback((restoreFocus: boolean) => {
    setRestoring(restoreFocus);
    setOpen(false);
  }, []);

  // Escape, or an item that dismissed the menu, must put focus back on the
  // trigger: the panel it was in has just unmounted, and focus left on a
  // removed node falls to <body>, so the next Tab starts from the top of the
  // page instead of the row being worked on. After a click on the page behind,
  // focus belongs wherever that click put it — dragging it back here would
  // fight the reader for their own cursor.
  // Nothing resets the flag: the effect fires on a transition, and it can only
  // transition into "closed and ours" by way of a `close` that said so.
  useEffect(() => {
    if (open || !restoring) return;
    triggerRef.current?.focus();
  }, [open, restoring]);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The trigger is not "outside". Without this test the sequence on a click
      // is: mousedown closes the panel, then the trigger's own click reopens
      // it — so a menu that is already open can never be closed by its own
      // button, and one that is closed appears to flicker.
      if (triggerRef.current?.contains(target)) return;
      // Nor is the panel, which lives in a portal and so is not a DOM
      // descendant of anything here.
      if (panelRef.current?.contains(target)) return;
      close(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Something inside got there first — a `Select` closing its own listbox,
      // a confirm stepping back from "Yes, delete it". Escape peels one layer
      // at a time, and the innermost layer claims it by calling
      // preventDefault. All four copies skipped this test, so dismissing an
      // open Select tore the whole menu down around it.
      if (e.defaultPrevented) return;
      // And claim it on the way out, so this panel is the only layer that
      // closes: a date picker opened inside a correction form should hand the
      // form back, not dismiss the row it belongs to.
      e.preventDefault();
      close(true);
    };

    // Bubble phase on purpose, not capture: `select.tsx` stops mousedown at its
    // own portaled listbox precisely so this listener does not read "picked an
    // option" as "clicked away". Capturing here would run first and undo that.
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    // A popover can open inside another one — a date picker in the session
    // correction form. The outer panel closes on any mousedown outside its own
    // DOM, and this one is portaled, so it IS outside: picking a day would
    // tear the form down around it. Claim the event at the element, before it
    // reaches the document listener that would misread it. Same arrangement
    // `select.tsx` has, for the same reason.
    const claim = (e: MouseEvent) => e.stopPropagation();
    panel.addEventListener("mousedown", claim);
    return () => panel.removeEventListener("mousedown", claim);
  }, [open, measured]);

  // Move into the panel once it has been placed. A panel is `visibility:
  // hidden` for the frame before it is measured, and a hidden element cannot
  // take focus — focusing it there fails silently and leaves every keystroke
  // at the trigger.
  useEffect(() => {
    if (!open || !measured) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (contents === "actions") {
      // A menu opens on its first item, the way every platform menu does.
      focusablesIn(panel)[0]?.focus();
    } else {
      // A form panel takes focus on the container, not the first field: it
      // gets the panel's name announced, and it does not throw up a phone
      // keyboard for someone who opened the menu to read what is in it.
      panel.focus();
    }
  }, [open, measured, contents]);

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    // Enter and Space are a button's own business. ArrowDown is the one key a
    // menu button is expected to answer that a plain button is not.
    if (!open && e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (!panel) return;

    if (e.key === "Tab") {
      const items = focusablesIn(panel);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Wrap at both ends. Tabbing out of a portaled panel does not land back
      // on the row that opened it — the portal is the last thing in <body>, so
      // "next" is the end of the document.
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if ((e.target as HTMLElement).closest(OWNS_ARROWS)) return;
    const items = focusablesIn(panel);
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const down = e.key === "ArrowDown";
    // From the panel itself, or from anything that is not an item, an arrow
    // enters the list at the end it points from, rather than wrapping off an
    // index of -1 into the middle of it.
    const next =
      at < 0
        ? down
          ? 0
          : items.length - 1
        : (at + (down ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup={contents === "actions" ? "menu" : "dialog"}
        aria-expanded={open}
        // Only while it exists: pointing at an absent id is worse than silence.
        aria-controls={open ? panelId : undefined}
        data-open={open || undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
        className={triggerClassName}
      >
        {trigger}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role={contents === "actions" ? "menu" : "dialog"}
            aria-label={label}
            // -1 so the container can hold focus without joining the tab order.
            tabIndex={-1}
            onKeyDown={onPanelKeyDown}
            style={{
              ...anchored?.style,
              // Hidden for the one frame before it is placed, so it never
              // flashes in the top-left corner of the screen.
              visibility: anchored ? "visible" : "hidden",
            }}
            className={cn(
              "pop-in z-50 overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface text-left shadow-lg focus:outline-none",
              // The width is a ceiling on a phone: `useAnchoredPosition` pins
              // whichever edge `origin` names, so on a 320px screen a w-80
              // panel would hang the other edge off the side.
              "max-w-[calc(100vw-1rem)]",
              WIDTHS[width],
              // Actions carry their own padding, so the panel gives them only
              // enough to keep a hover fill off the border.
              contents === "actions" ? "p-1" : "p-3",
              anchored?.up
                ? origin === "end"
                  ? "[--pop-origin:bottom_right]"
                  : "[--pop-origin:bottom_left]"
                : origin === "end"
                  ? "[--pop-origin:top_right]"
                  : "[--pop-origin:top_left]",
              className,
            )}
          >
            {typeof children === "function"
              ? children({ close: () => close(true) })
              : children}
          </div>,
          document.body,
        )}
    </>
  );
}
