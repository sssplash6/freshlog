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
 * EIGHT SLOTS, STORED (October 2026). The hue used to be a hash of the id over
 * four tones, which put two of five programs on one colour by arithmetic — and
 * analytics, which cannot stack two programs in one colour, quietly re-dealt
 * its own, so a program was slate on /programs and grey on /analytics. Now a
 * program is given a slot when it is created (`pickColorIndex`) and keeps it in
 * `Program.colorIndex`: the same colour on every page, and no two live programs
 * share one until there are more than eight.
 *
 * The hues sit clear of amber and red, which `DESIGN.md` reserves for status,
 * and of orange, which means hours — so a program can never be mistaken for a
 * warning. Values and their contrast checks are in `globals.css`.
 *
 * Class strings are written out in full: Tailwind only generates utilities it
 * can see in source, so `bg-prog-${hue}-soft` would compile to nothing.
 */

export const PROGRAM_HUES = [
  "indigo",
  "sky",
  "teal",
  "green",
  "magenta",
  "violet",
  "olive",
  "cyan",
] as const;

export const PROGRAM_SLOTS = PROGRAM_HUES.length;

const TONES: PersonTone[] = [
  {
    chip: "bg-prog-indigo-soft text-prog-indigo-ink",
    badge: "bg-prog-indigo-dot",
    ink: "text-prog-indigo-ink",
    ring: "ring-prog-indigo-dot",
  },
  {
    chip: "bg-prog-sky-soft text-prog-sky-ink",
    badge: "bg-prog-sky-dot",
    ink: "text-prog-sky-ink",
    ring: "ring-prog-sky-dot",
  },
  {
    chip: "bg-prog-teal-soft text-prog-teal-ink",
    badge: "bg-prog-teal-dot",
    ink: "text-prog-teal-ink",
    ring: "ring-prog-teal-dot",
  },
  {
    chip: "bg-prog-green-soft text-prog-green-ink",
    badge: "bg-prog-green-dot",
    ink: "text-prog-green-ink",
    ring: "ring-prog-green-dot",
  },
  {
    chip: "bg-prog-magenta-soft text-prog-magenta-ink",
    badge: "bg-prog-magenta-dot",
    ink: "text-prog-magenta-ink",
    ring: "ring-prog-magenta-dot",
  },
  {
    chip: "bg-prog-violet-soft text-prog-violet-ink",
    badge: "bg-prog-violet-dot",
    ink: "text-prog-violet-ink",
    ring: "ring-prog-violet-dot",
  },
  {
    chip: "bg-prog-olive-soft text-prog-olive-ink",
    badge: "bg-prog-olive-dot",
    ink: "text-prog-olive-ink",
    ring: "ring-prog-olive-dot",
  },
  {
    chip: "bg-prog-cyan-soft text-prog-cyan-ink",
    badge: "bg-prog-cyan-dot",
    ink: "text-prog-cyan-ink",
    ring: "ring-prog-cyan-dot",
  },
];

/** What a program needs to say which colour it is. */
export type ProgramToneRef = { id: string; colorIndex: number };

/** The slot as stored, folded into range — a hand-edited row can't crash a page. */
export function programSlot(program: ProgramToneRef): number {
  const i = Math.trunc(program.colorIndex);
  return Number.isFinite(i) ? ((i % PROGRAM_SLOTS) + PROGRAM_SLOTS) % PROGRAM_SLOTS : 0;
}

export function programTone(program: ProgramToneRef): PersonTone {
  return TONES[programSlot(program)];
}

/** The dot's colour as a CSS value, for an SVG path or an inline style. */
export function programColorVar(program: ProgramToneRef): string {
  return `var(--color-prog-${PROGRAM_HUES[programSlot(program)]}-dot)`;
}

/**
 * The slot a NEW program takes, given the slots the programs already in use
 * hold: the first one nobody holds, and once all eight are held, the one held
 * by the fewest (lowest slot on a tie). Pure, so it is tested without a DB.
 */
export function nextColorIndex(held: readonly number[]): number {
  const counts = new Array<number>(PROGRAM_SLOTS).fill(0);
  for (const raw of held) {
    const i = Math.trunc(raw);
    if (Number.isFinite(i)) counts[((i % PROGRAM_SLOTS) + PROGRAM_SLOTS) % PROGRAM_SLOTS]++;
  }
  let best = 0;
  for (let i = 1; i < PROGRAM_SLOTS; i++) {
    if (counts[i] < counts[best]) best = i;
  }
  return best;
}
