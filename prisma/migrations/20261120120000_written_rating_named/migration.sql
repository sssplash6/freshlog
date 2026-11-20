-- A written rating is anonymous to the mentor it is about. From 20 November
-- 2026 a mentor who administers the writer's program reads it with the
-- student's name, but only where the form said so before the student sent it.
-- Every rating already here was written under "Your mentor can't see who wrote
-- this", so every one of them stays false.
ALTER TABLE "MentorFeedback" ADD COLUMN "namedToMentor" BOOLEAN NOT NULL DEFAULT false;
