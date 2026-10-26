-- Practice interviews belong to USERS, not student profiles, so that a mentor
-- (who has no profile) can be one side of one. Every existing row names
-- students, and each profile id is rewritten to that student's user id —
-- including `absentId`, which names one of the two sides.
--
-- `InterviewSlot.asMentor` is the capacity a time was offered in, and
-- `PeerInterview.mentorId` the side that is a mentor. Both start false/null:
-- every interview so far was between two students.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InterviewSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "asMentor" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" DATETIME NOT NULL,
    "minutes" INTEGER NOT NULL,
    "meetingUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InterviewSlot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_InterviewSlot" ("createdAt", "id", "meetingUrl", "minutes", "startsAt", "userId") SELECT "createdAt", "id", "meetingUrl", "minutes", "startsAt", (SELECT "userId" FROM "StudentProfile" WHERE "StudentProfile"."id" = "InterviewSlot"."studentId") FROM "InterviewSlot";
DROP TABLE "InterviewSlot";
ALTER TABLE "new_InterviewSlot" RENAME TO "InterviewSlot";
CREATE INDEX "InterviewSlot_startsAt_idx" ON "InterviewSlot"("startsAt");
CREATE UNIQUE INDEX "InterviewSlot_userId_startsAt_key" ON "InterviewSlot"("userId", "startsAt");
CREATE TABLE "new_PeerInterview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slotId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "mentorId" TEXT,
    "template" TEXT NOT NULL,
    "completedAt" DATETIME,
    "absentId" TEXT,
    "hostNotes" TEXT,
    "guestNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PeerInterview_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "InterviewSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PeerInterview_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PeerInterview_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PeerInterview" ("absentId", "completedAt", "createdAt", "guestId", "guestNotes", "hostId", "hostNotes", "id", "slotId", "template", "updatedAt") SELECT (SELECT "userId" FROM "StudentProfile" WHERE "StudentProfile"."id" = "PeerInterview"."absentId"), "completedAt", "createdAt", (SELECT "userId" FROM "StudentProfile" WHERE "StudentProfile"."id" = "PeerInterview"."guestId"), "guestNotes", (SELECT "userId" FROM "StudentProfile" WHERE "StudentProfile"."id" = "PeerInterview"."hostId"), "hostNotes", "id", "slotId", "template", "updatedAt" FROM "PeerInterview";
DROP TABLE "PeerInterview";
ALTER TABLE "new_PeerInterview" RENAME TO "PeerInterview";
CREATE UNIQUE INDEX "PeerInterview_slotId_key" ON "PeerInterview"("slotId");
CREATE INDEX "PeerInterview_hostId_idx" ON "PeerInterview"("hostId");
CREATE INDEX "PeerInterview_guestId_idx" ON "PeerInterview"("guestId");
CREATE TABLE "new_InterviewAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "interviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionIndex" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterviewAnswer_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "PeerInterview" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterviewAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_InterviewAnswer" ("createdAt", "id", "interviewId", "question", "questionIndex", "text", "updatedAt", "userId") SELECT "createdAt", "id", "interviewId", "question", "questionIndex", "text", "updatedAt", (SELECT "userId" FROM "StudentProfile" WHERE "StudentProfile"."id" = "InterviewAnswer"."studentId") FROM "InterviewAnswer";
DROP TABLE "InterviewAnswer";
ALTER TABLE "new_InterviewAnswer" RENAME TO "InterviewAnswer";
CREATE UNIQUE INDEX "InterviewAnswer_interviewId_userId_questionIndex_key" ON "InterviewAnswer"("interviewId", "userId", "questionIndex");
CREATE TABLE "new_InterviewFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "interviewId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "summary" TEXT,
    "wentWell" TEXT,
    "toImprove" TEXT,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterviewFeedback_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "PeerInterview" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterviewFeedback_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_InterviewFeedback" ("createdAt", "fromId", "id", "interviewId", "submittedAt", "summary", "toImprove", "updatedAt", "wentWell") SELECT "createdAt", (SELECT "userId" FROM "StudentProfile" WHERE "StudentProfile"."id" = "InterviewFeedback"."fromId"), "id", "interviewId", "submittedAt", "summary", "toImprove", "updatedAt", "wentWell" FROM "InterviewFeedback";
DROP TABLE "InterviewFeedback";
ALTER TABLE "new_InterviewFeedback" RENAME TO "InterviewFeedback";
CREATE UNIQUE INDEX "InterviewFeedback_interviewId_fromId_key" ON "InterviewFeedback"("interviewId", "fromId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

