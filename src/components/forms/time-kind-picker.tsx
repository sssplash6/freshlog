import { SegmentedRadio } from "@/components/ui/segmented";
import { TIME_KIND, TIME_KIND_META } from "@/lib/constants";

const ORDER: string[] = [TIME_KIND.PLAN, TIME_KIND.EXTRA];

/**
 * Two words a segment can hold. The full labels — "Counts toward their time",
 * "Extra, beyond their time" — wrapped to two lines inside a 44px pill on a
 * phone and lost the second line; the legend already asks "Whose hours?", so
 * the answer only has to name one.
 */
const SHORT: Record<string, string> = {
  [TIME_KIND.PLAN]: "Their time",
  [TIME_KIND.EXTRA]: "Extra",
};

/**
 * Whose hours these are — the student's allocation, or the mentor's own time
 * given on top of it. Asked beside attendance and shaped identically, because
 * they are two halves of one thought: what happened, and what it costs.
 *
 * In-plan leads and is the default: nearly every meeting spends allocated
 * hours, and a mentor who never touches this control should still get the
 * ordinary answer.
 *
 * Two labels and nothing else — see `attendance-picker.tsx` for why the
 * sentence that sat under the chosen one is gone.
 */
export function TimeKindPicker({
  defaultValue,
  compact,
}: {
  defaultValue?: string;
  /** Tighter type, for the correction popover. */
  compact?: boolean;
}) {
  return (
    <SegmentedRadio
      name="timeKind"
      legend="Whose hours?"
      required
      dense={compact}
      // The same full-width, equal-cell track as the attendance picker above
      // it. Sized to its labels it was a narrower control of a different
      // shape under a wider one — two answers to one thought that did not
      // look related.
      columns={2}
      defaultValue={defaultValue}
      options={ORDER.map((kind) => ({
        value: kind,
        label: SHORT[kind] ?? TIME_KIND_META[kind].label,
      }))}
    />
  );
}
