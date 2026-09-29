-- A program's standard grant: the minutes every student who joins it is given,
-- and how many days they have to use them. Both null (off) for every existing
-- program, so nothing changes until an admin sets one.

ALTER TABLE "Program" ADD COLUMN "standardMinutes" INTEGER;
ALTER TABLE "Program" ADD COLUMN "standardDays" INTEGER;
