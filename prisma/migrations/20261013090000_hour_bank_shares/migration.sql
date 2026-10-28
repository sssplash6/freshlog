-- An admin may hand part of a student's hour bank to a mentor. The share is an
-- ordinary mentor allocation that remembers it came out of the bank, so cutting
-- or removing it puts the minutes back.
--
-- One ADD COLUMN with a constant default, so nothing existing changes: no row
-- is a share until an admin makes one.

ALTER TABLE "HourAllocation" ADD COLUMN "fromBankShare" BOOLEAN NOT NULL DEFAULT false;
