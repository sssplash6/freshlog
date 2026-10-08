-- Tasks a program's admin sets its mentors: one task, any number of mentors,
-- any number of students it is about (including none).
CREATE TABLE "MentorTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "dueOn" DATETIME NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MentorTask_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MentorTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "MentorTaskAssignee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "MentorTaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MentorTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MentorTaskAssignee_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MentorTaskStudent" (
    "taskId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    PRIMARY KEY ("taskId", "studentId"),
    CONSTRAINT "MentorTaskStudent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MentorTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MentorTaskStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MentorTask_programId_dueOn_idx" ON "MentorTask"("programId", "dueOn");
CREATE UNIQUE INDEX "MentorTaskAssignee_taskId_mentorId_key" ON "MentorTaskAssignee"("taskId", "mentorId");
CREATE INDEX "MentorTaskAssignee_mentorId_idx" ON "MentorTaskAssignee"("mentorId");
CREATE INDEX "MentorTaskStudent_studentId_idx" ON "MentorTaskStudent"("studentId");
