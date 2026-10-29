import "server-only";

import { formatBalance, formatDuration } from "@/lib/format";

/**
 * A program's Allocate time, read once for the website
 * (`app/programs/[id]/allocate/page.tsx`) and the freshlog app
 * (`/api/v1/programs/:id/allocate`): moved here from the page, unchanged, so the
 * two can't group a roster differently. The page's comments came with the code
 * they explain.
 */

/** A student as the picker reads them: their figures inside the program. */
type PickerStudent = {
  id: string;
  user: { name: string | null; email: string };
  allottedMinutes: number;
  remainingMinutes: number;
  forfeitedMinutes: number;
};

/** The picker's rows, in its groups, each with what they hold here already. */
export function allocatePicker<S extends PickerStudent>(students: readonly S[]) {
  // The roster in the order an admin reads it: people holding time, people
  // with none behind them, and the two states that need a second look — spent
  // past zero, or a grant that ran out unused. Grouped, because a roster where
  // "-7h" sits in the same unmarked list as "12h remaining" is one a hurried
  // admin allocates from without seeing which kind of row they picked.
  return students
    .map((s) => {
      const overdrawn = s.remainingMinutes < 0;
      const expired = !overdrawn && s.forfeitedMinutes > 0 && s.remainingMinutes === 0;
      // Nothing granted, or everything granted already used: either way there
      // is no time to draw on, which "12h remaining" would not say.
      const none =
        !overdrawn && !expired && (s.allottedMinutes === 0 || s.remainingMinutes <= 0);
      const rank = overdrawn || expired ? 2 : none ? 1 : 0;
      return {
        s,
        rank,
        overdrawn,
        expired,
        option: {
          value: s.id,
          label: s.user.name ?? s.user.email,
          // What they hold here already: the figure an admin is about to
          // change, and the one they check before typing.
          hint: overdrawn
            ? formatBalance(s.remainingMinutes)
            : expired
              ? `${formatDuration(s.forfeitedMinutes)} expired unused`
              : none
                ? s.allottedMinutes === 0
                  ? "No time allocated yet"
                  : "All of it used"
                : `${formatDuration(s.remainingMinutes)} remaining`,
          group:
            rank === 2 ? "Overdrawn or expired" : rank === 1 ? "All time used" : "Has time",
          tone: overdrawn ? ("danger" as const) : expired ? ("warn" as const) : undefined,
        },
      };
    })
    .sort(
      (a, b) =>
        a.rank - b.rank || a.option.label.localeCompare(b.option.label)
    );
}

/** What the page says under the picker of somebody overdrawn or with time that expired, in two parts: the lead is bold. */
export function allocateWarning(
  chosen: PickerStudent,
  row: { overdrawn: boolean },
  programName: string
): { lead: string; rest: string } {
  return {
    lead: `${chosen.user.name ?? chosen.user.email} ${
      row.overdrawn
        ? `is already ${formatBalance(chosen.remainingMinutes)} in ${programName}.`
        : `has ${formatDuration(chosen.forfeitedMinutes)} that expired unused in ${programName}.`
    }`,
    rest: "Time granted now is added to that balance.",
  };
}
