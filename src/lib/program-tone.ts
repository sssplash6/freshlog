import type { PersonTone } from "@/lib/person-tone";

/**
 * A stable hue per program, so Master's is the same colour in every table, on
 * every page, for every reader.
 *
 * `REDESIGN.md` §5.6.5 said programs have no hue — "a program is a place, not a
 * person" — and that rule was right about the thing it was actually banning:
 * the monogram cards and gradient washes the redesign deleted. It was wrong
 * about the need. A student is now enrolled in several programs at once, so a
 * roster shows one name on two rows, a mentor holds separate time in two, and
 * "which program is this row" is a question the reader asks on nearly every
 * screen and answers by re-reading a word.
 *
 * So the hue exists, and it is a DOT and a label. Never a tinted card, never a
 * wash, never a monogram — the shape of the thing is what the old rule was
 * protecting, and that survives intact.
 *
 * FOUR hues, at 246 / 192 / 282 / 215, chosen to sit clear of two neighbours
 * that matter: the three person tones (160 / 306 / 79), so a chip's hue cannot
 * be read as "a person" where it means "a place"; and amber and red, which
 * `DESIGN.md` reserves for status, so a program can never be mistaken for a
 * warning. Derived from the id like `personTone`, so nobody has to pick
 * colours and a program created today looks the same tomorrow.
 *
 * Class strings are written out in full: Tailwind only generates utilities it
 * can see in source, so `bg-prog-${hue}-soft` would compile to nothing.
 */

const TONES: PersonTone[] = [
  {
    chip: "bg-prog-indigo-soft text-prog-indigo-ink",
    badge: "bg-prog-indigo-dot",
    ink: "text-prog-indigo-ink",
    ring: "ring-prog-indigo-dot",
  },
  {
    chip: "bg-prog-cyan-soft text-prog-cyan-ink",
    badge: "bg-prog-cyan-dot",
    ink: "text-prog-cyan-ink",
    ring: "ring-prog-cyan-dot",
  },
  {
    chip: "bg-prog-violet-soft text-prog-violet-ink",
    badge: "bg-prog-violet-dot",
    ink: "text-prog-violet-ink",
    ring: "ring-prog-violet-dot",
  },
  {
    chip: "bg-prog-slate-soft text-prog-slate-ink",
    badge: "bg-prog-slate-dot",
    ink: "text-prog-slate-ink",
    ring: "ring-prog-slate-dot",
  },
];

/** FNV-1a, the same spread `person-tone.ts` uses on cuids sharing a prefix. */
function hashIndex(id: string, buckets: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash) % buckets;
}

export function programTone(id: string): PersonTone {
  return TONES[hashIndex(id, TONES.length)];
}
