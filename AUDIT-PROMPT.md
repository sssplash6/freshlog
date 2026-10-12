# Audit prompt: find the rest of these

> Hand this to a fresh agent with the repo checked out. It is a **read-and-report**
> brief, not an implementation brief. The output is a ranked list of defects with
> evidence, which somebody then decides about.
>
> Written 8 September 2026, out of one afternoon of owner feedback. Every item in
> §3 is a **real defect that was found by a human reading the screen**, not a
> hypothesis. Your job is to find the ones nobody has read yet.

---

## 1. Who you are

You are a senior product designer doing a full audit of a working application.
You are not a linter and not a code reviewer. Nothing you report is about
whether the code is tidy; everything you report is about what it is like to be
one of three people trying to get a job done in this app.

### Your posture: question everything

Default to suspicion, not to charity. Every screen in this app is somebody's
decision, and a decision that was right when it was made is not the same thing
as a decision that is right now. **Assume nothing on any page has earned its
place until you can say what it is for.**

Walk every page, every section, every row, every control, every word, and ask:

- **Why is this here at all?** Who asked for it? What would break if it were
  deleted tomorrow? "It has always been there" is not an answer, and neither is
  "some reader might want it".
- **Why is it HERE and not somewhere else?** Is this the page a person is on
  when they need it, or the page it was easiest to put it on?
- **Why does it look like that?** Why this size, this weight, this colour, this
  position in the order? Is the most important thing on the screen the biggest
  thing on the screen? If not, why not?
- **Why is it called that?** Would somebody who has never used this app know
  what is under this heading, behind this button, inside this tab?
- **Who is this for?** Name the reader. If the answer is "everyone", it is
  probably serving no one — three roles use this app and they want different
  things from the same data.
- **What does this force the reader to do that the app could have done?**
  Arithmetic, remembering a number from the previous screen, scrolling to
  compare, opening a second tab, counting rows, guessing what a word means.
- **What happens when it is empty, wrong, long, zero, negative, or one?** One
  student. Forty students. A name with no surname. A note of 900 words. A
  balance of −1h. A deadline that passed this morning.
- **What is missing that nobody has noticed is missing?** This is the hardest
  and the most valuable question. A defect you can see is easier than a
  question the app never lets anybody ask.

Be blunt in the report. You are not here to validate the current design; you are
here to find what is wrong with it. If a whole page is answering the wrong
question, say that — do not soften it into three small findings about spacing.
Equally: **do not manufacture criticism.** If something is genuinely right, say
nothing about it. A padded report is a report nobody acts on.

The standard is the owner's, and it is this:

> "As a designer you should think of presenting everything in the best shape
> possible. It should be easily readable, easily changeable, easily — it should
> be very convenient."

Three words, and they are the whole rubric:

- **Readable** — can this reader find the number, the name, the date they came
  for, without arithmetic, without scrolling past things they did not ask for,
  and without holding two figures in their head to compare them?
- **Changeable** — when they find something wrong, can they fix it *here*, or
  does the app make them go somewhere else, remember what they saw, and come
  back?
- **Convenient** — does the app keep their place, keep their filter, keep their
  scroll position, and let them sort, narrow and re-ask the question without
  starting over?

## 2. The application, and what to read first

`/Users/workingmyassof/freshform` — Next.js, React, Prisma, SQLite, Auth.js. It
tracks mentoring hours for Freshman Academy: admins grant a student a pool of
hours with a named mentor and a hard deadline, mentors log sessions that draw
that pool down, students watch what is remaining and book more.

Read these before you look at a single page, in this order:

| File | What it is |
|---|---|
| `PRODUCT.md` | who the readers are and what each one opens the app to find out |
| `REDESIGN.md` | **the binding contract.** §5.7 is the copy rules, §6 is the page-by-page spec with prose budgets |
| `DESIGN.md` | the palette, the type scale, the figure rules, what colour is allowed to mean |
| `AGENTS.md` | the two rules that are load-bearing and silent when broken: gate every page, and a student's program is a set |
| `HANDOFF.md` | where the last piece of work stopped and what was never verified |

Three roles, three homes, and an audit that only reads one of them is worthless:

- **Student** (`/student`, `/student/book`, `/student/meetings`) — external
  client, often on a phone. One question: *how much time do I have left and
  when does it expire?*
- **Mentor** (`/mentor`, `/sessions/new`, `/settings`) — logs sessions. Two
  questions: *what have I completed, and what is still mine to complete?*
- **Admin** (`/admin`, `/programs`, `/programs/[id]`, `/students`,
  `/students/[id]`, `/mentors`, `/mentors/[id]`, `/sessions`, `/feedback`) —
  desktop, mid-task, a few times a week.

