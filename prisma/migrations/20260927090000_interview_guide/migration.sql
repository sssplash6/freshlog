-- The guided practice interview: where the two students meet, each one's own
-- answers, and the feedback each writes about the other. No programId: like
-- PeerInterview, these are two students rehearsing and touch no ledger.

ALTER TABLE "InterviewSlot" ADD COLUMN "meetingUrl" TEXT;

CREATE TABLE "InterviewAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "interviewId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "questionIndex" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterviewAnswer_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "PeerInterview" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterviewAnswer_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "InterviewFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "interviewId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "summary" TEXT,
    "wentWell" TEXT,
    "toImprove" TEXT,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterviewFeedback_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "PeerInterview" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterviewFeedback_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InterviewAnswer_interviewId_studentId_questionIndex_key" ON "InterviewAnswer"("interviewId", "studentId", "questionIndex");
CREATE UNIQUE INDEX "InterviewFeedback_interviewId_fromId_key" ON "InterviewFeedback"("interviewId", "fromId");
