-- What somebody had read of the changelog when they last opened it: a JSON map
-- of entry date to bullet count. Null for everyone until they open it.

ALTER TABLE "User" ADD COLUMN "changelogSeen" TEXT;
