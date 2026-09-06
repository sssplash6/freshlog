<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
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
