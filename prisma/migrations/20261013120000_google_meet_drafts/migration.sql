-- Meetings held on Google Meet arrive as drafts the mentor confirms.
--
-- Additive only: a nullable column and two new tables. No existing row
-- changes, and nothing appears until a mentor connects Google.

ALTER TABLE "User" ADD COLUMN "googleId" TEXT;
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

CREATE TABLE "GoogleConnection" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "googleEmail" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" DATETIME,
    "failedAt" DATETIME,
    "lastError" TEXT,
    CONSTRAINT "GoogleConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MeetDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mentorId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "programId" TEXT,
    "eventId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "date" DATETIME NOT NULL,
    "minutes" INTEGER NOT NULL,
    "attendance" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeetDraft_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetDraft_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MeetDraft_mentorId_eventId_studentId_key" ON "MeetDraft"("mentorId", "eventId", "studentId");
CREATE INDEX "MeetDraft_mentorId_date_idx" ON "MeetDraft"("mentorId", "date");
