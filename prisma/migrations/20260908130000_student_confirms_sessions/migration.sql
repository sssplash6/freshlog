-- The student's answer to the session a mentor logged.
-- null = not answered; "CONFIRMED" = it happened; "DISPUTED" = something is wrong.
-- No balance moves either way: a dispute is a flag for a human to correct,
-- never an automatic reversal.
ALTER TABLE "Session" ADD COLUMN "studentAnswer" TEXT;
ALTER TABLE "Session" ADD COLUMN "studentAnsweredAt" DATETIME;
ALTER TABLE "Session" ADD COLUMN "studentRating" INTEGER;
ALTER TABLE "Session" ADD COLUMN "studentNote" TEXT;

-- Every session logged before this existed is unanswered, which is what null
-- already says. No backfill: pretending they were confirmed would be inventing
-- an answer nobody gave.
