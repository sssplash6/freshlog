import Link from "next/link";

import { cn } from "@/lib/cn";
import { programTone } from "@/lib/program-tone";

export type ProgramRef = { id: string; name: string };

/**
 * A program, wherever one is named as a value on a row.
 *
 * The name alone was doing this job, and doing it badly the moment a student
 * could be enrolled twice: two rows, one person, and the only thing telling
 * them apart was a word in the fourth column that the reader had to actually
 * read. A dot is found without reading.
 *
 * A DOT and the name, deliberately — not the tinted pill a person wears.
 * `REDESIGN.md` §5.6.5's instinct is right that a program is a place rather
 * than a face, and a place does not get a badge with initials in it; it gets a
 * mark on the map. The dot also lets the label sit inside a dense table cell
 * without a second tinted rectangle appearing next to the person's.
 */
export function ProgramChip({
  program,
  href,
  className,
}: {
  program: ProgramRef;
  href?: string;
  className?: string;
}) {
  const body = (linked: boolean) => (
    <>
      <ProgramDot program={program} />
      {/* The underline is on the NAME, not the anchor: an anchor-wide rule
          draws a line under the dot and the gap beside it, which reads as a
          strikethrough on a 2px circle. Resting grey rather than hover-only —
          this is the way into the program, and a link nobody can see until
          they hover is a link a reader has to guess at. */}
      <span
        className={cn(
          "min-w-0 truncate",
          linked &&
            "underline decoration-line decoration-1 underline-offset-4 transition-colors group-hover:decoration-brand"
        )}
      >
        {program.name}
      </span>
    </>
  );
  const classes = cn(
    "inline-flex max-w-full items-center gap-1.5 text-sm text-ink",
    href && "group transition-colors hover:text-brand",
    className
  );

  if (href) {
    return (
      <Link href={href} title={program.name} transitionTypes={["nav-forward"]} className={classes}>
        {body(true)}
      </Link>
    );
  }
  return (
    <span title={program.name} className={classes}>
      {body(false)}
    </span>
  );
}

/**
 * The mark on its own, for a place that already says the name — a page title,
 * a tab, a row whose program is stated elsewhere on the line.
 */
export function ProgramDot({
  program,
  className,
}: {
  program: ProgramRef;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        programTone(program.id).badge,
        className
      )}
    />
  );
}
