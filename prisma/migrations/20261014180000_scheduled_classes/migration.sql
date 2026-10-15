-- Scheduled classes: a mentor puts a dated class in the diary for a student,
-- reserved out of the hours that student holds with them, and the month's
-- total per student is read from the table.
--
-- An ADD COLUMN with a constant default and one new table, so nothing existing
-- changes. `schedulesClasses` is off by default: it is the SAT department's
-- feature: switched on for the SAT programs at the bottom of this file, and for
-- no other program unless a platform admin turns it on in its settings.

ALTER TABLE "Program" ADD COLUMN "schedulesClasses" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ScheduledClass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "minutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "topic" TEXT,
    "sessionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduledClass_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduledClass_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduledClass_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduledClass_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ScheduledClass_sessionId_key" ON "ScheduledClass"("sessionId");
CREATE INDEX "ScheduledClass_programId_startsAt_idx" ON "ScheduledClass"("programId", "startsAt");
CREATE INDEX "ScheduledClass_studentId_programId_mentorId_idx" ON "ScheduledClass"("studentId", "programId", "mentorId");
CREATE INDEX "ScheduledClass_mentorId_startsAt_idx" ON "ScheduledClass"("mentorId", "startsAt");

-- Switched on once, by name, for the two SAT programs it was asked for. From
-- here the setting is what decides — renaming a program does not switch it off
-- — and no other program has it until a platform admin turns it on.
UPDATE "Program" SET "schedulesClasses" = true WHERE "name" IN ('SAT Individuals', 'SAT group');
