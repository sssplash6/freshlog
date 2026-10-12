import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { EXPIRY_WINDOW_DAYS, GLYPH, type Severity, type Status } from "@/lib/status";
import { daysAway } from "@/lib/when";

/**
 * One chip, for every state in the product.
 *
 * What it replaces was five tones named after colours — green, amber, red,
 * gray, violet — chosen at the call site, which is how "Booking link set" ended
 * up the same green as "Done" and a mentor's identity chip ended up the same
 * amber as "No-show". A caller can no longer pick a colour: it picks a SEVERITY,
 * and severity picks the colour.
 *
 * Two shapes:
 *
 *   <StatusChip status={s} />                        the destination
 *   <StatusChip severity="attention">Pending</…>     while a page still derives
 *                                                    its own labels
 *
 * The second exists because the label and the severity migrate at different
 * times: a page can stop choosing colours today, and start reading its wording
 * from `lib/status.ts` when that page is reshaped. Every remaining use of the
 * second form is a page that has not been through the reorganisation yet.
 */
const SURFACE: Record<Severity, string> = {
  // Grey is the absence of a signal, so it carries no glyph — a fact does not
  // need to announce itself, and "○" on every "Extra" chip is just noise.
  // The control fill, not the page ground: on a dark theme the ground is
  // black, and a chip painted in it read as a hole in the card.
  neutral: "bg-fill text-muted-fg",
  ok: "bg-fill text-ink",
  attention: "bg-warn-soft text-warn-ink",
  problem: "bg-danger-soft text-danger-ink",
};

/** Grey has no colour to be alone with, so only the coloured states need one. */
const SHOWS_GLYPH: Record<Severity, boolean> = {
  neutral: false,
  ok: true,
  attention: true,
  problem: true,
};

type Props = {
  className?: string;
  /** Override the glyph — progress states use ○ and ◐ as shapes, not signals. */
  glyph?: string;
} & (
  | { status: Status; severity?: never; children?: never }
  | { status?: never; severity: Severity; children: React.ReactNode }
);

export function StatusChip({ className, glyph, ...rest }: Props) {
  const severity = rest.status ? rest.status.severity : rest.severity;
  const body = rest.status ? rest.status.label : rest.children;
  const mark = glyph ?? (SHOWS_GLYPH[severity] ? GLYPH[severity] : null);


  return (
    <span
      // Deliberately wrappable. The old chip was `whitespace-nowrap` while
      // carrying sentences like "Rescheduled, no time charged", so a narrow
      // column could not break it and the row grew sideways instead.
      className={cn(
        "inline-flex items-baseline gap-1 rounded-full px-2.5 py-[0.1875rem] text-xs font-medium tracking-normal",
        SURFACE[severity],
        className
      )}
      title={rest.status?.explanation}
    >
      {mark && (
        <span aria-hidden="true" className="font-semibold leading-none">
          {mark}
        </span>
      )}
      <span>{body}</span>
      {/* `title` reaches only a hovering pointer. The explanation is the
          status's own words, so it is spoken rather than lost — invisible,
          and comma-paused from the label. */}
      {rest.status?.explanation && (
        <span className="sr-only">, {rest.status.explanation}</span>
      )}
    </span>
  );
}

/**
 * An allocation's use-by date, and how much of it is left.
 *
 * This is the only date in the product that DESTROYS something when it passes:
 * unused hours are forfeited and no further session may be logged against them.
 * It rendered as plain inherited text in a column of ordinary dates, in the
 * same weight as "Last session" beside it — the one value on the row with a
 * consequence, drawn like the one without. So it takes three states now:
 *
 *   past      red, and it says so
 *   soon      amber, with the countdown, because "Sep 30" does not tell anybody
 *             on the 24th that they have six days to book
 *   ahead     ink and medium — quiet, but never the muted grey of a value
 *             nobody has to act on
 *
 * Still not a chip: this sits in a column of dates, and a chip among dates
 * reads as a different kind of value. Weight and colour carry it instead.
 *
 * `now` is a prop rather than a call to the clock: this used to read
 * `Date.now()` while rendering, which made the answer depend on the moment a
 * component happened to paint and put an impure call inside a render pass. The
 * page computes `now` once and hands the same instant to every row, so a table
 * cannot disagree with itself.
 */
export function DeadlineText({
  deadline,
  now,
  within = EXPIRY_WINDOW_DAYS.staff,
  className,
}: {
  deadline: Date | null;
  now: Date;
  /**
   * How many days ahead counts as soon. Defaults to the staff window, and a
   * page passes `EXPIRY_WINDOW_DAYS[audience]` when it knows whose table this
   * is — a student is warned a month out, a mentor a week.
   */
  within?: number;
  className?: string;
}) {
  if (!deadline) return <span className="text-muted-fg">—</span>;
  const expired = deadline.getTime() < now.getTime();
  const days = daysAway(deadline, now);
  const soon = !expired && days <= within;

  return (
    <span
      className={cn(
        "whitespace-nowrap",
        expired
          ? "font-semibold text-danger-ink"
          : soon
            ? "font-semibold text-warn-ink"
            // An ordinary date is context, at the row's regular weight;
            // only the two warnings above step out of it.
            : "text-ink",
        className
      )}
    >
      {formatDate(deadline)}
      {expired
        ? " · expired"
        : soon
          ? ` · ${
              days <= 0
                ? "today"
                : days === 1
                  ? "tomorrow"
                  : `${days} days`
            }`
          : ""}
    </span>
  );
}
