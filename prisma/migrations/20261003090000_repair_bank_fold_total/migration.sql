-- Repair: hour banks created with "include past hours" had the student's
-- still-unspent mentor grants subtracted from the amount entered AND then
-- folded to zero — the same hours were removed twice. The admin's entered
-- number is the bank's size, so each affected bank gets back what the fold
-- took: the folded grants' unused minutes (their oldMinutes sum minus what
-- had already been logged into the bank at creation).
--
-- Which banks qualify, and why this is safe to re-run:
--   * the bank's own creation change row (mentorId NULL, oldMinutes 0) names
--     the figure it was created at, and we require the bank to STILL hold it —
--     a bank topped up or edited since is left alone for a human;
--   * the fold rows are the burst of oldMinutes > 0 -> newMinutes = 0 change
--     rows written by the same actor in the same seconds;
--   * "already logged" is the fromBank time that existed before the bank row
--     itself did — later draws are real usage and stay usage.

INSERT INTO "HourAllotmentChange" (id, studentId, programId, mentorId, changedById, oldMinutes, newMinutes, createdAt)
SELECT
    'c' || lower(hex(randomblob(12))),
    bank.studentId,
    bank.programId,
    NULL,
    bc.changedById,
    bank.minutes,
    bank.minutes + COALESCE((
        SELECT SUM(f.oldMinutes) FROM "HourAllotmentChange" AS f
        WHERE f.studentId = bank.studentId
          AND f.programId = bank.programId
          AND f.changedById = bc.changedById
          AND f.oldMinutes > 0
          AND f.newMinutes = 0
          AND ABS((julianday(f.createdAt) - julianday(bc.createdAt)) * 86400.0) < 60
    ), 0) - COALESCE((
        SELECT SUM(s.minutes) FROM "Session" AS s
        WHERE s.studentId = bank.studentId
          AND s.programId = bank.programId
          AND s.fromBank = 1
          AND s.withinPlan = 1
          AND s.createdAt <= bank.createdAt
    ), 0),
    CURRENT_TIMESTAMP
FROM "HourAllocation" AS bank
JOIN "HourAllotmentChange" AS bc
  ON bc.studentId = bank.studentId
 AND bc.programId = bank.programId
 AND bc.mentorId IS NULL
 AND bc.oldMinutes = 0
 AND bc.newMinutes = bank.minutes
WHERE bank.isBank = 1
  AND EXISTS (
    SELECT 1 FROM "HourAllotmentChange" AS f
    WHERE f.studentId = bank.studentId
      AND f.programId = bank.programId
      AND f.changedById = bc.changedById
      AND f.oldMinutes > 0
      AND f.newMinutes = 0
      AND ABS((julianday(f.createdAt) - julianday(bc.createdAt)) * 86400.0) < 60
  )
  AND COALESCE((
        SELECT SUM(f.oldMinutes) FROM "HourAllotmentChange" AS f
        WHERE f.studentId = bank.studentId
          AND f.programId = bank.programId
          AND f.changedById = bc.changedById
          AND f.oldMinutes > 0
          AND f.newMinutes = 0
          AND ABS((julianday(f.createdAt) - julianday(bc.createdAt)) * 86400.0) < 60
    ), 0) > COALESCE((
        SELECT SUM(s.minutes) FROM "Session" AS s
        WHERE s.studentId = bank.studentId
          AND s.programId = bank.programId
          AND s.fromBank = 1
          AND s.withinPlan = 1
          AND s.createdAt <= bank.createdAt
    ), 0);

UPDATE "HourAllocation" AS bank
SET minutes = minutes + COALESCE((
        SELECT SUM(f.oldMinutes) FROM "HourAllotmentChange" AS f
        WHERE f.studentId = bank.studentId
          AND f.programId = bank.programId
          AND f.changedById = bc.changedById
          AND f.oldMinutes > 0
          AND f.newMinutes = 0
          AND ABS((julianday(f.createdAt) - julianday(bc.createdAt)) * 86400.0) < 60
    ), 0) - COALESCE((
        SELECT SUM(s.minutes) FROM "Session" AS s
        WHERE s.studentId = bank.studentId
          AND s.programId = bank.programId
          AND s.fromBank = 1
          AND s.withinPlan = 1
          AND s.createdAt <= bank.createdAt
    ), 0)
FROM "HourAllotmentChange" AS bc
WHERE bank.isBank = 1
  AND bank.studentId = bc.studentId
  AND bank.programId = bc.programId
  AND bc.mentorId IS NULL
  AND bc.oldMinutes = 0
  AND bc.newMinutes = bank.minutes
  AND EXISTS (
    SELECT 1 FROM "HourAllotmentChange" AS f
    WHERE f.studentId = bank.studentId
      AND f.programId = bank.programId
      AND f.changedById = bc.changedById
      AND f.oldMinutes > 0
      AND f.newMinutes = 0
      AND ABS((julianday(f.createdAt) - julianday(bc.createdAt)) * 86400.0) < 60
  );
