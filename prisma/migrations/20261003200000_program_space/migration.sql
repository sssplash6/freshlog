-- A program may be presented as an institute of its own to the people who
-- work only in it. Presentation only: nothing in the ledger reads these.
ALTER TABLE "Program" ADD COLUMN "space" TEXT NOT NULL DEFAULT 'PROGRAM';
ALTER TABLE "Program" ADD COLUMN "spaceName" TEXT;
