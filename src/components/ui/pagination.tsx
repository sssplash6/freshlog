import Link from "next/link";

import { cn } from "@/lib/cn";
import { PAGE_PARAMS, filterHref, readParam, type SearchParams } from "@/lib/filters";

/** Every list page here shows the same slice size, so paging feels uniform. */
export const PAGE_SIZE = 25;

/** 1-based page number from a query string, clamped to something sane. */
export function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 1 ? Math.min(n, 10_000) : 1;
}

/**
 * Build a href for another page of the same list, carrying every other filter
 * along — dropping the ones that are empty so a shared link stays readable.
 *
 * The query string is `filterHref`'s to build, not this file's: it was the
 * second of two hand-rolled answers to "what happens to the other params", and
 * the two disagreed about repeated params and about trimming. What is left
 * here is the one thing paging means that filtering does not — `filterHref`
 * drops every page param, which is right when a filter changes and wrong when
 * a page does, because `/admin/feedback` pages two lists on one route and
 * stepping through one of them must not send the other back to its start.
 */
export function pageHref(
  basePath: string,
  params: SearchParams,
  page: number,
  param = "page",
): string {
  const changes: Record<string, string | undefined> = {};
  for (const key of PAGE_PARAMS) {
    if (key !== param) changes[key] = readParam(params, key);
  }
  changes[param] = page > 1 ? String(page) : undefined;
  return filterHref(basePath, params, changes);
}

/**
 * The page numbers worth drawing: the first, the last, and the current one
 * with a neighbour either side; `null` is a gap ("…"). Seven pages or fewer
 * are all shown.
 */
export function pageWindow(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, page - 1, page, page + 1]);
  const out: (number | null)[] = [];
  let last = 0;
  for (let n = 1; n <= pages; n++) {
    if (!keep.has(n)) continue;
    if (n - last > 1) out.push(null);
    out.push(n);
    last = n;
  }
  return out;
}

/**
 * Numbered paging with the slice stated in words.
 *
 * These lists were unbounded: every mentor, every session, every piece of
 * feedback ever written, read into memory and rendered in full. That is fine
 * with a seed database and quietly ruinous a year in, so each list now asks for
 * one page at a time and says where it is. Links, not buttons, so a page is
 * shareable and the back button behaves.
 */
export function Pagination({
  basePath,
  params,
  page,
  pageSize = PAGE_SIZE,
  total,
  unit,
  param = "page",
  note,
  compact = false,
  className,
}: {
  /** Page numbers only, with no "1–3 of 7 meetings · page 1 of 3" beside them. */
  compact?: boolean;
  basePath: string;
  /** The page's own `searchParams`. Hand it the whole object: anything left
      out of it is a filter that vanishes on page two. */
  params: SearchParams;
  page: number;
  pageSize?: number;
  total: number;
  /** What is being counted, plural: "sessions", "mentors". */
  unit: string;
  /** Query key for the page number, for pages that paginate two lists. */
  param?: string;
  /** Said after the count, for rows in the total that are not what `unit` names. */
  note?: string;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  // `rel` is passed, not inferred from the label. It used to be read back out
  // of the words — `label === "Newer" || label === "Previous"` — so renaming a
  // button silently reversed what it told a crawler and a screen reader about
  // which way it went, and "Newer" had already been renamed away.
  //
  // Grey fills, the secondary button's shape: a pager is the quietest control
  // on a list, and the bordered boxes it used to be were the only outlined
  // buttons left in the app.
  const step = (
    to: number,
    label: string,
    rel: "prev" | "next",
    disabled: boolean,
    name: string,
  ) =>
    disabled ? (
      <span
        aria-disabled="true"
        aria-label={name}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-fill text-base text-disabled sm:min-h-8 sm:min-w-8"
      >
        {label}
      </span>
    ) : (
      <Link
        href={pageHref(basePath, params, to, param)}
        rel={rel}
        aria-label={name}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-fill text-base text-brand transition-colors hover:bg-fill-strong sm:min-h-8 sm:min-w-8"
      >
        {label}
      </Link>
    );

  return (
    <nav
      aria-label={`${unit} pages`}
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2",
        className,
      )}
    >
      <p
        className={cn("text-xs tabular-nums text-muted-fg", compact && "sr-only")}
        aria-live="polite"
      >
        {total <= pageSize ? (
          <>
            {total} {total === 1 ? unit.replace(/s$/, "") : unit}
            {note ? ` · ${note}` : ""}
          </>
        ) : (
          <>
            {first}–{last} of {total} {unit}
            {note ? ` · ${note}` : ""} · page {page} of {pages}
          </>
        )}
      </p>
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {step(page - 1, "‹", "prev", page <= 1, "Previous page")}
          {/* Numbered, the way a search result is: the reader can jump to page
              three, and sees how many there are, instead of stepping one at a
              time and being told "page 2 of 5" in grey type. */}
          {pageWindow(page, pages).map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-xs text-muted-fg">
                …
              </span>
            ) : n === page ? (
              <span
                key={n}
                aria-current="page"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-brand text-xs font-semibold tabular-nums text-on-brand sm:min-h-8 sm:min-w-8"
              >
                {n}
              </span>
            ) : (
              <Link
                key={n}
                href={pageHref(basePath, params, n, param)}
                aria-label={`Page ${n}`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-fill text-xs font-medium tabular-nums text-brand transition-colors hover:bg-fill-strong sm:min-h-8 sm:min-w-8"
              >
                {n}
              </Link>
            ),
          )}
          {step(page + 1, "›", "next", page >= pages, "Next page")}
        </div>
      )}
    </nav>
  );
}
