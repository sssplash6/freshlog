-- The student a practice interview's partner marked absent (hostId or guestId).
-- Null for every interview that happened or has not yet.
ALTER TABLE "PeerInterview" ADD COLUMN "absentId" TEXT;
