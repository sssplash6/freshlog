-- Work a mentor gives a student to go away and do, and the student's own
-- statement of how far along it is.
--
-- The plan half of the ledger already had a table — `Assignment` — and this is
-- deliberately not it. An Assignment is the AGENDA: the piece of work an admin
-- budgets hours for, that a session is logged against, measured in minutes
-- somebody else delivers. Nobody but staff has ever written to it, and putting
-- a student-writable `percent` on it would have put a student's hand on the row
-- an admin's hour budget hangs off.
--
-- A task carries no minutes and no budget, no session may be logged against it,
-- and the only person who can say how far along it is is the student.
--
-- `dueOn` is NOT NULL, unlike the agenda's two optional due halves: a task is
-- given at a meeting to be done before the next one, and "sometime" is a
-- suggestion rather than a task. `mentorId` is NOT NULL for the same kind of
-- reason — `Assignment.mentorId` is nullable because an admin budgets work
-- before choosing who does it, and there is no equivalent state here.
--
-- Nothing is backfilled. Every task there has ever been is an Assignment, and
-- an Assignment is not one of these.

CREATE TABLE "StudentTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "dueOn" DATETIME NOT NULL,
    "percent" INTEGER NOT NULL DEFAULT 0,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudentTask_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentTask_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StudentTask_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The student's own list, in the order their home reads it.
CREATE INDEX "StudentTask_studentId_dueOn_idx" ON "StudentTask"("studentId", "dueOn");
CREATE INDEX "StudentTask_programId_idx" ON "StudentTask"("programId");
CREATE INDEX "StudentTask_mentorId_idx" ON "StudentTask"("mentorId");