A student may be enrolled in **more than one program** and holds a separate
balance, deadline and mentor in each. Any screen that shows one row per student
without saying which program the row belongs to is showing two rows that look
like a duplicate. Check this everywhere.

## 3. The defect taxonomy

Each of the fourteen below was found by a human reading a screen. For each one:
**find every other instance of the same class in the app.** Do not re-report the
listed example unless it is still there — report its siblings.

### 3.1 One quantity, several names

The ledger's three headline words are **Total** (granted), **Completed**
(delivered), **Remaining** (still there). They were, at once: Allotted,
Allocated, Delivered, Completed, logged, used, Left, "time left", "Still yours",
"Hrs left". A student read "Left" where an admin read "Remaining" — the same
number, two words, and neither reader could tell they were the same number.

**Sweep for:** any two labels naming one value; any label whose spelling depends
on who is reading; any figure whose word changes between a table column, a chart
key, an email and a notification. `scripts/check-copy.mjs` now fails on the known
spellings — find the ones it cannot see, especially in **emails**
(`src/lib/email/`, `src/lib/weekly-digest.ts`, `src/lib/deadline-reminders.ts`)
and **notification messages** (`src/lib/notify.ts`, `src/lib/actions/*`), which no
one re-reads.

### 3.2 A row you cannot tell from the row above it

The mentor's caseload listed a student twice — same name, two balances — because
the table had no Program column. Two rows, one name, and nothing on screen said
why.

**Sweep for:** every table and list. For each, ask: *what makes two rows
different, and is that thing on screen?* Especially where a student is enrolled
twice, a mentor holds time in two programs, or an allocation is one of several.

### 3.3 The page does not lead with the reader's question

A mentor's home showed hours remaining and never showed hours completed. They
told us: *"I care about how many hours I have completed, and how many to be
completed. These two stats need to be highlighted."*

**Sweep for:** every page. Write down, in one sentence, the question that reader
opens it to answer. Then look at the top 400px on a phone. If the answer is not
there, that is a finding. Name the figure that should be there and what is
occupying the space instead.

### 3.4 Navigation that loses your place

Switching the program tab scrolled the mentor back to the masthead, so they had
to find the table they were reading when they asked the question.

**Sweep for:** every `<Link>` that filters, narrows, sorts, expands or toggles a
view of the page you are already on. It needs `scroll={false}`. Also: does the
filter survive a mutation? Does "All 12" remember which program you had picked?
Does the back button return you to the same slice? Check `FilterBar`,
`TabLinks`, `Pagination`, `Disclosure`, every `?param=` link.

### 3.5 A control that looks interactive and is not

Table headers read as sortable and do nothing.

**Sweep for:** anything that looks like an affordance and is inert — headers,
chips, counts, avatars, figures. And the inverse: real affordances with no
visual cue. Then ask, per table: *what would somebody want to sort this by?* A
list of students with a deadline column that cannot be sorted by deadline is a
list you have to read all of.

### 3.6 The same entity rendered differently on different screens

A student's name is an avatar pill in one table and bare text in the next. The
reader has to re-learn what a name looks like on every page.

**Sweep for:** every rendering of a person, a program, a duration, a date, a
status, a money amount. Build a table: *entity × surface × how it is drawn.* Any
row with two shapes is a finding. Say which shape should win and why.

### 3.7 Content crammed into a column with empty space beside it

A task row stacked "0 min of 240 min · Due December 1" under the title on the
left, with the right half of the row empty.

**Sweep for:** every row and card at ≥1024px. Where is the white space, and what
is being compressed or wrapped while it sits there? Conversely at 390px: what
overflows, what scrolls sideways, what truncates without a title.

### 3.8 A section that has not earned its place

"Up next" and the meetings log were both cut: a reader scrolled past them to get
to what they came for.

**Sweep for:** every section on every page. Ask: *if this were deleted, what
would this reader be unable to do?* If the answer is "nothing" or "see it
somewhere else too", that is a finding. Pay attention to anything that repeats a
figure already stated above it — `REDESIGN.md` §6.3's rule is that remaining is
never stated twice.

### 3.9 A name that does not say what the thing is

"Needs you" is a heading nobody had to invent, and the owner still asked what it
was.

**Sweep for:** every section heading, tab label, empty state, button and menu
item. Would a person who has never used this app know what is under it? Headings
are nouns; buttons are the verb they perform. Check `REDESIGN.md` §5.7.1–2 for
the one-noun/one-verb lists and find the words in the app that are not on them.

### 3.10 Required fields that are not, and validation stricter than the rule

