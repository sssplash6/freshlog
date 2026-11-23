-- When somebody first signed in. Null until they do.
ALTER TABLE "User" ADD COLUMN "firstSignInAt" DATETIME;

-- Signed in before this was recorded: the day they were added stands in.
-- The evidence is every trace a sign-in leaves: a Google id (recorded since
-- 13 October 2026), an app token, a Telegram handle (set at a student's first
-- sign-in, the "Not signed in" chip's own test), or a self-signup's account,
-- which a sign-in created.
UPDATE "User" SET "firstSignInAt" = "createdAt"
WHERE "googleId" IS NOT NULL
   OR "status" IN ('PENDING', 'UNASSIGNED')
   OR "id" IN (SELECT "userId" FROM "ApiToken")
   OR "id" IN (SELECT "userId" FROM "StudentProfile" WHERE "telegramUsername" IS NOT NULL);
