-- Bug reports and feature requests from the team's Telegram group.
--
-- Three columns with constant defaults on BugReport, so every existing report
-- reads as an in-app bug report exactly as before, two nullable columns, and
-- one new table. The new IN_REVIEW status is a value, not a column.

ALTER TABLE "BugReport" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'BUG';
ALTER TABLE "BugReport" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'APP';
ALTER TABLE "BugReport" ADD COLUMN "telegramAuthor" TEXT;
ALTER TABLE "BugReport" ADD COLUMN "originalText" TEXT;

CREATE TABLE "TelegramMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "reportId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramMessage_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "BugReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TelegramMessage_chatId_messageId_key" ON "TelegramMessage"("chatId", "messageId");
CREATE INDEX "TelegramMessage_reportId_idx" ON "TelegramMessage"("reportId");
