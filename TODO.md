# Backlog

Agreed next batches, in priority order. Nothing here is started.

Everything that used to be in Batch 1 and Batch 2 was done by the reorganisation
(`REDESIGN.md`) and is listed at the bottom, so nobody re-opens a solved
problem. `REDESIGN.md` §11 is the other half of this file: things deliberately
kept out of that work, each with the reason.

## Reported issues — 11 October 2026

Pasted one at a time, worked one at a time, top to bottom. The quote is the
report as given; the notes under it are ours. Status is **open**,
**in progress**, or **done** with the commit that fixed it.

### 1. Back from "Log a session" goes to All students, not Full Support — done (d4ba69d)

> when Valera, admin, tries to log in a session and tries to go back, it goes
> to all students, he has to go to full support instead.

- Reported for Valera Arakelyan (admin).
- Screenshot: Abdulhamid Nuriddinov's student page, opened from the Full
  Support program (its back link reads "← Full Support"). **Log a session** is
  at the top right. Back from the log-session form should land where he came
  from, not on the all-students list.
- Where a student page's Back link leads is one of the owner's decisions that
  got undone once already (AGENTS.md). Blame the Back-link code first, and keep
  whatever he decided.

### 2. Set one task for every student in a program at once — done (7c829b2)

> also admin wants to assign one task to all students at once, a button on
> full support page, that would select all students

- A feature request, not a bug. The button lives on the program page (Full
  Support) and selects all of that program's students for a single task.
- Decided 11 October: **every student in the program, no list to edit.** That
  includes students visiting on exchange. One click, one task each.

### 3. Student page and roster row disagree on the same student's hours — done (68f10ca)

> data discrepancy

Two screenshots of Jahongir Karimbaev:

| | Student page | Roster row |
|---|---|---|
| Remaining | 31h (10h to use by December 1) | 22h |
| Used | 4h completed + 2h missed, charged | 1h |
| Total | 37h | — |
| Last session | October 9, Cila Warncke, 1h | October 8, "2 days ago" |

- The student page header reads "Advanced Research Program / September 2026 ·
  Flexible Program" and shows 7 sessions (Oct 9 Cila Warncke 1h, Oct 8 Nigel Li
  25 min, Oct 4 Nigel Li 20 min, Sep 26 Nigel Li 2h, …). It also says "You hold
  no time with them", so the viewer has no allocation of their own.
- The row's column headers are cropped out. Confirm which list it came from
  (probably the Advanced Research Program roster) and what its "1h" column
  means.
- Cause: he is in two programs (Advanced Research Program and Flexible
  Program). His page adds up every program the reader can see, and a
  program's roster counts only its own hours. Both figures were right, but
  neither page said so. Fixed by listing each program's figures under the
  Progress bar.
- It also shows that the Research merge (`npm run db:merge-research`) had not
  run in production as of 10 October: "Advanced Research Program" is still its
  own program there.

### 4. Merge Pre-Full Support into Full Support as a subsection — waiting on Valera

> We should also merge Pre-Full Support and Full support
>
> Pre-Full Support being the subsection

- From Valera, 10 October 2026, 14:53.
- Today they are two programs. Asked for: one program, Full Support, with
  Pre-Full Support as a subsection inside it.
- Decided 11 October: Pre-Full Support is **a stage students move up from**.
  An admin moves each student up by hand. Nothing promotes them
  automatically.
- **Open, for Valera:** what happens to Pre-Full Support's existing hours and
  sessions when the programs merge. Either they move into Full Support's ledger,
  or they stay as Pre-Full Support history and only new work goes under Full
  Support. Do not start until he answers.
- Found 11 October: this has a precedent. `prisma/merge-research-programs.ts`
  folded Emerging, Advanced and Frontiers into one Research Program with
  levels. Pre-Full Support can be a level of Full Support the same way, and a
  student moves up when an admin changes their level, so nothing promotes them
  automatically. That script moved every recorded hour into the merged
  program's ledger, so if Valera agrees, the same script can be reused with
  different names.
- Collisions to count first: a student in both programs, and two hour banks
  (both programs may bank) that would need adding together.
- Every ledger row (allocations, sessions, tasks, allotment changes) carries
  its program, so merging moves those rows too. A student enrolled in both
  programs with the same mentor holds two allocations that would collide on
  `(student, program, mentor)` and have to be combined. Count those before
  deciding anything.

### 5. Program page: students first, mentors back on the side, recent sessions at the bottom — done (25d635b)

> ...students shoudl be the first tab I see in programs
>
> Mentors are on the side like before
>
> It was much more useful
>
> Also, last meetings on the bottom woudl be good too

- Screenshot: the Full Support program page. **Students** is already the first
  tab, but inside it the Mentors panel (22 mentors, plus "Assign a mentor")
  fills the top, and "Add students", the search and the student table come
  only after it. The complaint is what you see first, not the tab order.
- Asked for, in three parts:
  1. The student list is the first thing on the page.
  2. Mentors move back into a side column, the way it used to be. Find that
     earlier layout in `git log` before redesigning it. It may be one of the
     layouts lost in the stale-branch merges.
  3. A list of recent sessions ("last meetings") at the bottom of the page.

