import { cn } from "@/lib/cn";

/**
 * One number, with its label.
 *
 * Replaces 57 hand-assembled `StatCard`s across ten files, whose real problem
 * was not the component but the habit: nine pages opened with a strip of four
 * to seven equally-weighted figures, so the eye had to read all of them to find
 * the one that mattered. PRODUCT.md's first anti-reference is "stat-tile grids".
 *
 * Two rules the design depends on:
 *
 * ONE `lead` PER PAGE. The lead is the figure the page exists to show — hours
 * remaining, on a page about a balance. Everything else is `normal` and
 * quieter. A strip where every number is the same size has no hierarchy, which
 * is the same as having no lead at all.
 *
 * `hours` IS THE ONLY COLOURED TONE, and it is the orange that means hours
 * throughout the app. It is deliberately restricted to figures of 24px and up:
 * the text orange (#a35200) is 5.6:1 on white, so it also passes at small sizes,
 * but a big coloured number is what makes it read as "hours" rather than a flag.
 */
const TONE = {
  ink: "text-ink",
  hours: "text-accent-ink",
  danger: "text-danger-ink",
  muted: "text-muted-fg",
} as const;

/* The type scale's figure steps (globals.css), each carrying its own
   tracking. `normal` was Tailwind's 30px, a size the scale does not have — one
   of five secondary-figure sizes an audit found across the app (October 2026). */
const SIZE = {
  lead: "text-lead",
  normal: "text-figure-lg",
  /** Inside a table cell or a sentence, where a 28px figure would shout. */
  inline: "text-body",
} as const;

export function Figure({
  label,
  value,
  suffix,
  tone = "ink",
  size = "normal",
  className,
}: {
  label?: string;
  value: string;
  /** A unit the value does not already carry. Durations carry their own. */
  suffix?: string;
  tone?: keyof typeof TONE;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <div className={className}>
      <div
        className={cn(
          // 600, not 700: bold is the large title's weight, and a figure that
          // matches it competes with the one heading the page has.
          "font-semibold leading-none tabular-nums",
          SIZE[size],
          // Small orange text fails contrast, so the tone quietly declines
          // below the size it is legible at rather than shipping a grey-on-white
          // figure a reader has to squint at.
          tone === "hours" && size === "inline" ? TONE.ink : TONE[tone]
        )}
      >
        {value}
        {suffix && (
          // The literal space matters: `ml-1` separates them on screen but not
          // in the accessibility tree, where "4h 30mleft across 1 student" is
          // what a screen reader reads out.
          <>
            {" "}
            <span className="text-body font-semibold tracking-normal text-muted-fg">
              {suffix}
            </span>
          </>
        )}
      </div>
      {label && (
        <div className="mt-2 text-xs text-muted-fg">
          {label}
        </div>
      )}
    </div>
  );
}

/**
 * The figures as one quiet strip between hairlines — never a row of tiles.
 *
 * `framed={false}` drops the rules for a strip that sits INSIDE a Section whose
 * own dividers already separate it. Framed is the default: on the page ground
 * the rules are what stop the numbers floating.
 */
export function FigureRow({
  children,
  framed = true,
  className,
}: {
  children: React.ReactNode;
  framed?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-x-12 gap-y-3 py-2.5",
        framed && "border-y border-line px-1",
        className
      )}
    >
      {children}
    </div>
  );
}
