-- Programs that log their hours as classes. One ADD COLUMN with a constant
-- default, so nothing existing changes: no program is on.

ALTER TABLE "Program" ADD COLUMN "classHours" BOOLEAN NOT NULL DEFAULT false;
