"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { Avatar } from "@/components/avatar";
import { SearchIcon } from "@/components/icons";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  matchNav,
  matchTier,
  type SearchPerson,
  type SearchResults,
} from "@/lib/command-search";
import { useMediaQuery } from "@/lib/use-media-query";

/** The window event any control fires to open the palette — see `openCommandPalette`. */
const OPEN_EVENT = "open-command-palette";

/**
 * Open the palette from anywhere: the rail's search field, the top bar's
 * search button. An event rather than a context, because the openers live in
 * server components' trees on both sides of the shell and a provider around
 * all of them would make the whole shell a client component.
 */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** What the fetch waits for after the last keystroke. */
const DEBOUNCE_MS = 150;

type Place = { href: string; label: string };

type Group = "Actions" | "Go to" | "Students" | "Mentors";

/** One row the keyboard can land on, whatever group it is in. */
type Option = {
  id: string;
  href: string;
  group: Group;
  label: string;
  person?: SearchPerson;
};

/** The log form, opened on one student. */
const logFor = (studentId: string) => `/sessions/new?student=${encodeURIComponent(studentId)}`;

/** The best `matchTier` across a person's name and address; 3 for none. */
function personTier(p: SearchPerson, query: string): number {
  const q = query.toLowerCase();
  const tiers = [p.name ? matchTier(p.name, q) : null, matchTier(p.email, q)].filter(
    (t): t is number => t !== null
  );
  return tiers.length > 0 ? Math.min(...tiers) : 3;
}

/**
 * The query, bolded where it matched, so a reader sees why a row is there —
 * "Mirzaakhmedov" under "ak" reads as a mistake until the "ak" is lit.
 */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="font-semibold text-brand">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}

/**
 * ⌘K / Ctrl+K: every place in the rail and every person the reader could find
 * by opening a list, from one field.
 *
 * NOT A NEW WAY TO SEE ANYONE. The people come from `/api/search`, which asks
 * the questions `/students` and `/mentors` ask through the same `where`
 * builders; the places are the `navFor` items the shell already rendered. So
 * the palette is faster, not wider — anything it offers, the rail could already
 * reach in two clicks.
 *
 * The keyboard model is a combobox with a listbox popup, the one `Select`
 * already keeps (DESIGN.md, "Rules a component has to keep"): focus never
 * leaves the field, the active row is announced through
 * `aria-activedescendant`, arrows and Home/End move, Enter opens, and Escape
 * closes and puts focus back where it was. A modal, so the page behind is
 * scroll-locked and Tab stays inside.
 *
 * On a phone it is the same bottom sheet a popover becomes, anchored to
 * `--kb` so the keyboard the field raises does not bury the results.
 */
export function CommandPalette({
  places,
  mentors,
}: {
  /** The reader's nav items, in rail order. */
  places: Place[];
  /** Whether the reader has a Mentors list — decides the placeholder, as the rail's field does. */
  mentors: boolean;
}) {
  const [open, setOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      returnFocus.current = document.activeElement;
    }
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    setOpen(false);
    // After the dialog is gone, or the focus lands inside a node that is about
    // to be removed and falls to <body>.
    requestAnimationFrame(() => returnFocus.current?.focus());
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘K on a Mac, Ctrl+K elsewhere — and both everywhere, since nobody
      // types Ctrl+K on a Mac by accident. Toggles, like every palette.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) hide();
        else show();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, show);
    };
  }, [open, show, hide]);

  if (!open) return null;
  // Remounted on every open, so it starts from an empty field every time
  // without an effect that resets state.
  return createPortal(
    <Palette places={places} mentors={mentors} onClose={hide} />,
    document.body
  );
}

