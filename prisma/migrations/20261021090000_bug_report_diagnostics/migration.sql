-- What a report drawn on the screen carries besides its picture: the window
-- it was drawn in, the theme, the browser, the deployed commit, and how many
-- marks were made. All nullable, so every existing report reads as "not
-- recorded" and nothing is rewritten.
ALTER TABLE "BugReport" ADD COLUMN "viewport" TEXT;
ALTER TABLE "BugReport" ADD COLUMN "theme" TEXT;
ALTER TABLE "BugReport" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "BugReport" ADD COLUMN "build" TEXT;
ALTER TABLE "BugReport" ADD COLUMN "marks" INTEGER;
