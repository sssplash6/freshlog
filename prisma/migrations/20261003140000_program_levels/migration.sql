-- CreateTable
CREATE TABLE "ProgramLevel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "standardMinutes" INTEGER,
    "standardDays" INTEGER,
    CONSTRAINT "ProgramLevel_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "Cohort" ADD COLUMN "levelId" TEXT REFERENCES "ProgramLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "StudentEnrollment" ADD COLUMN "levelId" TEXT REFERENCES "ProgramLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "MentorAssignment" ADD COLUMN "levelId" TEXT REFERENCES "ProgramLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "ProgramLevel_programId_name_key" ON "ProgramLevel"("programId", "name");

-- CreateIndex
CREATE INDEX "StudentEnrollment_levelId_idx" ON "StudentEnrollment"("levelId");

-- RedefineIndex: the pairing key now includes the level it names.
DROP INDEX "MentorAssignment_mentorId_programId_cohortId_key";
CREATE UNIQUE INDEX "MentorAssignment_mentorId_programId_cohortId_levelId_key" ON "MentorAssignment"("mentorId", "programId", "cohortId", "levelId");

-- RedefineIndex: a cohort's name is unique within its LEVEL now, so "Fall
-- 2026" under Emerging and under Advanced are two intakes, not a collision.
DROP INDEX "Cohort_programId_name_key";
CREATE UNIQUE INDEX "Cohort_programId_levelId_name_key" ON "Cohort"("programId", "levelId", "name");
