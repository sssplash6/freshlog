/**
 * Table sorting, in the URL.
 *
 * Headers looked sortable — a row of column labels above a list of forty
 * students — and did nothing, so the only way to find the soonest deadline was
 * to read every row. Clicking one now sets `?sort=&dir=` and the page re-reads
 * itself, which is the same shape every other filter in this app already has:
 * it survives a refresh, it can be linked to somebody, and it needs no client
 * state to be correct.
 *
 * The comparator is here rather than at each table because the two rules that
 * matter are easy to get wrong per call site:
 *
 * ABSENT SORTS LAST, IN BOTH DIRECTIONS. A student with no use-by date has not
 * got the earliest one. Ordering by deadline ascending must not open with six
 * rows that have no deadline at all, and flipping to descending must not put
 * them at the top either — they are not the latest either. They are simply not
 * in the ordering, so they go after everyone who is.
 *
 * NAMES COMPARE AS PEOPLE READ THEM. `localeCompare` with `sensitivity: "base"`
 * so "alisher" and "Alisher" are not two different places in the list, and the
 * roster of Uzbek and Russian names this app actually holds sorts the way the
 * team expects rather than by code point.
 */

export type SortDir = "asc" | "desc";
export type Sort<K extends string> = { key: K; dir: SortDir };

/** What a row can be ordered by. `null`/`undefined` mean "absent" — see above. */
export type SortValue = string | number | Date | null | undefined;

/**
 * The sort the URL is asking for, or null for the page's own default order.
 *
 * `allowed` is the whitelist, so a hand-edited `?sort=` cannot reach a field
 * the table does not show — an ordering is a read of data the reader may not be
 * entitled to, and a table sorted by something invisible is unreadable anyway.
 */
export function readSort<K extends string>(
  params: { sort?: string; dir?: string },
  allowed: readonly K[]
): Sort<K> | null {
  const key = params.sort as K | undefined;
  if (!key || !allowed.includes(key)) return null;
  return { key, dir: params.dir === "desc" ? "desc" : "asc" };
}

function compare(a: SortValue, b: SortValue): number {
  const aMissing = a == null || a === "";
  const bMissing = b == null || b === "";
  // Absent is not a value. It never participates in the ordering, so the
  // caller's direction is deliberately not consulted here.
  if (aMissing || bMissing) return aMissing && bMissing ? 0 : aMissing ? 1 : -1;

  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

/**
 * A copy of `rows` in the asked-for order, or the array untouched when the URL
 * is not asking for one.
 *
 * `values` maps a key to what that column shows. It is per table rather than
 * per row so a column can sort on something other than the string it renders —
 * "Use by" sorts on the Date behind "September 30 · 6 days".
 */
export function applySort<T, K extends string>(
  rows: readonly T[],
  sort: Sort<K> | null,
  values: Record<K, (row: T) => SortValue>
): T[] {
  if (!sort) return [...rows];
  const get = values[sort.key];
  if (!get) return [...rows];
  const sign = sort.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    const absent = av == null || av === "" || bv == null || bv === "";
    // The missing rows keep their place at the bottom whichever way the rest
    // is pointing, so `sign` is applied only to a real comparison.
    return absent ? compare(av, bv) : sign * compare(av, bv);
  });
}
