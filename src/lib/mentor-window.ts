import { readDateWindow, readParam, type DateWindow, type SearchParams } from "@/lib/filters";
import { formatDate } from "@/lib/format";

/**
 * The range a mentor's delivery figures are read through.
 *
 * The page used to offer three windows and nothing else. This reads the same
 * `period` / `from` / `to` parameters the sessions page does — through the same
 * parser, so a backwards range is swapped, `2026-02-31` is not March 3, and the
 * last day is included — and adds the one thing that page does not have: a
 * DEFAULT. No range at all means the last ninety days, because a lifetime total
 * only ever grows and says nothing about whether this mentor is delivering now.
 *
 * The default also covers a range the reader typed wrongly. The shared parser
 * answers "all time" for a window with no usable bounds, which would put a
 * lifetime total under a label nobody chose; "all time" here is something the
 * reader asks for with `period=all`, and only that.
 *
 * `label` always names the days. "Last 30 days" alone cannot be checked against
 * a pay period; "last 30 days (Sep 3 – Oct 2)" can, and the page this replaced
 * was withdrawn once for producing a range nobody could verify.
 */
export type MentorWindow = {
  from?: Date;
  to?: Date;
  kind: "all" | "custom" | NonNullable<DateWindow["preset"]>;
  /** Reads inside "Completed · …". */
  label: string;
  /** What the two date fields show — only ever what was typed. */
  fromValue: string;
  toValue: string;
};

/** The days, as a reader would say them. Both ends are program-local days. */
function span(from?: Date, to?: Date): string {
  if (from && to) {
    const start = formatDate(from);
    const end = formatDate(to);
    return start === end ? start : `${start} – ${end}`;
  }
  return from ? `from ${formatDate(from)}` : `until ${formatDate(to!)}`;
}

function fromPreset(w: DateWindow): MentorWindow {
  return {
    from: w.from,
    to: w.to,
    kind: w.preset!,
    label: `${w.label.replace(/^the /, "")} (${span(w.from, w.to)})`,
    fromValue: "",
    toValue: "",
  };
}

export function mentorWindow(params: SearchParams, now: Date): MentorWindow {
  const w = readDateWindow(params, now);
  if (w.custom) {
    return {
      from: w.from,
      to: w.to,
      kind: "custom",
      label: span(w.from, w.to),
      fromValue: w.fromValue,
      toValue: w.toValue,
    };
  }
  if (w.preset) return fromPreset(w);
  if (readParam(params, "period") === "all") {
    return { kind: "all", label: "all time", fromValue: "", toValue: "" };
  }
  return fromPreset(readDateWindow({ period: "90d" }, now));
}
