-- CreateTable
CREATE TABLE "FeedbackPartner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PartnerStudent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerStudent_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FeedbackPartner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PartnerMentor" (
    "partnerId" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,

    PRIMARY KEY ("partnerId", "mentorId"),
    CONSTRAINT "PartnerMentor_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FeedbackPartner" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PartnerMentor_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PartnerFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "studentEmail" TEXT NOT NULL,
    "mentorId" TEXT,
    "sessionNumber" INTEGER,
    "name" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerFeedback_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FeedbackPartner" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PartnerFeedback_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackPartner_slug_key" ON "FeedbackPartner"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerStudent_partnerId_email_key" ON "PartnerStudent"("partnerId", "email");

-- CreateIndex
CREATE INDEX "PartnerFeedback_partnerId_createdAt_idx" ON "PartnerFeedback"("partnerId", "createdAt");
