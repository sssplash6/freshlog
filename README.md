# FreshLog

![commits](https://img.shields.io/github/commit-activity/t/sssplash6/freshlog) · live at [freshlog.net](https://www.freshlog.net) · public demo with fictional data at [demo.freshlog.net](https://demo.freshlog.net)

**The problem.** Freshman Academy students buy blocks of mentoring hours. Those hours were tracked in spreadsheets, chat messages, word of mouth and on paper, so there was no single record of how much time a student had used or had left.

**The idea.** One ledger. Admins grant hours, mentors log every session against them, and a balance is always computed from the log, never typed in by hand.

**What it does now.**

- Separate home pages for students, mentors and admins, with Google sign-in and access granted per program.
- Mentors log sessions in minutes, which draws down the student's balance. Voiding a session gives the time back, and every change to a grant leaves an audit row.
- Mentors schedule meetings that students confirm, students rate their mentors anonymously, and everyone gets notified when their hours change.
- Students can belong to several programs, each with its own hours and deadlines, and one program can lend a student to another for a capped number of hours.
- Since launch on 22 July 2026: 1,192 hours logged over 1,403 sessions, 175 students, 44 mentors, 15 programs (as of 19 October).

**Stack:** Next.js 16 (App Router), TypeScript, Prisma 7 + SQLite, Auth.js v5 (Google), Tailwind CSS 4. One Render web service with a persistent disk.

## Run it

```bash
npm install
cp .env.example .env        # then fill in the values
npx prisma migrate deploy
npx prisma db seed
npm run dev                 # http://localhost:3000
```

Environment variables, Google OAuth, deploying, roles and the ledger rules: [`DEVELOPMENT.md`](DEVELOPMENT.md). Rules for changing the code: [`AGENTS.md`](AGENTS.md).
