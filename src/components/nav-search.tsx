"use client";

import { useSyncExternalStore } from "react";

import { openCommandPalette } from "@/components/command-palette";
import { SearchIcon } from "@/components/icons";
import { fieldChrome } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/** A store that never emits: whether this page has hydrated does not change back. */
function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * The rail's search: a GET form to `/students` without JavaScript, the command
 * palette's opener with it.
 *
 * Progressive enhancement by SWAPPING the control, not by intercepting focus
 * on the field. The palette puts focus back where it came from when it closes,
 * and a field that opens the palette on focus would reopen it on the way out,
 * forever. A button has no such reflex — it opens on a press — so once the
 * page is hydrated the field becomes a button that looks exactly like it, and
 * before that (or with scripts off) it is still the form it always was.
 *
 * Without scripts the field goes to the students list and nowhere else. It
 * once offered two submits, "Students" and "Mentors", directly above nav items
 * reading Students and Mentors — the same two words twice in eight pixels. The
 * roster is the one people search, an order of magnitude longer than the
 * mentors list, which has its own search at the top of its page.
 *
 * `useSyncExternalStore` supplies the two answers — server false, client true —
 * without React calling the difference a hydration mismatch.
 */
export function NavSearch({ mentors }: { mentors: boolean }) {
  // `mentors` still decides the wording: somebody who cannot see the mentors
  // list should not be told this box could find one.
  // Short enough for the 207px rail beside the shortcut hint; the spoken name
  // below stays the full sentence.
  const placeholder = mentors ? "Find a person…" : "Find a student…";
  const enhanced = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const shortcut = useSyncExternalStore(
    subscribeToNothing,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K"),
    () => "Ctrl K"
  );

  if (enhanced) {
    return (
      <button
        type="button"
        onClick={openCommandPalette}
        aria-keyshortcuts="Meta+K Control+K"
        aria-label={mentors ? "Find a student or mentor" : "Find a student"}
        className="relative flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg bg-fill py-2 pl-2.5 pr-2 text-left text-[0.9375rem] text-muted-fg transition-colors hover:bg-fill-strong"
      >
        <SearchIcon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{placeholder}</span>
        <kbd className="shrink-0 rounded-md bg-surface/70 px-1.5 py-0.5 font-sans text-[0.6875rem] font-medium text-muted-fg">
          {shortcut}
        </kbd>
      </button>
    );
  }

  return (
    <form method="get" action="/students" role="search">
      <label htmlFor="nav-search" className="sr-only">
        {mentors ? "Find a student or mentor" : "Find a student"}
      </label>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg" />
        <input
          id="nav-search"
          name="q"
          type="search"
          placeholder={placeholder}
          className={cn(fieldChrome, "min-h-10 w-full py-2 pl-8 pr-2 text-[0.9375rem] placeholder:text-muted-fg")}
        />
      </div>
    </form>
  );
}