### 6. Saving button should read "Loading…", not "Allocating…" — done (4b48c24)

> lets say loading in that butotn instead of relocating

- Clarified 11 October: not a hang. While the Allocate time form saves, the
  button should say "Loading…" rather than "Allocating…". Changed on this form
  only. Every other form says what it is doing ("Saving…", "Setting…").
- Screenshot: Allocate time for Deniz Sattar, button showing a spinner and
  "Allocating…".
- Other forms' saving buttons probably follow the same "verb-ing…" pattern.
  Check them, and ask whether "Loading…" should replace them all or only this
  one.
- Also small: the back link reads "← Student" rather than the student's name.

### 7. Hour-bank students: "Allocate time" refuses, and the way forward is not offered — done (13e02b3)

> cant log hour
>
> can you investigate?

- From Samandar.
- Screenshot: Allocate time for Azim Egamberdiev (Full Support), mentor Milutin
  Milojkovic, use by October 31. Submitting shows "This student's hours in Full
  Support are in an hour bank, which every meeting draws. Add to the bank
  instead." The Minutes box is empty again.
- They say "log hour" but the screen is Allocate time. Find out which they
  were trying to do. Either way the app let them fill in the whole form before
  refusing, and the error names "the bank" without a link to it.
- The fix probably sits upstream of the form. For a student whose program uses
  an hour bank, "Allocate time" should lead to adding to the bank, or not be
  offered at all, rather than open a form that cannot succeed.
- Keep the refusal itself. `src/lib/actions/students.ts` refuses on purpose:
  time granted beside a bank would sit unspent, because meetings draw the bank.
  The fix routes people to the bank; it does not remove the check.
- Done: when the student already holds a bank, the form now IS the bank's
  top-up (no mentor, no agenda) and says why. The add-to-bank path existed
  all along, as "Hour bank" on the Agenda list.
- Check whether the add-to-bank path still exists and is reachable. A
  stale-branch merge (45f095e) is believed to have dropped some hour-bank code;
  confirm that before relying on it.

## Batch 1 — what the owner asked for on 4 September, unbuilt

Voice notes, transcribed from a phone. Check each against what he meant before
building it.

- **An hours-DYNAMICS view.** "Who is missing hours, who is performing how."
  Everything in the product is a snapshot — balances, totals, what needs doing
  today. This asks for change over time, and it has a dependency: no table
  records a *rate*, so somebody has to decide the window (per week? per month?)
  and whether it is derived from `Session.date` alone. Needs its own spec
  section before any of it is built.
- **A persistent "+" to add time and to log, in one tap.** `/sessions/new`
  exists and both homes link it; he is asking for something lighter and always
  to hand, probably in the shell.
- **Round the orienting figures.** "130h 07m" should read "130+ hours".
  `formatApprox` exists and the rule is drawn — a figure you *orient* by rounds,
  a figure that is *the record* stays exact — but the rounding is not applied
  everywhere he meant. Ask him to confirm the split before widening it.
- **Cut the scrolling, everywhere.** "Show them, and if it's interesting I'll
  open it further." `ui/disclosure.tsx` exists for exactly this and is used in
  five places; every long list should default to a short, dense form.

## Batch 2 — correctness hygiene

- Overdraw warning when a mentor logs beyond a student's remaining balance
  (allowed silently today, by decision — but silently is the part to fix).
- Mentor removal (the account), mirroring the student "remove while no sessions
  exist" rule. Today only pairings can be removed.
- CSV export for admins (students with hour totals; sessions), respecting the
  active filters. A route handler must call `requireAdminAccess()` itself —
  layouts do not protect route handlers.
- The unread-count on the sidebar's **Inbox** item. It renders without a number
  because the only honest source is the attention list each home already
  builds, and asking a second time would double the cost of every render. It
  wants one `cache()`d query shared by the shell and the homes.

## Batch 3 — after a release

- **Delete the redirect map** in `next.config.ts`. Every row landed on
  5 September 2026; the map comes out one released version later, which is a
  date somebody has to choose, not a state the code can detect.
- **Drop `User.weeklyDigest`.** Superseded by `NotificationPreference`, kept
  only because the HMAC unsubscribe links already in people's inboxes write it.
  Goes when the last of those emails has aged out.

---

## Done by the reorganisation

Do not re-open these; they are in `git log` and in `REDESIGN.md`'s phase list.

- Name/email search on the students list — it is `FilterBar` + `studentsWhere`,
  and every narrowing is a Prisma `where` rather than a pass over the school.
- Pagination on the sessions list, which is now `/sessions` and pages properly.
- The admin sessions ledger — `/sessions`, both tabs, cross-program.
- A vitest harness around the money logic: 196 tests, starting with
  `src/lib/hours.ts`.
- The two standing lint errors (`Date.now()` during render, setState-in-effect).
- Staff management: `/settings/platform` grants program access, which is what
  "create dept leaders" was really asking for. Scope is a row now, not a role.
