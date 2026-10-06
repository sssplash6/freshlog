import Link from "next/link";

import { cn } from "@/lib/cn";
import { programTone } from "@/lib/program-tone";

export type ProgramRef = { id: string; name: string; colorIndex: number };

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
  variant = "plain",
  className,
}: {
  program: ProgramRef;
  href?: string;
  /**
   * `tag` sets the dot and name on a small neutral capsule, for a table cell
   * (October 2026, second pass). A bare dot and name in a column of figures
   * read as one more line of grey text; on a capsule it is a value the eye
   * lands on. The capsule is the neutral `fill`, never the program's own
   * tint — a program is still a place and not a face (see above), and its hue
   * stays in the dot.
   */
  variant?: "plain" | "tag";
  className?: string;
}) {
  const body = (linked: boolean) => (
    <>
      <ProgramDot program={program} />
      {/* No resting underline (September 2026 iOS pass): a ruled name in
          every table row was the one piece of print styling left on calm
          pages. A linked program sits in a row or cell that already reads as
          tappable, and the name turns brand on hover and focus. */}
      <span
        className={cn(
          "min-w-0 truncate",
          linked && "transition-colors group-hover:text-brand group-focus-visible:text-brand"
        )}
      >
        {program.name}
      </span>
    </>
  );
  // A tag caps itself at 16rem and truncates (the full name stays in `title`):
  // inside an auto-layout table cell `max-w-full` is no cap at all, so a
  // 90-character program name once pushed the whole roster's right-hand
  // columns out of sight. `cn` does not resolve conflicts, so the two caps
  // are alternatives, never both.
  const classes = cn(
    "inline-flex items-center gap-1.5 text-sm text-ink",
    variant === "tag"
      ? "h-6 max-w-64 rounded-full bg-fill pl-2 pr-2.5 text-xs font-medium"
      : "max-w-full",
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
        programTone(program).badge,
        className
      )}
    />
  );
}
