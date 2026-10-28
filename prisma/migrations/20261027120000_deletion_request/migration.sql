-- When somebody asked, in the app, for their account to be deleted. Null for
-- everyone until they do.
ALTER TABLE "User" ADD COLUMN "deletionRequestedAt" DATETIME;
