-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "pushedAt" DATETIME;

-- Every notice already written was written before push existed: none of it is
-- pushed. The sweeper only ever looks at rows whose pushedAt is null.
UPDATE "Notification" SET "pushedAt" = CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiTokenId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeviceToken_apiTokenId_fkey" FOREIGN KEY ("apiTokenId") REFERENCES "ApiToken" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PushPreference" (
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "on" BOOLEAN NOT NULL,

    PRIMARY KEY ("userId", "category"),
    CONSTRAINT "PushPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Notification_pushedAt_idx" ON "Notification"("pushedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

-- CreateIndex
CREATE INDEX "DeviceToken_apiTokenId_idx" ON "DeviceToken"("apiTokenId");
