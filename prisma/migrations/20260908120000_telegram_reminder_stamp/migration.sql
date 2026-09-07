-- When a student was last nudged to supply a Telegram handle.
-- Null = never asked. The reminder job writes it per recipient as each mail is
-- accepted, so a crash mid-run cannot re-mail the people it already reached.
ALTER TABLE "StudentProfile" ADD COLUMN "telegramReminderAt" DATETIME;
