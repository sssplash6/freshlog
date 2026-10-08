-- A blank name from Google sign-in was saved as-is and rendered as nothing,
-- since an empty string defeats every fallback to the email address. Null is
-- what "no name yet" means; the next sign-in backfills it from Google.
UPDATE "User" SET "name" = NULL WHERE trim("name") = '';
