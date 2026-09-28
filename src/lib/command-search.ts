/**
 * The command palette's shapes and its two pure decisions: which "Go to" rows a
 * query keeps, and in what order a page of people is shown.
 *
 * Prisma-free on purpose. The palette is a client component and imports this
 * file; the route that answers it (`app/api/search`) imports it too, so the
 * wire format has one definition and the ranking can be tested without a
 * database.
 */

/** A person as the palette shows them. `programs` is already scoped to the reader. */
export type SearchPerson = {
  /** What the person's page is addressed by: the profile id for a student, the user id for a mentor. */
  id: string;
  /** The account, which is what a profile picture is keyed on. */
  userId: string;
  name: string | null;
  email: string;
  avatarUpdatedAt: string | null;
  /** Program names the reader may see this person in, visits marked "(on exchange)". */
  programs: string[];
};

export type SearchResults = {
  students: SearchPerson[];
  mentors: SearchPerson[];
};

/** How many of each kind the palette lists. More than this is a job for the roster's own search. */
export const SEARCH_LIMIT = 8;

/** Longer than any name or address anyone types; a bound so a URL cannot carry a novel. */
export const SEARCH_MAX_LENGTH = 100;

/** The query as the server will use it — trimmed, bounded, or null when there is nothing to ask. */
export function normalizeQuery(raw: string | null | undefined): string | null {
  const q = (raw ?? "").trim().slice(0, SEARCH_MAX_LENGTH);
  return q.length > 0 ? q : null;
}

/**
 * How well one piece of text answers a query: 0 is the text starting with it,
 * 1 a word inside it starting with it, 2 anywhere else, and null not at all.
 *
 * The database already answered "contains"; this only orders what it returned.
 * Typing "az" should put Aziza above Nazarbek, because the reader typing a
 * name types it from the front.
 */
function matchTier(text: string, q: string): number | null {
  const t = text.toLowerCase();
  const i = t.indexOf(q);
  if (i < 0) return null;
  if (i === 0) return 0;
  return /[\s.@_-]/.test(t[i - 1]) ? 1 : 2;
}

/**
 * People in the order the palette lists them: the best tier across name and
 * email first, then alphabetically — and at most `limit` of them.
 *
 * Stable within a tier, so the database's own name order survives for people
 * who match equally well.
 */
export function rankPeople<T extends { name: string | null; email: string }>(
  people: readonly T[],
  query: string,
  limit = SEARCH_LIMIT
): T[] {
  const q = query.trim().toLowerCase();
  const scored = people.map((p, index) => {
    const tiers = [p.name ? matchTier(p.name, q) : null, matchTier(p.email, q)]
      .filter((t): t is number => t !== null);
    return { p, index, tier: tiers.length > 0 ? Math.min(...tiers) : 3 };
  });
  scored.sort((a, b) => a.tier - b.tier || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.p);
}

/**
 * The "Go to" rows a query keeps.
 *
 * Nothing typed keeps them all — the palette opened empty is a list of places.
 * Otherwise a label is kept when any of its words starts with the query, so
 * "st" finds Students and "ses" finds Sessions, but "e" does not light up every
 * label with an e in it.
 */
export function matchNav<T extends { label: string }>(
  items: readonly T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => {
    const label = item.label.toLowerCase();
    return label.startsWith(q) || label.split(/\s+/).some((w) => w.startsWith(q));
  });
}
