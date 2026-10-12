"use client";

import { useMemo, useRef, useState } from "react";

import { ChevronDownIcon, SearchIcon } from "@/components/icons";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { ProgramOption } from "@/lib/queries";
import { RequiredMark } from "@/components/ui/required-mark";

/** A pairing the server understands: "p:<programId>", "l:<levelId>" or "c:<cohortId>". */
export type Target = string;

const programTarget = (programId: string) => `p:${programId}`;
const levelTarget = (levelId: string) => `l:${levelId}`;
const cohortTarget = (cohortId: string) => `c:${cohortId}`;

/**
 * Show the filter once the list is long enough that scanning it costs
 * something. Counted in PROGRAMS, the rows a reader actually scans: at six
 * rows-including-cohorts a school of five programs got a search box for a
 * list that fits on one screen.
 */
const SEARCH_THRESHOLD = 8;

/**
 * Which programs (or single cohorts within them) a mentor works in.
 *
 * This used to be every program and every cohort as one flat wrapping row of
 * checkboxes, which stops working the moment the roster grows: nothing said
 * which cohort belonged to which program. So each program is its own row, and
 * cohorts stay folded away until someone actually needs to narrow a mentor
 * down to one — a program opens on its own when something inside it is ticked.
 *
 * A program-wide assignment and a cohort-specific one inside it are the same
 * claim made twice, so picking the whole program clears — and locks — its
 * cohorts rather than letting both ride to the server.
 *
 * Selection travels as repeated hidden `targets` inputs, exactly what the plain
 * checkboxes sent, so the action's contract is untouched. The one validatable
 * input alongside them is what makes "pick at least one" a browser-level
 * requirement instead of a server round-trip: hidden inputs are barred from
 * constraint validation, so the group's asterisk was decoration.
 */
