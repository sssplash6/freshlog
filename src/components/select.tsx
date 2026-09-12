"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { CheckIcon, ChevronDownIcon, SearchIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useAnchoredPosition } from "@/lib/use-anchored-position";

export type SelectOption = {
  value: string;
  label: string;
  /**
   * Secondary metadata under the label — a program, a balance, an email. It is
   * searchable but never the identity, so a long list stays scannable by name.
   */
  hint?: string;
};

/** A row in the popover: either something to pick, or a heading over a group. */
type Row =
  | { kind: "option"; option: SelectOption }
  | { kind: "header"; label: string };

/** Options long enough that scanning beats reading get a search box. */
// Six, not eight. Eight was the point at which a list stops being scannable in
// one glance; in practice the lists that hurt are the mentor pickers, which sit
// at seven and nine depending on the program, so half of them grew a search box
// and half did not — and a control that is searchable on one page and not the
// next teaches nobody it can be typed into.
const SEARCH_THRESHOLD = 6;
/** How many past picks lead the list when `recentKey` is set. */
const RECENT_LIMIT = 4;
/** Typeahead buffer lifetime, matching a native <select>. */
const TYPEAHEAD_MS = 700;
/**
 * "The last row, whichever it turns out to be" — the one active position that
 * can't be named by a value, since ArrowUp-to-open and End both mean the end of
 * a list that filtering may still reshape.
 */
const END = "\u0000end";

function recentsStorageKey(key: string) {
  return `freshlog:select-recent:${key}`;
}

