-- University applications: a snapshot of scores, the motivational essay's
-- stage, and each student's list of universities with a supplemental essay
-- each, for the programs that switch `tracksAdmissions` on.
--
-- An ADD COLUMN with a constant default and three new tables, so nothing
-- existing changes. Full Support is switched on here, once, by name, because
-- it is the program this was built for; from now on the setting is what
-- decides, and renaming the program does not switch it off.

ALTER TABLE "Program" ADD COLUMN "tracksAdmissions" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Program" SET "tracksAdmissions" = true WHERE "name" = 'Full Support';

CREATE TABLE "StudentApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "sat" INTEGER,
    "ielts" REAL,
    "school" TEXT,
    "gpa" TEXT,
    "essayStage" TEXT,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudentApplication_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentApplication_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "University" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "supplementalWords" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "University_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "StudentUniversity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "round" TEXT,
    "essayStage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentUniversity_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentUniversity_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StudentApplication_studentId_key" ON "StudentApplication"("studentId");
CREATE UNIQUE INDEX "University_nameKey_key" ON "University"("nameKey");
CREATE UNIQUE INDEX "StudentUniversity_studentId_universityId_key" ON "StudentUniversity"("studentId", "universityId");
