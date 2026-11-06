-- The interviews students practise on each other, moved out of the code so the
-- people who run the school can read and change them without a deploy.
--
-- The five that were in lib/interview-templates.ts arrive with the SAME ids,
-- because every PeerInterview row already names one of them by id.
CREATE TABLE "InterviewTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "questions" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "InterviewTemplate" ("id", "name", "summary", "questions", "position", "createdAt", "updatedAt") VALUES
('freshman-session-1', 'Freshman Interview Practice: Session 1', 'The school''s first session: getting to know you, and why college.', '["What are you reading, watching, or working on right now? Is there anything that has caught your attention recently?","Describe a teacher you really enjoyed learning from.","What are you most excited about in college?","Tell me about a situation when you had to change your mind or adapt to make something work."]', 0, strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
('university-admissions', 'University admissions', 'An admissions officer or alumnus meeting an applicant.', '["Tell me about yourself.","Why do you want to study this subject?","Why this university in particular?","What have you read or done outside class that shaped your interest?","Describe a challenge you faced and how you handled it.","What will you contribute to our campus community?","What questions do you have for me?"]', 1, strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
('scholarship', 'Scholarship panel', 'A funding panel deciding who to invest in.', '["Why do you deserve this scholarship over other strong applicants?","What do you plan to do after graduating, and how does this help?","Tell me about a time you led others.","How have you given back to your community?","What is your biggest weakness, and what are you doing about it?","Where do you see yourself in ten years?"]', 2, strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
('behavioral', 'Behavioral (STAR)', 'Questions answered as situation, task, action, result.', '["Tell me about a time you failed. What did you learn?","Describe a time you disagreed with a teammate. What happened?","Tell me about a goal you set and how you reached it.","Describe a time you had to learn something quickly.","Tell me about a decision you made with incomplete information.","Describe a time you helped someone who was struggling."]', 3, strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
('visa', 'Student visa', 'A consular officer checking study plans and ties to home.', '["Why did you choose this country and this university?","What will you study, and why is it useful for you?","Who is paying for your studies?","What do your parents do?","What are your plans after you finish your degree?","Do you have relatives in this country?"]', 4, strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'));
