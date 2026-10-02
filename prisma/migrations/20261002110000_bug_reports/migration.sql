-- CreateTable
CREATE TABLE "BugReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporterId" TEXT,
    "reporterRole" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pagePath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolution" TEXT,
    "resolvedAt" DATETIME,
    "changelogDate" TEXT,
    "triagedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BugReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BugReport_triagedById_fkey" FOREIGN KEY ("triagedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BugReportImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "bytes" BLOB NOT NULL,
    "mimeType" TEXT NOT NULL,
    CONSTRAINT "BugReportImage_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "BugReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BugReport_reporterId_createdAt_idx" ON "BugReport"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "BugReport_status_createdAt_idx" ON "BugReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BugReportImage_reportId_key" ON "BugReportImage"("reportId");

