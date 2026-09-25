-- Students practise interviews on each other.
--
-- A student offers times (`InterviewSlot`); a classmate who shares one of their
-- own programs books one and picks a template (`PeerInterview`). Neither table
-- touches the ledger: no hours, no mentor, no program column. This is not the
-- mentor's meeting that 20260915090000_drop_interviews removed — it is two
-- students rehearsing, and only they read these rows.

CREATE TABLE "InterviewSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "minutes" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InterviewSlot_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PeerInterview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slotId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "completedAt" DATETIME,
    "hostNotes" TEXT,
    "guestNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PeerInterview_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "InterviewSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PeerInterview_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PeerInterview_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InterviewSlot_studentId_startsAt_key" ON "InterviewSlot"("studentId", "startsAt");
CREATE INDEX "InterviewSlot_startsAt_idx" ON "InterviewSlot"("startsAt");
CREATE UNIQUE INDEX "PeerInterview_slotId_key" ON "PeerInterview"("slotId");
CREATE INDEX "PeerInterview_hostId_idx" ON "PeerInterview"("hostId");
CREATE INDEX "PeerInterview_guestId_idx" ON "PeerInterview"("guestId");
