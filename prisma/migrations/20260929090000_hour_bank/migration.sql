-- The hour bank: one balance per student per program that every mentor's
-- meeting draws down, for the programs that switch it on.
--
-- Three ADD COLUMNs with constant defaults, so nothing existing changes: no
-- program has the bank on, no allocation is a bank, no session draws one.
-- Full Support and the Master's Program are switched on from their settings.

ALTER TABLE "Program" ADD COLUMN "hourBank" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HourAllocation" ADD COLUMN "isBank" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Session" ADD COLUMN "fromBank" BOOLEAN NOT NULL DEFAULT false;