function Palette({
  places,
  mentors,
  onClose,
}: {
  places: Place[];
  mentors: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const sheet = useMediaQuery("(max-width: 40rem)");
  const titleId = useId();
  const listId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  // The answer, with the question it answers: results for "az" must never be
  // shown under "aziz", and keeping the pair is what lets the render tell.
  const [answer, setAnswer] = useState<{ q: string; results: SearchResults } | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);

  const q = query.trim();

  // The fetch. Debounced, and every stale request aborted, so a fast typist
  // costs one query and a slow network cannot paint an older answer over a
  // newer one.
  useEffect(() => {
    if (!q) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const results = (await res.json()) as SearchResults;
        setAnswer({ q, results });
        setFailed(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error(err);
        setFailed(true);
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  // The page behind a modal does not scroll. `documentElement`, because that
  // is the element that scrolls in this app — `body` overflow alone leaves it
  // moving on iOS.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, []);

  const results = q && answer?.q === q ? answer.results : null;
  const pending = q !== "" && results === null && !failed;

  // Anybody with a session log can write to it — the one thing people open
  // the palette to DO rather than to find.
  const canLog = places.some((p) => p.href === "/sessions");
  const students = results?.students ?? [];
  // Only for a reader with a Mentors item: the placeholder has not promised
  // mentors to anybody else, so they are not offered even where the route
  // would return some.
  const mentorHits = mentors ? (results?.mentors ?? []) : [];

  const actions: Option[] = canLog
    ? [
        ...(matchNav([{ label: "Log a session" }], q).length > 0
          ? [{ id: `${listId}-a-log`, href: "/sessions/new", group: "Actions" as const, label: "Log a session" }]
          : []),
        // The best student hit, one step from a session with them. Every
        // student row also takes ⌘↵ for the same thing.
        ...(students[0]
          ? [
              {
                id: `${listId}-a-log-${students[0].id}`,
                href: logFor(students[0].id),
                group: "Actions" as const,
                label: `Log a session · ${students[0].name ?? students[0].email}`,
              },
            ]
          : []),
      ]
    : [];
  const navRows = matchNav(places, q);
  const byGroup: Record<Exclude<Group, "Actions">, { rows: Option[]; tier: number }> = {
    "Go to": {
      rows: navRows.map<Option>((p) => ({
        id: `${listId}-go-${p.href}`,
        href: p.href,
        group: "Go to",
        label: p.label,
      })),
      tier: Math.min(
        3,
        ...navRows.map((p) => matchTier(p.label, q.toLowerCase()) ?? 3)
      ),
    },
    Students: {
      rows: students.map<Option>((s) => ({
        id: `${listId}-s-${s.id}`,
        href: `/students/${s.id}`,
        group: "Students",
        label: s.name ?? s.email,
        person: s,
      })),
      tier: Math.min(3, ...students.map((s) => personTier(s, q))),
    },
    Mentors: {
      rows: mentorHits.map<Option>((m) => ({
        id: `${listId}-m-${m.id}`,
        href: `/mentors/${m.id}`,
        group: "Mentors",
        label: m.name ?? m.email,
        person: m,
      })),
      tier: Math.min(3, ...mentorHits.map((m) => personTier(m, q))),
    },
  };
  // The group whose best row matches best comes first. Students always led,
  // so "ak" listed two students who merely contain it — Mirzaakhmedov,
  // Rakhimjonov — above the mentor whose name starts with it. Ties keep the
  // old order. With nothing typed, the actions lead: the palette opened empty
  // is a list of things to do and places to go.
  const ranked = (["Go to", "Students", "Mentors"] as const)
    .map((group, order) => ({ group, order, ...byGroup[group] }))
    .filter((g) => g.rows.length > 0)
    .sort((a, b) => (q ? a.tier - b.tier : 0) || a.order - b.order);
  const groups: { group: Group; rows: Option[] }[] = [
    ...(actions.length > 0 && !q ? [{ group: "Actions" as const, rows: actions }] : []),
    ...ranked.map(({ group, rows }) => ({ group, rows })),
    // Typed, they follow the answers: Enter on the first row should open what
    // was typed, not log a session with it.
    ...(actions.length > 0 && q ? [{ group: "Actions" as const, rows: actions }] : []),
  ];
  const options: Option[] = groups.flatMap((g) => g.rows);
  // Clamped at render rather than reset in an effect: results arriving can
  // shorten the list under the cursor, and the cursor stays on the last row.
  const current = options.length === 0 ? -1 : Math.min(active, options.length - 1);

  // Keep the active row in view as the arrows walk past the fold.
  useEffect(() => {
    if (current < 0) return;
    document.getElementById(options[current].id)?.scrollIntoView({ block: "nearest" });
    // `options[current].id` is derived from these two.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, options[current]?.id]);

  function go(option: Option, log = false) {
    // ⌘↵ on a student opens the log form on them instead of their page.
    const href =
      log && canLog && option.group === "Students" && option.person
        ? logFor(option.person.id)
        : option.href;
    onClose();
    // Tell NavProgress: a router.push is invisible to its click listener.
    window.dispatchEvent(new CustomEvent("nav-start", { detail: href }));
    router.push(href);
  }

  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    // An IME composing a character owns Enter and the arrows.
    if (e.nativeEvent.isComposing) return;
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (last >= 0) setActive(current >= last ? 0 : current + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (last >= 0) setActive(current <= 0 ? last : current - 1);
        break;
      case "Home":
        // Only with rows to move to; otherwise Home is the caret's.
        if (last >= 0) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case "End":
        if (last >= 0) {
          e.preventDefault();
          setActive(last);
        }
        break;
      case "Enter":
        if (current >= 0) {
          e.preventDefault();
          go(options[current], e.metaKey || e.ctrlKey);
        }
        break;
    }
  }

  function onDialogKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    // The trap. The rows are not tab stops — the field drives them — so the
    // only stops are the field and, on a phone, Cancel; Tab cycles those.
    if (e.key === "Tab") {
      const stops = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("input, button") ?? []
      );
      if (stops.length === 0) return;
      const i = stops.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      const next = e.shiftKey
        ? stops[(i - 1 + stops.length) % stops.length]
        : stops[(i + 1) % stops.length];
      next.focus();
    }
  }

  const nobody =
    results !== null &&
    results.students.length === 0 &&
    (!mentors || results.mentors.length === 0);

  return (
    <>
      <div
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm",
          sheet ? "scrim-in" : "overlay-in"
        )}
        onPointerDown={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onDialogKeyDown}
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden bg-surface text-left shadow-xl",
          sheet
            ? "sheet-up inset-x-2 bottom-[calc(max(0.5rem,env(safe-area-inset-bottom))+var(--kb,0px))] max-h-[calc(80dvh-var(--kb,0px))] rounded-2xl"
            : "modal-in left-1/2 top-[12vh] max-h-[70vh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl"
        )}
      >
        <h2 id={titleId} className="sr-only">
          {mentors ? "Find a student, mentor or page" : "Find a student or page"}
        </h2>

        <div className="flex items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg" />
            <Input
              ref={inputRef}
              autoFocus
              type="text"
              role="combobox"
              aria-expanded={options.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={current >= 0 ? options[current].id : undefined}
              aria-labelledby={titleId}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKeyDown}
              // The rail's own words, so the field that opened this and the
              // field inside it promise the same thing.
              placeholder={mentors ? "Find a person…" : "Find a student…"}
              measure="full"
              className="pl-9"
            />
          </div>
          {sheet && (
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 shrink-0 cursor-pointer rounded-lg px-3 text-sm font-medium text-brand hover:bg-brand-soft"
            >
              Cancel
            </button>
          )}
        </div>

        <div
          id={listId}
          role="listbox"
          aria-label="Results"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
        >
          {groups.map(({ group, rows }) => (
            <div key={group} role="group" aria-labelledby={`${listId}-${group}`}>
              <p
                id={`${listId}-${group}`}
                role="presentation"
                className="px-3 pb-1 pt-2 text-xs font-medium text-muted-fg"
              >
                {group}
              </p>
              {rows.map((option) => {
                const index = options.indexOf(option);
                const selected = index === current;
                return (
                  <div
                    key={option.id}
                    id={option.id}
                    role="option"
                    aria-selected={selected}
                    // Pointer-down, not click, and default prevented: focus
                    // must stay in the field, or the next arrow key goes to
                    // the page.
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => go(option)}
                    onPointerMove={() => {
                      if (!selected) setActive(index);
                    }}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-body transition-colors duration-150",
                      selected ? "bg-brand-soft text-ink" : "text-ink"
                    )}
                  >
                    {option.person ? (
                      <PersonRow person={option.person} q={q} />
                    ) : (
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {option.group === "Actions" ? (
                          option.label
                        ) : (
                          <Highlight text={option.label} q={q} />
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Said in the live region so a screen reader hears that the answer
              changed, not only a sighted reader who sees the rows move. */}
          <div role="status" aria-live="polite" className="px-3 py-2 text-sm text-muted-fg">
            {/* "Nothing" only when nothing at all came back: it said "No one
                matches" under a list of pages that did. */}
            {failed
              ? "Search failed."
              : nobody && groups.every((g) => g.group === "Actions")
                ? "No matches"
                : nobody
                  ? "No people found"
                  : pending && groups.length === 0
                    ? "Searching…"
                    : ""}
          </div>
        </div>

      </div>
    </>
  );
}

/** A person inside a result row: face, name, and where the reader may see them. */
function PersonRow({ person, q }: { person: SearchPerson; q: string }) {
  const face = {
    id: person.userId,
    name: person.name,
    email: person.email,
    avatarUpdatedAt: person.avatarUpdatedAt ? new Date(person.avatarUpdatedAt) : null,
  };
  const detail = person.programs.length > 0 ? person.programs.join(" · ") : person.email;
  return (
    <>
      <Avatar person={face} className="h-7 w-7 text-caption" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="min-w-0 truncate font-medium">
          <Highlight text={person.name ?? person.email} q={q} />
        </span>
        <span className="min-w-0 truncate text-xs text-muted-fg">{detail}</span>
      </span>
    </>
  );
}

/**
 * The palette's opener below `lg`, where there is no rail and so no field: a
 * 44px icon in the top bar beside the bell, the same target the bell is.
 */
export function CommandPaletteButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label={label}
      aria-keyshortcuts="Meta+K Control+K"
      className="flex h-11 min-w-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-fg transition hover:bg-brand-soft hover:text-brand hover:ring-2 hover:ring-brand/15"
    >
      <SearchIcon className="h-5 w-5" />
    </button>
  );
}
