-- Archiving a student or a mentor who has left. The account's `status` becomes
-- ARCHIVED (a string column, so it needs no change here); these two columns
-- record when it happened and who did it. Nothing else about the person is
-- touched, so nothing else has to migrate.
ALTER TABLE "User" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "archivedById" TEXT;
