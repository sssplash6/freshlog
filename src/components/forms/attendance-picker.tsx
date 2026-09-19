import { SegmentedRadio } from "@/components/ui/segmented";
import { ATTENDANCE, ATTENDANCE_META } from "@/lib/constants";

const ORDER: string[] = [
  ATTENDANCE.ATTENDED,
  ATTENDANCE.LATE,
  ATTENDANCE.ABSENT,
  ATTENDANCE.RESCHEDULED,
];

/**
 * What kind of meeting this was — asked once, answered four ways, because the
 * four are mutually exclusive and each means something different for the hours.
 *
 * Four labels and nothing else. Each used to carry a sentence underneath
 * saying what it cost, and the owner cut them: a mentor logs sessions every
 * week, and a line that is on screen every week is a line nobody reads. What
 * each state did to the hours is said on the logged row afterwards, where it
 * is a fact rather than a warning.
 *
 * A thin wrapper: `SegmentedRadio` owns the shape and the 44px target, so this
 * file is only the question and its four answers.
 */
export function AttendancePicker({
  defaultValue,
  compact,
}: {
  defaultValue?: string;
  /** Tighter type, for the correction popover. */
  compact?: boolean;
}) {
  return (
    <SegmentedRadio
      name="attendance"
      legend="How did it go?"
      required
      dense={compact}
      columns={2}
      defaultValue={defaultValue}
      options={ORDER.map((state) => ({
        value: state,
        label: ATTENDANCE_META[state].label,
      }))}
    />
  );
}
