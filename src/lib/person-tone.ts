/**
 * A stable identity colour per person, so the same mentor is the same colour in
 * every table on every page. Derived from their id rather than stored: nobody
 * has to pick colours, and a mentor added today looks the same tomorrow.
 *
 * THREE hues, down from eight. Eight was not merely loud — it was ambiguous:
 * a mentor's chip could be the same amber as a "no-show" chip and the same
 * violet as an "in progress" chip, so a reader could not tell whether a colour
 * meant a person or a problem. Three hues that appear nowhere else in the
 * palette can only mean a person. They repeat past three people, which is the
 * accepted cost: the initials and the name disambiguate, the colour only has to
 * make a column trackable.
 *
 * Class strings are written out in full because Tailwind only generates
 * utilities it can see in source — a template like `bg-tone-${hue}-soft` would
 * compile to nothing.
 */

export type PersonTone = {
  /** Tinted background + matching text, for the chip body. */
  chip: string;
  /** Saturated fill for the initials badge (white text sits on it). */
  badge: string;
  /** Same hue as text alone, for use on an untinted surface. */
  ink: string;
  /** Ring colour, so a PHOTO can still carry the person's identity hue. */
  ring: string;
};

const TONES: PersonTone[] = [
  {
    chip: "bg-tone-teal-soft text-tone-teal-ink",
    badge: "bg-tone-teal-dot",
    ink: "text-tone-teal-ink",
    ring: "ring-tone-teal-dot",
  },
  {
    chip: "bg-tone-plum-soft text-tone-plum-ink",
    badge: "bg-tone-plum-dot",
    ink: "text-tone-plum-ink",
    ring: "ring-tone-plum-dot",
  },
  {
    chip: "bg-tone-moss-soft text-tone-moss-ink",
    badge: "bg-tone-moss-dot",
    ink: "text-tone-moss-ink",
    ring: "ring-tone-moss-dot",
  },
];

/** FNV-1a, for a well-spread index off ids that share long prefixes (cuid). */
function hashIndex(id: string, buckets: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash) % buckets;
}

export function personTone(id: string): PersonTone {
  return TONES[hashIndex(id, TONES.length)];
}

/**
 * Up to two letters standing in for a name: first and last word, so
 * "Global Admissions Program" reads GP and "Master's Program" MP.
 */
export function monogramOf(text: string): string {
  // Letters and digits only: "Malika Vahobova (Scholars)" was "M(".
  const words = text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Up to two initials: "Sharofiddin Aliyev" → "SA", "Valera" → "VA". Falls back
 * to the email's first letters so a mentor who hasn't set a name still gets a
 * badge rather than an empty circle.
 */
export function initials(name: string | null, email: string): string {
  return monogramOf(name?.trim() || email.split("@")[0].replace(/[._-]+/g, " "));
}
