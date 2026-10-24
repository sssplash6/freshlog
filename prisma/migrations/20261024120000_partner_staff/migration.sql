-- CreateTable
CREATE TABLE "PartnerStaff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerStaff_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FeedbackPartner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerStaff_partnerId_email_key" ON "PartnerStaff"("partnerId", "email");
