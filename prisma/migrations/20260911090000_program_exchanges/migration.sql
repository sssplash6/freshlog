-- One program lends a student to another, for a capped number of hours.
--
-- A mentor in Imkon meets a student who needs seven hours of Global
-- Admissions' help. Until now the only way to arrange it was to enroll the
-- student in Global outright, which says they study there — and hands Global's
-- admins the whole of a student they were asked to help with for an afternoon.
--
-- So the placement is its own row. It names both programs, the ceiling and the
-- use-by date; the host's admin allocates the hours among its own mentors and
-- may allocate no more than the cap. The hours are NEW time, not a transfer:
-- the sending program's own ledger does not move.
--
-- Three nullable columns carry the link into the ledger. `StudentEnrollment`
-- learns that a membership can be a visit; `HourAllocation` and `Session` learn
-- which exchange they spend. Those two are what makes the log readable from
-- BOTH ends: the sending program asks for its own exchange's rows rather than
-- asking about a student inside a program it does not administer.
--
-- Added as plain columns. Nothing is backfilled — every row that exists today
-- is an ordinary enrollment, grant and session, which is what NULL says.

CREATE TABLE "ProgramExchange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "fromProgramId" TEXT NOT NULL,
    "toProgramId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "deadline" DATETIME NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "sentById" TEXT NOT NULL,
    "returnedById" TEXT,
    "returnedAt" DATETIME,
    "returnNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProgramExchange_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProgramExchange_fromProgramId_fkey" FOREIGN KEY ("fromProgramId") REFERENCES "Program" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProgramExchange_toProgramId_fkey" FOREIGN KEY ("toProgramId") REFERENCES "Program" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProgramExchange_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProgramExchange_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ProgramExchange_studentId_idx" ON "ProgramExchange"("studentId");
CREATE INDEX "ProgramExchange_toProgramId_status_idx" ON "ProgramExchange"("toProgramId", "status");
CREATE INDEX "ProgramExchange_fromProgramId_status_idx" ON "ProgramExchange"("fromProgramId", "status");

-- The membership an exchange creates, and the one it is. UNIQUE: an exchange
-- places a student once. Null for every enrollment somebody actually made.
ALTER TABLE "StudentEnrollment" ADD COLUMN "exchangeId" TEXT REFERENCES "ProgramExchange" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "StudentEnrollment_exchangeId_key" ON "StudentEnrollment"("exchangeId");

-- The ledger's two halves learn which exchange they spend.
ALTER TABLE "HourAllocation" ADD COLUMN "exchangeId" TEXT REFERENCES "ProgramExchange" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "HourAllocation_exchangeId_idx" ON "HourAllocation"("exchangeId");

ALTER TABLE "Session" ADD COLUMN "exchangeId" TEXT REFERENCES "ProgramExchange" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Session_exchangeId_idx" ON "Session"("exchangeId");
