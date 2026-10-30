-- The side a person with two last switched to ("admin" or "mentor"), kept on
-- the account so the website and the phone share it. Null until they switch.
ALTER TABLE "User" ADD COLUMN "profile" TEXT;