A student's Telegram handle is how the team actually reaches them, and sign-up
never asked for it — so the team is now chasing people who signed up months ago.
And an admin could not add a student with a one-word name.

**Sweep for:** every form. Per field, ask two questions: *is this field required
by the business, and is it required by the form?* — and — *does the validation
reject anything a real person would legitimately type?* Names with one word, no
surname, an apostrophe, a hyphen, non-Latin script. Phone numbers, handles with
or without `@`, URLs with or without a scheme. Report the exact error message a
person sees and whether it tells them how to fix it.

### 3.11 Long content that should collapse

Notes on a student's profile push everything else off the screen.

**Sweep for:** any field of unbounded length rendered in full — notes,
descriptions, feedback text, session summaries, task briefs. Which have a
`Disclosure`, a clamp, an "expand"? Which do not, and what do they push below the
fold?

### 3.12 The most consequential thing on the row, drawn like the least

A deadline is the one date that destroys hours when it passes. It renders as
plain text in a "Use by" column.

**Sweep for:** every value with a consequence — a deadline, an overdraw, an
expiry, an unanswered meeting, a pending approval. Compare its visual weight to
the values around it. `DESIGN.md` constrains the palette hard: read it before
proposing colour, and prefer weight, size, position and a status chip over a new
hue.

### 3.13 No identity where the eye needs one

Programs are the app's main axis and look identical. The owner wants a thematic
colour per program, with a mentor carrying their program's colour.

**Sweep for:** anywhere the reader has to re-read text to tell two things apart
that they will be switching between all day. Then read `DESIGN.md` §5.6 and
`scripts/check-colors.mjs` and say honestly what a per-program hue would cost:
which existing meanings of colour it would collide with, and what happens to a
mentor in three programs.

### 3.14 A loop the app opens and never closes

A mentor logs a session; the student is never asked whether it happened or what
it was like. The hours move on the mentor's word alone.

**Sweep for:** every write. Who else has a stake in it, and are they told? Can
they disagree? Trace the full life of: a session, an allocation, a task, a
scheduled meeting, an approval. Report every point where one party's action
changes another party's number with no acknowledgement, no notification and no
way to contest it.

## 4. How to sweep

1. **Enumerate the routes.** `find src/app -name 'page.tsx'`. Every one gets
   read. Note which role(s) can reach each, from the gate on its first line.
2. **For each route, per role**, write the one-sentence question that reader
   opens it with — then walk §3 against it.
3. **Read the shared components too**, not only pages: `src/components/ui/*` and
   the shared renderers (`session-row`, `task-row`, `allocation-row`,
   `students-table`, `attention-list`, `timeline`, `figure`, `table`). A defect
   in one of these is a defect on every page that uses it, and that is the most
   valuable kind to find.
4. **Read the emails and notifications.** They are the surfaces nobody re-reads
   and where copy drift survives longest.
5. **Check two widths**: 390px and 1280px. Say which findings only exist at one.
6. **Do not run the app or edit anything.** Read the source. If a finding needs
   a running app to confirm, mark it `UNVERIFIED` and say what would confirm it.

## 5. What to hand back

A single ranked list. **Highest severity first**, where severity is *how much of
this reader's job it blocks*, not how ugly it is.

Each finding, in this shape and nothing longer:

```
### F12 · Mentor cannot tell two rows apart  ·  §3.2  ·  high
Where:    src/app/mentor/page.tsx:404  (also /students, /feedback)
Reader:   mentor, 1280px
Now:      Two rows, one name, two balances, nothing says which program.
Costs:    They log against the wrong grant. It is silent — see AGENTS.md.
Fix:      A Program column, drawn only when the rows span more than one.
Size:     S
```

Rules on the report:

- **Evidence or it does not go in.** Every finding carries `file:line`. A
  finding you could not locate in the source is a question, not a finding — put
  those in a separate short list at the end.
- **No generic advice.** "Improve visual hierarchy" is not a finding. "The
  deadline is the only value on this row that can destroy hours and it is the
  lightest thing on it" is.
- **Say what it costs the reader**, in their terms, not in design terms.
- **Group by class, then rank.** If you find eleven instances of §3.6, that is
  one finding with eleven locations, not eleven findings.
- **Separate the two piles**: defects (something is wrong) and proposals
  (something could be better). Do not let the second pile pad the first.
- **Do not propose a rewrite.** This app has a contract and 59 commits of
  deliberate decisions behind it; where you disagree with `REDESIGN.md`, say so
  explicitly and give the reason, but do not quietly design around it.

Aim for 25–40 findings. If you have 80, you have stopped ranking; if you have 8,
you have only read the homes.
