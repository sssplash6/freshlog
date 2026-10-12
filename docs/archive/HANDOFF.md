# Pick up here

`REDESIGN.md` is the contract and it is still accurate. This file is only
"where the work stopped and what to do next".

---

## Where it stopped

**All 59 numbered commits have landed.** The series is 94 commits:
`git log --oneline addf3b1~1..HEAD`.

| Phase | REDESIGN.md commits | State |
|---|---|---|
| 0 — audit, spec, safety | 1–3 | **done** |
| 1 — shared foundation | 4–16 | **done** |
| 2 — the three homes | 17–21 | **done** |
| 3 — permissions, program scope | 22–28 | **done.** Access is a `ProgramStaff` row plus `User.platformAdmin`; `/leader` and `/sales` are gone |
| 4 — shell and lens | 29–32 | **done.** 220px sidebar from `navFor`, tab bars below lg, the lens as a cookie, one error boundary |
| 5 — shared renderers | 33–38 | **done.** Every session, task and allocation renders through one component |
| 6 — role-neutral routes | 39–47 | **done.** `/students`, `/students/[id]`, `/sessions`, `/mentors`, `/programs`, `/feedback`, `/notifications` |
| 7 — settings, platform, student app | 48–53 | **done.** `/settings`, `/settings/platform`, per-category notification preferences, `/onboarding` |
| 8 — copy, docs, cleanup | 54–59 | **done except one deferred half** — see below |

### Deliberately not done

- **The redirect map is still in `next.config.ts`.** Commit 57 deletes it "one
  released version after Phase 6", and Phase 6 landed on 5 September 2026. That
  is a date somebody chooses, not a state the code can detect. Sixteen rows;
  delete them together, and delete `MOVED_SUBJECTS` in `notify.ts` at the same
  time.
- **`User.weeklyDigest` survives.** Superseded by `NotificationPreference`, kept
  because the HMAC unsubscribe links already in people's inboxes write it.

### Verified at the stopping point

```
npx tsc --noEmit     clean
npm run lint         clean  (eslint + check-colors + check-copy, both ERRORS)
npm test             196 passed
npm run build        compiles, 31 routes
```

Driven against the built server on :3001 — all 25 current routes resolve or
bounce to `/login`; all 18 retired addresses 308 to a live page **in one hop**
(two chained through another redirect and were fixed); all four `/brand/*`
assets serve.

### What was NOT verified, and why

**Nobody has looked at these pages signed in.** Commit 59 asks for screenshots
at 390px and 1280px as five different readers, plus keyboard-only passes
through *Log a session* and *Approve a student*. Minting an Auth.js session
cookie needs `NEXTAUTH_SECRET` out of `.env`, and the permission classifier
blocks reading it — the recipe in `.claude/skills/verify/SKILL.md` is correct,
it just cannot be run from an agent session here. **Run it by hand before
deploying.** Specifically unproven:

- the four `/onboarding` branches, each of which only one kind of account sees
- a **scoped** admin: every admin in `prisma/dev.db` holds all three programs,
  so nothing has exercised a one-program grant end to end
- the ⌥M repaint (fixed after a browser measured it failing, not re-measured)
- `reduced-motion` zeroing the staggered row delays
- that no table scrolls sideways at 390px on the pages built this week

### What the numbers moved

| | before | now |
|---|---|---|
| raw Tailwind palette classes in `src/` | 106 | **0** (the build fails on one) |
| colour tokens | 47 | 28 |
| identity hues | 8 | 3, muted |
| `StatCard` implementations | 57 | 1 `Figure` |
| renderers for one logged session | 4 | 1 |
| renderers for one task | 4 | 1 |
| hand-rolled row menus | 4 | 1 `RowActionMenu` |
| two-step confirms written by hand | 8 | 1 `ConfirmInline` |
| tests | 0 | 196 |
| migrations | 23 | 30 |
| routes under `/admin`, `/leader`, `/sales` | 20 | 2 |

---

## Bugs this work found, all fixed

Worth reading: each was live, and none was what the commit set out to do.

1. **A mentor could read who rated them 2 out of 5.** The rating form promises
   the student "your name isn't shown to the mentor", and nine of the ten
   admins also mentor — so nine of ten could open the staff feedback page and
   read exactly who had scored them.
2. **Clear unassigned mentors from programs you cannot see.** The mentor edit
   form resubmits existing pairings as hidden inputs, so "Clear" dropped
   pairings in programs the editor was never shown.
3. **An admin with no grants looped forever.** `requireAdminAccess` sent them
   to their home, and an admin's home gated on the same rule and sent them
   back. The inbox had been written to explain that exact state and could never
   be reached to say it.
4. **Both copies of the mentor-reach rule were narrower than the caseload.**
   Scheduling did not accept a task; logging did not accept having-met. A
   mentor could log a session with somebody they could not put a meeting in the
   diary with.
5. **`setMentorAllocation` wrote `formatDate()` text into a date column**, so
   every task the app created for itself was unreadable by a clock and could
   never be overdue.
6. **A 404 after a real write.** Removing a student redirected to a program
   page that no longer existed.
7. **The nameless dual-role admin loop.** `/mentor/onboarding` gated on
   `role === MENTOR`, so a dual-role admin with no name bounced between it and
   `/mentor` forever.
8. **The notification bell shrank to 27px** at 390 — the one target the
   sidebar commit set out to widen — and **⌥M flipped the lens without
   repainting**, because a synthetic click does not drive React's action
   re-render. Both found by measuring in a browser, not by review.

---

## Next, in order

1. **Run `.claude/skills/verify/SKILL.md` by hand.** See "What was NOT
   verified" above. This is the only thing standing between here and a deploy.
2. **The owner's four asks from 4 September** — `TODO.md` Batch 1. The
   hours-dynamics view is a genuinely new feature and needs its own spec
   section; the other three are small.
3. **`TODO.md` Batch 2** — the overdraw warning, mentor removal, CSV export,
   and the sidebar Inbox count.
4. **After a release**: delete the redirect map, drop `User.weeklyDigest`.

## Deploying

`render.yaml` no longer seeds on every boot — that was a second writer to the
permission model, and a grant removed on `/settings/platform` would come back
on the next deploy. A fresh database needs `npm run db:seed` once, by hand.

Auto-deploy is off. The owner deploys deliberately.

Seven migrations land with this work: `ProgramStaff` + `platformAdmin`,
`dueNote`/`dueOn`, `Program.status`/`tracksPayment`, `Notification.category`/
`readAt`, dropping `WebsiteFeedback`, `NotificationPreference`, and the `User`
rebuild that drops `programId`. The last is the only table rebuild; it is last
on purpose, and it verified 26 users in and 26 out with foreign keys clean.

## Two habits worth keeping

- **`git add -u <dir>` swept another agent's half-written work into three
  commits.** Stage explicit paths, and read `git status --porcelain` before
  every commit. `git rm` stages immediately, so a deletion rides into whatever
  you commit next.
- **A function cannot cross the server→client boundary.** It type-checks, it
  builds, and it throws at render. Pass a string base, not a callback.
