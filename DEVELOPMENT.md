# FreshLog: development notes

This was the README until 2026-10-29.

Internal, role-based web app that tracks students' mentoring time, in minutes. Students
are granted hours by admins, book sessions with mentors through external
Calendly links, and mentors log completed sessions, which draws down the
student's balance. Mentors also schedule interviews ahead of time, which the
student confirms. Everyone sees dashboards scoped to their role and gets
in-app notifications when hours change.

**Stack:** Next.js 16 (App Router) · Prisma 7 + SQLite · Auth.js v5 (Google
only) · Tailwind CSS 4. Deployed as a single Render web service with a
persistent disk.

## Roles

| Role | Home | Can do |
|---|---|---|
| Platform admin | `/admin` | Every program, present and future. The only people who can grant access, create a program, or change somebody's name or sign-in email |
| Program admin | `/admin` | The programs they hold a `ProgramStaff` grant for: students, mentors, time, tasks and feedback inside those and nowhere else |
| Mentor | `/mentor` | Their caseload, log/correct/void their own sessions, schedule and move their own meetings, their own (anonymous) ratings |
| Student | `/student` | Their time and history, answer a meeting invitation, book through their mentors' links, rate a mentor |

Access is a **row, not a role**. `role = ADMIN` grants nothing on its own: a
person sees the programs they hold a grant for, and grants are made in one
place — `/settings/platform`. The old `DEPT_LEADER` and `SALES` roles survive
as grant *levels* (Leader reads a program and its feedback, Sales reads its
students) but nothing creates them today, and their `/leader` and `/sales`
route trees are gone: they were the same three lists with a different prefix,
and they existed only because scope used to be one column on `User`.

Almost everyone on staff is two people at once — nine of the ten admins also
mentor — so the **lens** (`Admin | Mentor`, ⌥M) decides emphasis: which home
`/` resolves to, the sidebar, the default filter, which button is primary. It
never decides authority. An entity page renders the union of your rights.

**Sign-in rules:** everyone uses Google OAuth. Staff come from the seeded
preset list; students can sign in only if staff created them first
(whitelist); unknown `@freshman.academy` accounts self-register as mentors
with status `UNASSIGNED` until an admin assigns them; all other unknown
emails are rejected.

## Environment variables

| Variable | Purpose | Example |
|---|---|---|
| `DATABASE_URL` | SQLite file location | `file:./prisma/dev.db` (local), `file:/data/app.db` (Render) |
| `GOOGLE_CLIENT_ID` | Google OAuth client id | `…apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | `GOCSPX-…` |
| `NEXTAUTH_SECRET` | Auth.js JWT signing secret | output of `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Canonical site URL | `http://localhost:3000` / `https://<service>.onrender.com` |

Copy `.env.example` to `.env` and fill these in.

### Google OAuth setup

In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials),
create an **OAuth client ID** (type: Web application) with:

- Authorized JavaScript origin: `<NEXTAUTH_URL>`
- Authorized redirect URI: `<NEXTAUTH_URL>/api/auth/callback/google`

## Local development

```bash
npm install
cp .env.example .env        # then fill in the values
npx prisma migrate deploy   # create/upgrade the SQLite schema
npx prisma db seed          # programs, starter cohorts, staff preset list
npm run dev                 # http://localhost:3000
```

## Configuration (staff, programs, mentor domain)

Staff accounts, the fixed program/cohort list, and the allowed mentor
sign-up domain live in [`config/app-config.ts`](config/app-config.ts) — not
in application code. Edit that file and re-run `npx prisma db seed`
(idempotent: upserts, never deletes). Replace the placeholder dept-leader
and sales emails with real people before launch.

## Deploying to Render

One **Web Service** + one **persistent disk** (SQLite pins the app to a
single instance — that's the accepted trade-off; the data layer is plain
Prisma so a later move to managed Postgres won't rewrite features).

1. **New → Web Service**, connect this repo.
2. **Disk:** add a disk (1 GB is plenty), mount path `/data`.
3. **Build command:** `npm install && npm run build`
4. **Start command:** `npx prisma migrate deploy && npm start`
   (migrations run against the disk on every deploy; they're no-ops when
   nothing changed)
5. **Environment:** set all five variables from the table above, with
   `DATABASE_URL=file:/data/app.db` and `NEXTAUTH_URL=https://<service>.onrender.com`.
6. Add the Render URL to the Google OAuth client (origin + redirect URI).
7. **First deploy only:** open the service's Shell tab and run
   `npm run db:seed`, then sign in with a seeded admin account.

## Project layout

```
config/app-config.ts     deployment data: mentor domain, programs, staff list
prisma/                  schema, migrations, seed
src/lib/auth.ts          Auth.js config + sign-in gate
src/lib/dal.ts           server-side auth: getCurrentUser / requireRole
src/lib/actions/         all mutations (server actions, permission-checked)
src/lib/queries.ts       derived-time queries
src/proxy.ts             optimistic redirect to /login (Next 16 middleware)
src/app/<role>/          role-scoped pages behind requireRole layouts
```

Every duration in the ledger is a whole number of **minutes**. They were
decimal hours until Aug 29 2026; migration `durations_in_minutes` converted each
one as `round(hours × 60)`, which recovered the whole minutes the spreadsheet
values had been rounded from. Integers, so sums are exact. A single meeting or
task budget reads as plain minutes ("90 min"); roll-up totals read as hours and
minutes ("18h 20m") — `formatMinutes` and `formatDuration` in `src/lib/format.ts`.

Completed and remaining time is **derived** from `ACTIVE` sessions vs.
`allottedMinutes` — never stored as counters. Voiding a session returns its
hours automatically. Every allotment change writes an `HourAllotmentChange`
audit row.

Which sessions actually spend an allocation is one rule, `chargesAllocation()`
in `src/lib/constants.ts`: active *and* in-plan. A session logged as EXTRA
(`Session.withinPlan = false`) is time the mentor gave on top of the plan — it
appears in every log and counts toward its task, but it moves no balance and
can be logged after the allocation's deadline has passed.

A scheduled meeting is an `Interview`, deliberately not a future-dated
`Session`: it charges nothing, the student answers it, and it becomes hours
only when the mentor logs that day's session — which retires it as `HELD`.

## Out of scope (MVP)

Multi-program enrollment, SMS, staff management UI (seeded instead), and
Google Calendar/Meet integration — scheduling is in-app only, and the meeting
link is whatever the mentor pastes in.
