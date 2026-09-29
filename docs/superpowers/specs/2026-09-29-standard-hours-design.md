# Standard hours per program — design

Date: 2026-09-29
Status: implemented

## Why

The Research Institute runs several levels (Beginner, Advanced, …). Each level
is its own program in freshlog, and what mostly tells the levels apart is how
many mentor hours a student gets. Today every hour is granted by hand, one
student at a time (`setMentorAllocation`), so "Beginner students get 10 hours"
has to be remembered and re-typed for every student.

A program should be able to say "every student who joins gets N hours, to use
within D days", and freshlog should grant it.

## Decisions (made with the owner)

| Question | Decision |
|---|---|
| What is a level | A program. No new "level" or "department" concept. |
| Where the hours go | The student's unassigned pool in that program (mentor null), exactly as an admin grant with no mentor. An admin assigns a mentor afterwards, as today. |
| Deadline | A number of days after the student joins the program, per student. |
| Changing the standard | Affects students who join afterwards only. Existing students are never touched. |
| Existing programs | Off. Nothing changes until an admin sets a standard. |
| Exchanges | Never. A visitor's minutes are capped by the sending program. |
| Hour-bank programs | The standard opens the student's hour bank (`isBank`) instead of filling the pool, since every meeting there draws the bank and time beside it would never be spent. |

## Data (one migration)

`Program` gains two nullable columns:

- `standardMinutes Int?` — the grant, in minutes (the schema's unit).
- `standardDays Int?` — how many days the student has to use it.

Both set, or both null. Null means off. Enforced by the action that writes
them; nothing else writes them.

## Setting it — `/programs/[id]/settings`

A **Standard hours** form in the existing **Program** section, beside the
payment toggle. Two fields: **Minutes** (parsed with `parseMinutesField`; every
time field in the app takes whole minutes) and **Use within (days)**, a whole
number 1–1095. Both
empty turns it off. One field empty and the other filled is refused with a
sentence.

New action `setProgramStandardHours(prev, formData)` in
`src/lib/actions/programs.ts`, gated with `assertProgramScope` on the program
(the same gate as `setProgramTracksPayment`). Minutes must be at least 1 when set.
The section caption says it applies to students who join from now on.

## Granting it

One helper, `grantStandardHours(tx, { studentId, programId, actorId })`, in
`src/lib/standard-hours.ts`, called inside the transaction that creates the
membership. It:

1. Reads the program's `standardMinutes` / `standardDays`. Either null → return.
2. Returns if the student already holds any `HourAllocation` in that program
   (any mentor, including the pool).
3. Creates the pool allocation: `mentorId: null`, `minutes: standardMinutes`,
   `deadline: programToday() + standardDays` as a date at 00:00Z (the same
   shape `parseDateField` produces).
4. Writes a `HourAllotmentChange` (`oldMinutes 0 → standardMinutes`,
   `changedById: actorId`).
5. Notifies the student (`HOURS_GRANTED`, `studentHome()`), worded like the
   existing grant: "You were granted 10h in Research – Beginner. They must be
   used by …".

A pure function `standardDeadline(today: string, days: number): Date` holds
the date arithmetic, so it can be tested without a database.

### Where it is called

| Path | Action | Actor credited |
|---|---|---|
| Staff add students | `createStudents` | the admin |
| A student joins another level | `enrollStudent` | the admin |
| A self sign-up is approved | `approveStudent`, once per own (non-exchange) enrollment | the approving admin |
| A mis-enrollment is corrected | `moveStudent` (step 2 makes it a no-op if they already hold hours there) | the admin |

Not called from `completeOnboarding` (the student is still PENDING; the grant
waits for approval so the clock starts when they are let in) nor from
`sendOnExchange`.

The action's own success message mentions the grant when one was made
("… added to Research – Beginner with 10h to use by …").

## Rules (AGENTS.md)

- The allocation, change row and notification all carry `programId`. Nothing
  keys on `studentId:mentorId`.
- A helper call in one program never reads or writes another program's rows.
- Gates are unchanged: each calling action already gates on the target program.

## Testing

`src/lib/standard-hours.test.ts` (Vitest, `prisma/test.db`):

- `standardDeadline` adds days across a month end.
- off (nulls) → no rows; set → one pool allocation, one change row, one
  notification, correct deadline.
- student already holding hours in the program → nothing.
- hours in a *different* program don't count as "already holding".

Action tests:

- `createStudents`, `enrollStudent`, `approveStudent`, `moveStudent` each grant
  once into a program with a standard, and nothing into one without.
- `sendOnExchange` into a program with a standard grants nothing.
- `setProgramStandardHours`: sets, clears, refuses half-filled / zero / >1095
  days, refused for an admin of another program.

End to end (`verify` skill): set 10h / 90 days on a program, add a student,
see 10h unassigned with the right date on the student page and on the
student's own home, and in History.

## Out of scope

- A department grouping above programs.
- Several standard grants per program, or a standard mentor.
- Re-applying a changed standard to existing students.
