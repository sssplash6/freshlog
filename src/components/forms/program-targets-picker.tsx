"use client";

import { useMemo, useRef, useState } from "react";

import { ChevronDownIcon, SearchIcon } from "@/components/icons";
import { fieldChrome } from "@/components/ui/field";
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

function labelFor(programs: ProgramOption[], target: Target): string | null {
  for (const p of programs) {
    if (target === programTarget(p.id)) {
      return p.levels.length > 0
        ? `${p.name} · all levels`
        : p.cohorts.length > 0
          ? `${p.name} · all cohorts`
          : p.name;
    }
    for (const l of p.levels) {
      if (target === levelTarget(l.id)) return `${p.name} / ${l.name}`;
      const nested = l.cohorts.find((c) => cohortTarget(c.id) === target);
      if (nested) return `${p.name} / ${l.name} / ${nested.name}`;
    }
    const cohort = p.cohorts.find((c) => cohortTarget(c.id) === target);
    if (cohort) return `${p.name} / ${cohort.name}`;
  }
  return null;
}

/**
 * Which programs (or single cohorts within them) a mentor works in.
 *
 * This used to be every program and every cohort as one flat wrapping row of
 * checkboxes, which stops working the moment the roster grows: nothing said
 * which cohort belonged to which program, and what was already assigned could
 * only be read by hunting for ticks. So: the selection is stated as chips at the
 * top, each program is its own row, and cohorts stay folded away until someone
 * actually needs to narrow a mentor down to one.
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

  const remove = (t: Target) => set(selected.filter((s) => s !== t));

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

      {/* What is selected, stated plainly — reading ticks off a long list is
          not the same as being told. */}
      <div className="mt-1.5 flex min-h-8 flex-wrap items-center gap-1.5">
        {selected.length === 0 ? (
          // A required picker must not say that picking nothing is fine: the
          // asterisk and "the mentor stays unassigned" contradicted each other.
          <span className="text-xs text-muted-fg">
            {required
              ? "Pick at least one program."
              : "Nothing selected yet — the mentor stays unassigned."}
          </span>
        ) : (
          selected.map((t) => {
            const label = labelFor(programs, t);
            if (!label) return null;
            return (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-[0.1875rem] pl-2.5 pr-1 text-xs font-medium text-brand"
              >
                {label}
                <button
                  type="button"
                  onClick={() => remove(t)}
                  aria-label={`Remove ${label}`}
                  // 20px drawn, 44px to a thumb: the pseudo-element is the
                  // target on a phone, so the chip itself stays small.
                  className="relative flex h-5 w-5 items-center justify-center rounded-full text-brand/70 transition-colors hover:bg-brand/10 hover:text-brand max-sm:after:absolute max-sm:after:-inset-3"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    aria-hidden="true"
                    className="h-3 w-3"
                  >
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </span>
            );
          })
        )}
      </div>

      {withSearch && (
        <div className={cn(fieldChrome, "mt-2 flex items-center gap-2 px-3 focus-within:border-brand focus-within:bg-surface")}>
          <SearchIcon className="h-4 w-4 shrink-0 text-muted-fg" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter programs"
            placeholder="Filter programs and cohorts…"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted-fg focus:outline-none"
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
          const subdivisions =
            p.levels.length +
            p.cohorts.length;
          const chosen =
            p.cohorts.filter((c) => has(cohortTarget(c.id))).length +
            p.levels.filter((l) => has(levelTarget(l.id))).length +
            p.levels.reduce(
              (n, l) => n + l.cohorts.filter((c) => has(cohortTarget(c.id))).length,
              0,
            );
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
                  <span className="min-w-0">
                    <span className="block min-w-0 truncate font-medium">{p.name}</span>
                    {subdivisions > 0 && (
                      <span className="block text-xs text-muted-fg">
                        {wide
                          ? "Everything in it, including what is added later"
                          : chosen > 0
                            ? `${chosen} of ${subdivisions} inside`
                            : "Entire program"}
                      </span>
                    )}
                  </span>
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

              {open && subdivisions > 0 && (
                <ul className="border-t border-line/60 bg-canvas/60 px-3 py-2">
                  {wide && (
                    <li className="pb-1.5 text-xs text-muted-fg">
                      The whole program is assigned, so single levels or
                      cohorts add nothing. Untick it to pick inside instead.
                    </li>
                  )}
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
                          <span className="min-w-0">
                            {l.name}
                            {l.cohorts.length > 0 && (
                              <span className="block text-xs text-muted-fg">
                                {levelWide || wide
                                  ? `All ${l.cohorts.length} cohort${l.cohorts.length === 1 ? "" : "s"}`
                                  : `${l.cohorts.length} cohort${l.cohorts.length === 1 ? "" : "s"}`}
                              </span>
                            )}
                          </span>
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
          Pick at least one program, level or cohort.
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
        className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
      />
    </fieldset>
  );
}