export function ProgramTargetsPicker({
  programs,
  defaultTargets = [],
  legend = "Programs",
  required = true,
}: {
  programs: ProgramOption[];
  defaultTargets?: Target[];
  legend?: string;
  required?: boolean;
}) {
  const [selected, setSelected] = useState<Target[]>(defaultTargets);
  const [query, setQuery] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [expanded, setExpanded] = useState<string[]>(() =>
    // A program opens with its subdivisions showing when one of them is the
    // reason this mentor is assigned at all.
    programs
      .filter(
        (p) =>
          p.cohorts.some((c) => defaultTargets.includes(cohortTarget(c.id))) ||
          p.levels.some(
            (l) =>
              defaultTargets.includes(levelTarget(l.id)) ||
              l.cohorts.some((c) => defaultTargets.includes(cohortTarget(c.id))),
          ),
      )
      .map((p) => p.id),
  );
  const firstControlRef = useRef<HTMLInputElement>(null);
  const errorId = "program-targets-error";

  const rows =
    programs.length +
    programs.reduce(
      (n, p) =>
        n +
        p.cohorts.length +
        p.levels.reduce((m, l) => m + 1 + l.cohorts.length, 0),
      0,
    );
  const withSearch = programs.length > SEARCH_THRESHOLD || rows > SEARCH_THRESHOLD * 3;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return programs;
    return programs.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.cohorts.some((c) => c.name.toLowerCase().includes(q)) ||
        p.levels.some(
          (l) =>
            l.name.toLowerCase().includes(q) ||
            l.cohorts.some((c) => c.name.toLowerCase().includes(q)),
        ),
    );
  }, [programs, query]);

  const has = (t: Target) => selected.includes(t);

  const set = (next: Target[]) => {
    setSelected(next);
    if (next.length > 0) setInvalid(false);
  };

  const toggleProgram = (p: ProgramOption) => {
    const t = programTarget(p.id);
    if (has(t)) {
      set(selected.filter((s) => s !== t));
      return;
    }
    // Whole program wins: its level and cohort rows would say the same thing
    // again.
    const inside = [
      ...p.cohorts.map((c) => cohortTarget(c.id)),
      ...p.levels.flatMap((l) => [
        levelTarget(l.id),
        ...l.cohorts.map((c) => cohortTarget(c.id)),
      ]),
    ];
    set([...selected.filter((s) => !inside.includes(s)), t]);
  };

  const toggleLevel = (l: ProgramOption["levels"][number]) => {
    const t = levelTarget(l.id);
    if (has(t)) {
      set(selected.filter((s) => s !== t));
      return;
    }
    // Whole level wins: its cohort rows would say the same thing again.
    const inside = l.cohorts.map((c) => cohortTarget(c.id));
    set([...selected.filter((s) => !inside.includes(s)), t]);
  };

  const toggleCohort = (cohortId: string) => {
    const t = cohortTarget(cohortId);
    set(has(t) ? selected.filter((s) => s !== t) : [...selected, t]);
  };

  const selectAllVisible = () => {
    const wide = visible.map((p) => programTarget(p.id));
    const inside = visible.flatMap((p) => [
      ...p.cohorts.map((c) => cohortTarget(c.id)),
      ...p.levels.flatMap((l) => [
        levelTarget(l.id),
        ...l.cohorts.map((c) => cohortTarget(c.id)),
      ]),
    ]);
    set([...selected.filter((s) => !inside.includes(s) && !wide.includes(s)), ...wide]);
  };

  return (
    <fieldset
      className="relative mt-3"
      aria-describedby={invalid ? errorId : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <legend className="text-sm font-medium text-ink">
          {legend}
          {required && <RequiredMark />}
        </legend>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={selectAllVisible}
            className="relative text-brand transition-colors hover:text-brand-dark max-sm:after:absolute max-sm:after:-inset-x-1.5 max-sm:after:-inset-y-3.5"
          >
            {query ? "Select all shown" : "Select all"}
          </button>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => set([])}
              className="relative text-muted-fg transition-colors hover:text-ink max-sm:after:absolute max-sm:after:-inset-x-1.5 max-sm:after:-inset-y-3.5"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {withSearch && (
        <div className="relative mt-2">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter programs"
            className="pl-9"
          />
        </div>
      )}

      <ul
        className={cn(
          "mt-2 divide-y divide-line/60 rounded-lg border",
          invalid ? "border-danger" : "border-line",
        )}
      >
        {visible.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-fg">
            No program matches “{query.trim()}”.
          </li>
        )}
        {visible.map((p, i) => {
          const wide = has(programTarget(p.id));
          // Everything narrower than the program itself — its levels, and the
          // cohorts under them or directly under it.
          const subdivisions = p.levels.length + p.cohorts.length;
          const open = expanded.includes(p.id);
          return (
            <li key={p.id}>
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                {/* The whole row is the label, 44px tall on a phone, so the
                    16px box is never the only thing to hit. */}
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm text-ink max-sm:min-h-11">
                  <input
                    ref={i === 0 ? firstControlRef : undefined}
                    type="checkbox"
                    checked={wide}
                    onChange={() => toggleProgram(p)}
                    className="h-4 w-4 shrink-0 accent-brand"
                  />
                  <span className="min-w-0 truncate font-medium">{p.name}</span>
                </label>
                {subdivisions > 0 && (
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setExpanded(
                        open
                          ? expanded.filter((id) => id !== p.id)
                          : [...expanded, p.id],
                      )
                    }
                    className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-fg transition-colors hover:bg-canvas hover:text-ink"
                  >
                    {p.levels.length > 0
                      ? `${p.levels.length} level${p.levels.length === 1 ? "" : "s"}`
                      : `${p.cohorts.length} cohort${p.cohorts.length === 1 ? "" : "s"}`}
                    <ChevronDownIcon
                      className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                    />
                  </button>
                )}
              </div>

              {/* Ticking the whole program ticks and locks everything in it. */}
              {open && subdivisions > 0 && (
                <ul className="border-t border-line/60 bg-canvas/60 px-3 py-2">
                  {p.levels.map((l) => {
                    const levelWide = has(levelTarget(l.id));
                    return (
                      <li key={l.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-center gap-2.5 py-1 text-sm max-sm:min-h-11",
                            wide ? "text-muted-fg" : "text-ink",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={wide || levelWide}
                            disabled={wide}
                            onChange={() => toggleLevel(l)}
                            className="h-4 w-4 shrink-0 accent-brand"
                          />
                          <span className="min-w-0">{l.name}</span>
                        </label>
                        {l.cohorts.length > 0 && (
                          <ul className="pl-7">
                            {l.cohorts.map((c) => (
                              <li key={c.id}>
                                <label
                                  className={cn(
                                    "flex cursor-pointer items-center gap-2.5 py-1 text-sm max-sm:min-h-11",
                                    wide || levelWide ? "text-muted-fg" : "text-ink",
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    checked={wide || levelWide || has(cohortTarget(c.id))}
                                    disabled={wide || levelWide}
                                    onChange={() => toggleCohort(c.id)}
                                    className="h-4 w-4 shrink-0 accent-brand"
                                  />
                                  {c.name}
                                </label>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                  {p.cohorts.map((c) => (
                    <li key={c.id}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 py-1 text-sm max-sm:min-h-11",
                          wide ? "text-muted-fg" : "text-ink",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={wide || has(cohortTarget(c.id))}
                          disabled={wide}
                          onChange={() => toggleCohort(c.id)}
                          className="h-4 w-4 shrink-0 accent-brand"
                        />
                        {c.name}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {invalid && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger-ink">
          Pick at least one.
        </p>
      )}

      {selected.map((t) => (
        <input key={t} type="hidden" name="targets" value={t} />
      ))}
      {/*
        The validatable stand-in for the group: one pixel of transparency
        carrying the selection, so an empty required picker is caught here — with
        the error beside the legend and focus on the first checkbox — instead of
        as a generic server error a second later.
      */}
      <input
        type="text"
        value={selected.join(",")}
        required={required}
        onChange={() => {}}
        onInvalid={(e) => {
          e.preventDefault();
          setInvalid(true);
          firstControlRef.current?.focus();
        }}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only pointer-events-none"
      />
    </fieldset>
  );
}
