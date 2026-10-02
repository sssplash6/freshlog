-- When somebody last opened /changelog. Null for everyone until they do.

ALTER TABLE "User" ADD COLUMN "changelogSeenAt" DATETIME;
