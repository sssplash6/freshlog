<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Gate every page, not just its layout

Next renders a layout and its page **in parallel**. A redirect thrown by a
layout does not stop the page beneath it from running its queries and
streaming the result — so a gate that lives only in the layout is not a gate.

Until 3 September 2026 a request carrying any non-empty session cookie —
expired, signed with a rotated secret, or plain garbage — got HTTP 200, a
redirect to `/login`, and the entire student roster with their email addresses
in the payload.

So: every page function calls its own gate, on its first line, before any
query. `getCurrentUser` is request-cached, so the second call is free.

The gates live in `src/lib/dal.ts` (`requireUser`, `requireStaff`,
`requireAdminAccess`, `requireProgramScope`, `requireMentor`); the questions
they ask live in `src/lib/authz.ts`. A gate that has to load a row before it
can decide — "is this student in a program I administer?" — fetches the row
first and gates second, and answers "not yours" and "does not exist"
identically, so the error cannot be used to enumerate what exists.

## A student's program is a set, not a column

`StudentProfile.programId` is gone. A student holds `StudentEnrollment` rows —
one per program — because Global Admissions and then the Master's Program is the
ordinary path through this school, and a single column could only say it by
rewriting history.

So the ledger says which program it belongs to. `HourAllocation`, `Session`,
`Assignment` and `HourAllotmentChange` each carry a `programId`, and an
allocation is unique on `(studentId, programId, mentorId)`: the same mentor may
hold separate time with the same student in two programs, with two deadlines and
two balances.

Three rules follow, and breaking any of them is silent:

1. **Reaching a student is not reading them.** `canManageStudent` is an overlap
   — any one of their programs is yours. `studentScope` is the narrower answer
   every page then filters by. An admin of one program who opens a two-program
   student must see one program's hours, tasks, sessions and grants, and not the
   other's name either.
2. **Ask the row, not the student.** A session, a grant and a task each name a
   program; reach one through `student.enrollments` and you have asked a
   question with two answers. Only `Interview` and `MentorFeedback` genuinely
   have no program, and they go through the enrollments on purpose.
3. **Never key a total on `studentId:mentorId`.** Forfeiture, draw-down and the
   deadline reminders all key on `(student, program, mentor)`. A key without the
   program spends one program's hours out of another program's grant.

## A visit is not an enrollment

One program may lend a student to another for a capped number of minutes —
Imkon sends somebody to Global Admissions for seven hours. `ProgramExchange`
is the placement; the membership it creates in the host program carries
`StudentEnrollment.exchangeId`, and that is the only thing that tells a visit
from an enrollment.

It adds no ledger. The allocations and sessions live in the HOST program, keyed
the way the section above requires, and carry `exchangeId` so the SENDING
program can read exactly those rows — the one place a program sees inside
another's ledger, and the reason it is a column rather than a query about a
student in a program you do not administer.

Four rules, and breaking any of them is silent:

1. **The cap is the sender's.** `setMentorAllocation` refuses a grant that
   would take the total under an exchange past `minutes`, or date one past the
   placement's own deadline — checked again inside the transaction, where a
   second admin's concurrent grant is finally visible.
2. **Hours are new, never moved.** The sending program's own figures do not
   change when it lends somebody out. A figure that appeared in both programs'
   totals would be the same hour counted twice.
3. **Only their own programs lend.** A student already visiting cannot be lent
   onward, cannot be moved, and cannot be unenrolled — `returnExchange` is the
   way out, and it is refused once an hour has been logged.
4. **Say it is a visit, wherever a membership is named.** `enrollmentLabel`
   appends "(on exchange)", the rosters mark it, and `studiesIn()` is how you
   ask for a student's own programs.

## Every commit writes its changelog entry

`CHANGELOG.md` at the repo root is what users read on `/changelog`. It ships
with the code, so an entry goes live exactly when its change does — Render
deploys are manual, and a note posted anywhere else would announce work nobody
can see yet.

So: every commit that changes what a user sees or can do adds its entry to
`CHANGELOG.md` **in the same commit**. Not a follow-up commit, not "at release".
Commits with no user-visible effect — tests, refactors, dependency pins,
tooling — add nothing.

- Entries sit under a dated heading, newest first: `## 2026-10-02`. A second
  commit on the same day adds to that day's heading rather than opening another.
- Under the date, `### New` and `### Fixed`; leave out whichever is empty.
- One short paragraph or bullet per change, written for the student, mentor or
  admin who will read it: what they can now do, or what no longer goes wrong.
  No file names, no function names, no commit-message prose.
