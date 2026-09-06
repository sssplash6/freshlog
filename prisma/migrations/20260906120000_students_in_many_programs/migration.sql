-- One student, many programs.
--
-- `StudentProfile.programId` was the assumption that a person studies in
-- exactly one program, and it reached further than it looked: it was how an
-- admin's scope decided whether they could see somebody, how a mentor's reach
-- was computed, how the students list filtered, and how every session and every
-- grant was attributed to a program. A student who moved between programs took
-- their whole history with them, and the program they left lost it.
--
-- So the membership becomes its own table, and the three ledger tables plus the
-- allotment audit each learn which program they belong to. The backfill is
-- exact rather than a guess: every existing row has precisely one candidate,
-- the profile's own program.
--
-- Written by hand rather than scaffolded, per the repo convention (see the
-- header of 20260829110000_durations_in_minutes): Prisma's generated
-- redefinition drops the old table before copying out of it in some orders.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- 1. The membership table, and one row per student out of the old column.

CREATE TABLE "StudentEnrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "cohortId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentEnrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentEnrollment_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StudentEnrollment_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StudentEnrollment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- The id is the profile's own id: unique by construction, and it makes the
-- backfill of the four ledger tables below a plain join rather than a lookup
-- table nobody can check afterwards. `createdById` is null — nobody made these
-- rows, the migration did, the same convention as ProgramStaff's backfill.
INSERT INTO "StudentEnrollment" ("id", "studentId", "programId", "cohortId", "createdById", "createdAt")
SELECT "id", "id", "programId", "cohortId", NULL, "createdAt" FROM "StudentProfile";

CREATE UNIQUE INDEX "StudentEnrollment_studentId_programId_key" ON "StudentEnrollment"("studentId", "programId");
CREATE INDEX "StudentEnrollment_programId_idx" ON "StudentEnrollment"("programId");

-- 2. HourAllocation gains its program, and the program joins its unique key:
--    the same mentor may hold time with the same student in two programs.

CREATE TABLE "new_HourAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "mentorId" TEXT,
    "minutes" INTEGER NOT NULL,
    "amountPaid" REAL,
    "deadline" DATETIME NOT NULL,
    "deadlineStage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HourAllocation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HourAllocation_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HourAllocation_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_HourAllocation" ("id", "studentId", "programId", "mentorId", "minutes", "amountPaid", "deadline", "deadlineStage", "createdAt", "updatedAt")
SELECT a."id", a."studentId", p."programId", a."mentorId", a."minutes", a."amountPaid", a."deadline", a."deadlineStage", a."createdAt", a."updatedAt"
FROM "HourAllocation" a JOIN "StudentProfile" p ON p."id" = a."studentId";

DROP TABLE "HourAllocation";
ALTER TABLE "new_HourAllocation" RENAME TO "HourAllocation";
CREATE UNIQUE INDEX "HourAllocation_studentId_programId_mentorId_key" ON "HourAllocation"("studentId", "programId", "mentorId");
CREATE INDEX "HourAllocation_programId_idx" ON "HourAllocation"("programId");

-- 3. Session gains the program the meeting happened in.

CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "minutes" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "attended" BOOLEAN NOT NULL DEFAULT true,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "withinPlan" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Session_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Session_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Session_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Session_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Session" ("id", "studentId", "programId", "mentorId", "assignmentId", "minutes", "date", "attended", "late", "note", "status", "withinPlan", "createdAt", "updatedAt")
SELECT s."id", s."studentId", p."programId", s."mentorId", s."assignmentId", s."minutes", s."date", s."attended", s."late", s."note", s."status", s."withinPlan", s."createdAt", s."updatedAt"
FROM "Session" s JOIN "StudentProfile" p ON p."id" = s."studentId";

DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE INDEX "Session_assignmentId_idx" ON "Session"("assignmentId");
CREATE INDEX "Session_programId_idx" ON "Session"("programId");
CREATE INDEX "Session_studentId_programId_mentorId_idx" ON "Session"("studentId", "programId", "mentorId");

-- 4. Assignment gains the program whose work it is.

CREATE TABLE "new_Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "mentorId" TEXT,
    "purpose" TEXT NOT NULL,
    "minuteLimit" INTEGER,
    "dueNote" TEXT,
    "dueOn" DATETIME,
    "note" TEXT,
    "progress" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "progressManual" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Assignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Assignment" ("id", "studentId", "programId", "mentorId", "purpose", "minuteLimit", "dueNote", "dueOn", "note", "progress", "progressManual", "position", "createdById", "createdAt", "updatedAt")
SELECT a."id", a."studentId", p."programId", a."mentorId", a."purpose", a."minuteLimit", a."dueNote", a."dueOn", a."note", a."progress", a."progressManual", a."position", a."createdById", a."createdAt", a."updatedAt"
FROM "Assignment" a JOIN "StudentProfile" p ON p."id" = a."studentId";

DROP TABLE "Assignment";
ALTER TABLE "new_Assignment" RENAME TO "Assignment";
CREATE INDEX "Assignment_studentId_position_idx" ON "Assignment"("studentId", "position");
CREATE INDEX "Assignment_programId_idx" ON "Assignment"("programId");

-- 5. The allotment audit, so a grant's history names the program it changed.

CREATE TABLE "new_HourAllotmentChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "mentorId" TEXT,
    "changedById" TEXT NOT NULL,
    "oldMinutes" INTEGER NOT NULL,
    "newMinutes" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HourAllotmentChange_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HourAllotmentChange_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HourAllotmentChange_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "HourAllotmentChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_HourAllotmentChange" ("id", "studentId", "programId", "mentorId", "changedById", "oldMinutes", "newMinutes", "createdAt")
SELECT c."id", c."studentId", p."programId", c."mentorId", c."changedById", c."oldMinutes", c."newMinutes", c."createdAt"
FROM "HourAllotmentChange" c JOIN "StudentProfile" p ON p."id" = c."studentId";

DROP TABLE "HourAllotmentChange";
ALTER TABLE "new_HourAllotmentChange" RENAME TO "HourAllotmentChange";

-- 6. Last: the column that carried the assumption leaves StudentProfile.

CREATE TABLE "new_StudentProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "folderUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StudentProfile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_StudentProfile" ("id", "userId", "telegramUsername", "folderUrl", "createdById", "createdAt", "updatedAt")
SELECT "id", "userId", "telegramUsername", "folderUrl", "createdById", "createdAt", "updatedAt" FROM "StudentProfile";

DROP TABLE "StudentProfile";
ALTER TABLE "new_StudentProfile" RENAME TO "StudentProfile";
CREATE UNIQUE INDEX "StudentProfile_userId_key" ON "StudentProfile"("userId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