/** localStorage is a nicety here, so every failure mode degrades to "no recents". */
function readRecents(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(recentsStorageKey(key));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(key: string, value: string) {
  if (!value) return;
  try {
    const next = [value, ...readRecents(key).filter((v) => v !== value)].slice(
      0,
      RECENT_LIMIT,
    );
    window.localStorage.setItem(recentsStorageKey(key), JSON.stringify(next));
  } catch {
    // Private mode, quota, disabled storage — recents are optional.
  }
}

function matches(option: SelectOption, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = `${option.label} ${option.hint ?? ""}`.toLowerCase();
  // Every word has to appear somewhere, so "ali master" finds Ali in Master's.
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

/**
 * Custom select: a styled trigger + a popover listbox that matches the app's
 * surfaces (rounded, hairline border, soft shadow, brand-tinted selection)
 * instead of the raw browser dropdown. The chosen value rides a hidden input
 * so server-action forms read it exactly like a native <select>.
 *
 * It implements the full ARIA select-only combobox keyboard contract — arrows,
 * Home/End, PageUp/PageDown, typeahead, Enter/Space to commit, Escape to close
 * with focus restored — because a control this common cannot be mouse-only.
 * Focus stays on the trigger (or the search box) and the active option is named
 * by aria-activedescendant; options are plain <li>s so there is exactly one
 * tab stop, as a native <select> has.
 *
 * Long lists (over six options, or any list passed `searchable`) grow a search
 * box that matches label *and* hint, so a big caseload is filtered by name,
 * email, or program instead of scrolled.
 *
 * The listbox is portaled to <body> and positioned `fixed`. It has to be: these
 * selects sit at the foot of `Panel`s, which are `overflow-hidden` to mask
 * their rounded corners, and an absolutely-positioned list is simply cut off at
 * that edge — a mentor list would render as an unusable few-pixel sliver.
 */
export function Select({
  name,
  options,
  placeholder = "Select…",
  defaultValue = "",
  ariaLabel,
  required = true,
  searchable,
  recentKey,
  onChange,
}: {
  name: string;
  options: SelectOption[];
  placeholder?: string;
  defaultValue?: string;
  ariaLabel: string;
  required?: boolean;
  /** Force the search box on or off; defaults to on past SEARCH_THRESHOLD. */
  searchable?: boolean;
  /**
   * Remember this control's last few picks under this key and float them to the
   * top. For pickers used over and over (the same handful of students, week
   * after week) that turns a scan into a first-row click.
   */
  recentKey?: string;
  /** Notifies the parent when the choice changes, for dependent fields. */
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The active row is tracked by VALUE, not index: filtering and the recents
  // regrouping both reorder the list under the keyboard, and an index would
  // silently point at a different option (or a header) afterwards.
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef<{ buffer: string; timer: ReturnType<typeof setTimeout> | null }>({
    buffer: "",
    timer: null,
  });
  const baseId = useId();
  const listId = `${baseId}-list`;
  const errorId = `${baseId}-error`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;

  const anchored = useAnchoredPosition(open, triggerRef, popRef, {
    matchTriggerWidth: true,
    maxHeight: 320,
  });

  // Rows: the optional "no choice" row, then recent picks, then everything else.
  const rows = useMemo<Row[]>(() => {
    const visible = options.filter((o) => matches(o, query));
    const head: Row[] = [];
    if (!required && matches({ value: "", label: placeholder }, query)) {
      head.push({ kind: "option", option: { value: "", label: placeholder } });
    }
    const recent = recentKey
      ? recents
          .map((v) => visible.find((o) => o.value === v))
          .filter((o): o is SelectOption => Boolean(o))
      : [];
    if (recent.length === 0) {
      return [...head, ...visible.map((option) => ({ kind: "option" as const, option }))];
    }
    const rest = visible.filter((o) => !recent.includes(o));
    return [
      ...head,
      { kind: "header", label: "Recent" },
      ...recent.map((option) => ({ kind: "option" as const, option })),
      ...(rest.length > 0 ? [{ kind: "header" as const, label: "All" }] : []),
      ...rest.map((option) => ({ kind: "option" as const, option })),
    ];
  }, [options, query, required, placeholder, recentKey, recents]);

  const pickable = (i: number) => rows[i]?.kind === "option";
  const firstPickable = (from: number, dir: 1 | -1) => {
    for (let i = from; i >= 0 && i < rows.length; i += dir) {
      if (pickable(i)) return i;
    }
    return -1;
  };
  const indexOfValue = (v: string | null) =>
    v === null
      ? -1
      : rows.findIndex((r) => r.kind === "option" && r.option.value === v);

  // Derived, never stored: whatever the active value points at right now, or
  // the first pickable row if it has been filtered away.
  const active = (() => {
    if (activeValue === END) return firstPickable(rows.length - 1, -1);
    const at = indexOfValue(activeValue);
    return at >= 0 ? at : firstPickable(0, 1);
  })();

  const setActive = (i: number) => {
    const row = rows[i];
    if (row?.kind === "option") setActiveValue(row.option.value);
  };

  const openList = (from: "value" | "last") => {
    setInvalid(false);
    if (recentKey) setRecents(readRecents(recentKey));
    setActiveValue(from === "last" ? END : value || null);
    setOpen(true);
  };

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) triggerRef.current?.focus();
  };

  const choose = (v: string) => {
    setValue(v);
    setInvalid(false);
    if (recentKey) {
      pushRecent(recentKey, v);
      setRecents(readRecents(recentKey));
    }
    close(true);
    onChange?.(v);
  };

  const commit = () => {
    const row = rows[active];
    if (row?.kind === "option") choose(row.option.value);
  };

  const move = (delta: number) => {
    const dir = delta > 0 ? 1 : -1;
    let at = active;
    for (let step = 0; step < Math.abs(delta); step++) {
      const next = firstPickable(at + dir, dir);
      if (next < 0) break;
      at = next;
    }
    setActive(at);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // The list lives in a portal, so "inside" means either element — a
      // containment test on the trigger's wrapper alone would treat picking an
      // option as clicking away and close before the choice registered.
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    const pop = popRef.current;
    if (!open || !pop) return;
    // A select can live inside another popover (the row-action menus), and that
    // menu closes on any mousedown outside its own DOM. Now that the list is
    // portaled it IS outside, so choosing an option would tear the menu down
    // around it. Claim the event here, at the element, before it reaches the
    // document-level listeners that would misread it.
    const claim = (e: MouseEvent) => e.stopPropagation();
    pop.addEventListener("mousedown", claim);
    return () => pop.removeEventListener("mousedown", claim);
  }, [open]);

  // Focus follows the interaction model: into the search box when there is one,
  // otherwise it never leaves the trigger.
  //
  // Waits for the measurement. The popover is `visibility: hidden` for the frame
  // before it has been placed, and a hidden element cannot take focus — focusing
  // it there fails silently, leaving the keystrokes at the trigger, where a
  // searchable select has nothing to do with them. Depends on the boolean, not
  // on `anchored` itself, or every re-measure on scroll would yank focus back.
  const measured = anchored !== null;
  useEffect(() => {
    if (open && withSearch && measured) searchRef.current?.focus();
  }, [open, withSearch, measured]);

  // Keep the active option in view for arrow-key and typeahead navigation.
  //
  // Scrolls the list by hand rather than with scrollIntoView, which walks every
  // scrollable ancestor: for the frame before the popover is placed it is still
  // a static block at the foot of <body>, and "bring that into view" means
  // scrolling the whole PAGE to the bottom. Opening a select two thousand pixels
  // up the page did exactly that.
  useEffect(() => {
    const list = listRef.current;
    const option = list?.querySelector('[data-active="true"]');
    if (!open || !list || !option) return;
    const item = option.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    if (item.top < box.top) list.scrollTop -= box.top - item.top;
    else if (item.bottom > box.bottom) list.scrollTop += item.bottom - box.bottom;
  }, [open, active, rows.length]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList("value");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        openList("last");
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Typing straight at a closed select opens it, as a native one does.
        e.preventDefault();
        openList("value");
        if (withSearch) setQuery(e.key);
        else typeaheadTo(e.key);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        return;
      case "PageDown":
        e.preventDefault();
        move(10);
        return;
      case "PageUp":
        e.preventDefault();
        move(-10);
        return;
      case "Home":
        e.preventDefault();
        setActive(firstPickable(0, 1));
        return;
      case "End":
        e.preventDefault();
        setActiveValue(END);
        return;
      case "Enter":
        e.preventDefault();
        commit();
        return;
      case "Escape":
        e.preventDefault();
        close(true);
        return;
      case "Tab":
        // Commit and let focus leave, the way a native select does.
        commit();
        return;
      case " ":
        // In a search box a space is a space; without one it commits.
        if (!withSearch) {
          e.preventDefault();
          commit();
        }
        return;
      default:
        if (!withSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          typeaheadTo(e.key);
        }
    }
  };

  /**
   * Jump to the first option starting with the recently typed characters. The
   * buffer is cleared by a timer rather than compared against a clock, so
   * nothing here reads the current time during a render.
   */
  const typeaheadTo = (char: string) => {
    if (typeahead.current.timer) clearTimeout(typeahead.current.timer);
    const buffer = typeahead.current.buffer + char;
    typeahead.current = {
      buffer,
      timer: setTimeout(() => {
        typeahead.current.buffer = "";
      }, TYPEAHEAD_MS),
    };
    const needle = buffer.toLowerCase();
    const hit = rows.findIndex(
      (r) => r.kind === "option" && r.option.label.toLowerCase().startsWith(needle),
    );
    if (hit >= 0) setActive(hit);
  };

  const selected = options.find((o) => o.value === value);

  return (
    <div className="relative">
      {/*
        The value carrier. It is a real, validatable input rather than
        type="hidden" so a required select is caught in the browser instead of
        as a generic server error a second later: hidden inputs are barred from
        constraint validation. It is one pixel of transparency pinned to the
        trigger, focusable enough for the browser to report on, and its own
        invalid event is claimed so we can render the message ourselves and put
        focus where the user can act — on the trigger.
      */}
      <input
        type="text"
        name={name}
        value={value}
        required={required}
        onChange={() => {}}
        onInvalid={(e) => {
          e.preventDefault();
          setInvalid(true);
          triggerRef.current?.focus();
        }}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-3 h-px w-px opacity-0"
      />
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && !withSearch && pickable(active) ? optionId(active) : undefined
        }
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onClick={() => (open ? close(false) : openList("value"))}
        onKeyDown={onKeyDown}
        className={cn(
          // 44px, not 40. §9 measured every control on a phone and this was
          // the one that appears most often — the log form and every filter
          // row carry one — so four pixels here is four pixels everywhere.
          "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border bg-surface pl-3.5 pr-2.5 text-[0.9375rem] transition-colors focus:outline-none",
          invalid
            ? "border-danger"
            : open
              ? "border-brand"
              : "border-line hover:border-brand/40",
          selected ? "text-ink" : "text-muted-fg",
        )}
      >
        {/* min-w-0: a flex item's min-width defaults to its content, so without
            this the longest option name makes the whole control wider than its
            column — and on a phone, wider than the screen. truncate can only do
            its job once the item is allowed to shrink. */}
        <span className="min-w-0 truncate">
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDownIcon
          className={cn(
            "h-4 w-4 shrink-0 text-muted-fg transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {invalid && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger-ink">
          {ariaLabel} is required.
        </p>
      )}

      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{
              ...anchored?.style,
              // Hidden for the single frame before it has been measured, so it
              // never flashes at the top-left corner.
              visibility: anchored ? "visible" : "hidden",
            }}
            className={cn(
              "pop-in z-50 flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-lg",
              anchored?.up ? "[--pop-origin:bottom]" : "[--pop-origin:top]",
            )}
          >
            {withSearch && (
              <div className="flex items-center gap-2 border-b border-line px-3">
                <SearchIcon className="h-4 w-4 shrink-0 text-muted-fg" />
                <input
                  ref={searchRef}
                  type="text"
                  role="combobox"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  aria-label={`Search ${ariaLabel.toLowerCase()}`}
                  aria-expanded
                  aria-autocomplete="list"
                  aria-controls={listId}
                  aria-activedescendant={pickable(active) ? optionId(active) : undefined}
                  placeholder="Type to filter…"
                  className="min-h-11 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted-fg focus:outline-none"
                />
              </div>
            )}
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
            >
              {rows.length === 0 && (
                <li className="px-2.5 py-2 text-sm text-muted-fg">
                  Nothing matches “{query.trim()}”.
                </li>
              )}
              {rows.map((row, i) =>
                row.kind === "header" ? (
                  <li
                    key={`h-${row.label}`}
                    role="presentation"
                    className="px-2.5 pb-1 pt-2 text-[0.625rem] font-bold uppercase tracking-[0.08em] text-muted-fg"
                  >
                    {row.label}
                  </li>
                ) : (
                  <SelectItem
                    key={row.option.value || "__none"}
                    id={optionId(i)}
                    option={row.option}
                    selected={row.option.value === value}
                    active={i === active}
                    onHover={() => setActive(i)}
                    onSelect={() => choose(row.option.value)}
                  />
                ),
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

function SelectItem({
  id,
  option,
  selected,
  active,
  onHover,
  onSelect,
}: {
  id: string;
  option: SelectOption;
  selected: boolean;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      data-active={active || undefined}
      onClick={onSelect}
      onPointerMove={onHover}
      className={cn(
        "flex cursor-pointer items-center justify-between gap-4 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
        selected
          ? "bg-brand-soft font-medium text-brand"
          : active
            ? "bg-canvas text-ink"
            : "text-ink",
      )}
    >
      <span className="min-w-0">
        <span className="block min-w-0 truncate">{option.label}</span>
        {option.hint && (
          <span
            className={cn(
              "block truncate text-xs",
              selected ? "text-brand/80" : "text-muted-fg",
            )}
          >
            {option.hint}
          </span>
        )}
      </span>
      {selected && <CheckIcon className="h-4 w-4 shrink-0" />}
    </li>
  );
}
