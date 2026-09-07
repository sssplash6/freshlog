# REDESIGN — the binding specification

**Status:** contract. This file supersedes `UX-IMPLEMENTATION-PROMPT.md` as the plan of record and
overrides `DESIGN.md` wherever the two disagree (`DESIGN.md` is rewritten in Phase 8 to match).
Written 2026-09-03 from a 14-agent audit of all 33 routes and all 75 components, three competing
information architectures, three judge panels, and the owner's binding decisions.

**The complaint being answered, verbatim:** *"repetitions, text blocks, long text not rendering
right, too much noise, zero proper categorization and management of assets, too clowny because it
uses too many colors … everything feels all over the place. like why mentor sees bunch of nonsense
when on the homepage. or why we don't have separate settings icon and page for programs."*
**The goal:** *"super clean platform w no noise. everything should feel clean, organized."*

**What must survive untouched.** The ledger rules are correct and are not redesigned: whole
minutes; allotted = sum of `HourAllocation`; used = ACTIVE in-plan sessions; no-shows charge and are
tallied "missed"; EXTRA charges nothing; deadlines are hard, so unused minutes are forfeited and
logging is blocked after the date; voiding returns time; every allotment change is audited and
notified. **No UI goal may change an hours number** — the forfeiture arithmetic in `hours.ts` and
`queries.ts` is not rewritten by this plan.

---

## 1. The spine

**Triage.** Every role home is a typed *"Needs you"* list, one lead figure, and a seven-day
*"Up next"* timeline — and then nothing. History and browsing live behind list destinations with
server-side search, filters and pagination. Each entity (student, mentor, program) has exactly one
page, shared by every role and gated per-permission. One typed status model produces the inbox
rows, every table chip, the notification categories and the empty states, so a state is worded
once and rendered by one component.

This is chosen because it is the direct answer to the loudest sentence in the brief. Today a mentor
opening `/mentor` gets 634 lines: a greeting banner, six lifetime numbers, program "islands", an
empty diary, a recent-meetings log, a nine-column table, and two complete forms
(`mentor/page.tsx:404-632`). Under this spine the same person gets three lines: what needs them,
what is next, who is running out of time.

### Nine rules the whole document obeys

1. **One tree of objects.** A student is `/students/[id]`, a mentor `/mentors/[id]`, a program
   `/programs/[id]`, the ledger `/sessions`. No role prefix on a shared object.
2. **Authority is checked against the person and the object, on the server, never inferred from the
   URL — and never from the profile lens.** Every page calls its own gate; a layout gate is defence
   in depth, never the only gate. (This is the standing rule created by today's layout-only-auth
   fix; it also goes into `AGENTS.md`.)
3. **The profile is a lens, not a place, and it never removes a control.** See §3.
4. **Homes read; they do not edit.** Two stated exceptions, both one-tap answers to a typed
   question, never forms: a student answers a proposed meeting on their home; an admin approves a
   signup on the inbox row.
5. **One `h1`, one lead figure, hairlines.** No banner wash, no ghost monogram, no tinted panel
   header, no stat strip. A section is a title, an optional count, an optional action, one rule.
6. **One renderer per kind of thing.** `SessionRow`, `TaskRow`, `AllocationRow`, `TimelineItem`,
   `StatusChip`, `Figure`, `PersonCell` — each used everywhere its object appears.
7. **Status is a word with a glyph.** Four severities, two chromatic hues, a glyph on every
   chromatic chip. Never colour alone.
8. **Free text is always clamped and always expandable.** `ExpandableText` on every note, comment
   and purpose; chips wrap; tables never scroll sideways.
9. **Hints ≤ 12 words. Empty states are one sentence and carry no action button.**

### Grafted in from the two rejected architectures

| Taken from | What |
|---|---|
| calm-minimal | The subtraction discipline: a stated route budget, a named component ledger, the 34-file retirement list, `ExpandableText` on *every* free text, "tables never scroll sideways", the seven rules above (extended to nine), the quieter palette (`accent-soft` and `accent-dark` retired too, programs get no hue), the repaired `HoursRing` as the student's lead figure, "Sessions and Tasks side by side on ≥ lg" as the surviving `LedgerBoard` reading, the `/sessions/new` failure contract and **Log another**, the `/student/book` email fallback, the one-table grants editor, and the entire verification phase (§10, Phase 8). |
| entity-first | Union-of-rights on entity pages (§3), the sole write surface for admin grants (§8.4), count discipline (exactly two counted nav items), the one-`Callout`-per-page ceiling, the GOV.UK `FactList` for student details, the "program contact is a named person or the phrase is dropped" copy rule, redirects-with-an-expiry instead of a live-data `UPDATE`, `Program.staff → ProgramStaff` (the `deleteProgram` guard nobody else caught), zero-prose Programs list, inline **Approve** on the admin home, and the honest disabled action with its reason. |

### Rejected, and why

- **The near-invisible switch** (calm-minimal: no badge, "the `h1` is the tell") — the owner is the
  dual-role user and named the switch non-negotiable.
- **Hiding admin controls in mentor lens** — it makes the owner press ⌥M to allocate time while
  looking at a student. Replaced by the union of rights (§3).
- **Demoting mentor ratings** to an account-menu item and deleting the student-facing mentor page —
  decision 3 cut *website* feedback only.
- **A per-program `groupBy` for admin totals** — it cannot reproduce per-allocation forfeiture
  (`queries.ts:80-100`), so the admin lead figure would silently disagree with every student page.
  See §8.6.
- **Renaming `User.role`** (`ADMIN`/`STAFF`) — `platformAdmin` + `ProgramStaff` already does the
  work; the rename touches `import-masters.ts:184,227` and `weekly-digest.ts:429-465` for nothing.
- **Cosmetic file merges** (`submit-button` → `button`, `empty-state` + `error-state` → `states`) —
  churn with no user-visible gain. Every merge in §5.2 is justified by a shared field group and
  lands in the commit that rewrites its call sites.
- **An inline log form on the mentor home** — an embedded form is what made that page nonsense.
  Logging is a page.
- **Tab rows on `/mentors/[id]`** and the desktop staff rail for students — re-chroming what it
  de-duplicates. The mentor page is one scroll; students get a consumer shell.
- **A program tone picker / `Program.toneIndex`** — programs are identified by name only.
- **An `UPDATE` of stored `Notification.href`** — the only avoidable mutation of live data in the
  plan. Replaced by a redirect map with an expiry date (§2.3).
- **`/student/history`, `/sessions/scheduled`, a tabbed platform route** — route inflation. History
  is a section of `/student/meetings`; Scheduled is a `?view=` tab; Platform is one page.
- **`TaskType` + `Assignment.taskTypeId`, `Session.attendance`, `bookingUrl`, `Interview.kind`** —
  out of the plan (§11); they rewrite columns the ledger reads, and `taskTypeId` is the only real
  table rebuild the redesign would have added.
- **A persistence model for saved views** — URL presets only, per the brief.

---

## 2. Route plan

**Budget: 23 pages + 6 route handlers = 29 routes (from 33), 4 layouts (from 9), 2 error
boundaries (from 7).** A ceiling: a new route requires deleting one, and the commit that adds it
says which line of this table it changes.

### 2.1 Disposition of all 33 existing routes

| # | Route today | Disposition | Target | Why |
|---|---|---|---|---|
| 1 | `/` | reshape | server `redirect()` to the profile's home; students → `/student` | 200 + a 1-second `<meta refresh>` skeleton today (`page.tsx:5-9`) |
| 2 | `/login` | reshape | `PublicCard`, `h1` "Sign in", one role-neutral line | Two contradicting paragraphs, two product names (`:9,35,66`) |
| 3 | `/unsubscribe` | reshape | `PublicCard`, hairline not orange, `Button` primitives | Hand-rolled buttons, decorative orange (`:47,66,72,85`) |
| 4 | `/notifications` | reshape | title row · filters · anchor rows · pagination | Rows are form buttons; every student href lands on `/student` (`notification-list.tsx:49-57`, `notify.ts:86`); the digest toggle sits in the feed (`:111-137`) |
| 5 | `/admin` | reshape | **Admin inbox** (§6.1) | Banner + strip + editable log before the only navigation into a program (`admin/page.tsx:77-200`) |
| 6 | `/admin/students` | move | `/students` | One students list in the product, not four |
| 7 | `/admin/students/[id]` | merge | `/students/[id]` | Two pages for one person; every session and task rendered twice here |
| 8 | `/admin/mentors` | move | `/mentors` | Edit lives on the list; the detail page has none |
| 9 | `/admin/mentors/[id]` | merge | `/mentors/[id]` | Two banner pages per mentor joined by "View profile" |
| 10 | `/admin/programs/[id]` | move | `/programs/[id]` | Role-neutral entity; leaders and sales share it |
| 11 | `/admin/programs/[id]/students` | move | `/programs/[id]/students` (mounts `StudentsList`) | Reimplements `ProgramStudentsIsland` line for line |
| 12 | `/admin/programs/[id]/settings` | move | `/programs/[id]/settings` | Right grouping, unreachable from nav; the gear the owner asked for |
| 13 | `/admin/feedback` | move | `/feedback` | Website feedback cut (decision 3); N+1 up to 25 queries (`feedback.ts:33-45`) |
| 14 | `/leader` | delete | `/admin` scoped, or `/programs/[id]` at scope 1 | Byte-identical to `/sales` bar 2 tokens |
| 15 | `/leader/students` | delete | `/students` scoped | Same table, one click from the same table |
| 16 | `/leader/feedback` | delete | `/feedback` scoped by `student.programId` | Leaks other programs' ratings (`leader/feedback/page.tsx:18-27`) |
| 17 | `/sales` | delete | `/admin` scoped | 100% duplicate |
| 18 | `/sales/students` | delete | `/students` scoped | 100% duplicate |
| 19 | `/mentor` | reshape | **Mentor inbox** (§6.2) | 634 lines, 7–8 blocks, 2 embedded forms |
| 20 | `/mentor/sessions` | move | `/sessions` (lens default `mentor=me`) | THE ledger for every role; delivers TODO batch 1 |
| 21 | `/mentor/students/[id]` | merge | `/students/[id]` | Second hand-built ordering of the same parts |
| 22 | `/mentor/feedback` | merge | `/feedback` (mentor lens) | Hand-rolled list beside an existing one |
| 23 | `/mentor/onboarding` | merge | `/onboarding` | Third "enter your name" form |
| 24 | `/mentors/[id]` | reshape | one mentor page, three views by viewer (§6.9) | Self-edit forms → `/settings`; the student view becomes a card that says yes |
| 25 | `/student` | reshape | **Student home** (§6.3) | Remaining stated 3× above the fold; 13-entry unpaginated history; nothing states what she owes |
| 26 | `/student/book` | reshape | the only per-mentor time surface (§6.5) | 8 dead cards; the subtitle promises a Telegram route the page lacks |
| 27 | `/student/feedback` | reshape | one form, merged history (§6.6) | Website card cut; ISO dates |
| 28 | `/student/onboarding` | merge | `/onboarding` (gains the PENDING step) | The PENDING wall lives on `/student` today (`student/page.tsx:42-58`) |
| 29 | `/api/auth/[...nextauth]` | keep | — | — |
| 30 | `/api/avatar/[id]` | keep | serves every role once the upload gate lifts | — |
| 31 | `/api/cron/deadline-reminders` | keep | becomes the **only** caller of `ensureDeadlineReminders` | Also runs on GET of 3 pages today (`admin/page.tsx:42`, `mentor/page.tsx:121`, `student/page.tsx:24`) |
| 32 | `/api/cron/weekly-digest` | keep | reads `NotificationPreference` after Phase 7 | — |
| 33 | `/api/email/unsubscribe` | keep | writes the `WEEKLY_SUMMARY` preference row | — |

### 2.2 New routes (10 pages, 1 handler)

`/students` · `/students/[id]` · `/mentors` · `/programs` · `/programs/[id]` ·
`/programs/[id]/students` · `/programs/[id]/settings` · `/sessions` · `/sessions/new` ·
`/feedback` · `/settings` · `/settings/platform` · `/onboarding` · `/student/meetings` ·
handler `/n/[id]` (marks a notification read, then 302s to its destination, so rows are real
anchors and middle-click works).

That is 14 new pages against 5 deleted and 9 merged/moved away — net 23. `/programs/[id]` keeps
tabs (Overview · Students · ⚙ Settings); `/sessions` has two tabs on one route
(`?view=logged|scheduled`); `/settings/platform` is one page of sections.

### 2.3 Redirects, with an expiry date

Phase 6 checks in a `next.config.ts` `redirects()` map: every moved route → its new address, 308
permanent. In the same commit, notification producers stop choosing role-prefixed hrefs
(`notify.ts:81-90`) and emit role-neutral ones. **Stored `Notification.href` rows are never
rewritten** — the redirect map covers them. Phase 8 deletes the map after one released version;
the deletion is a listed commit, not a someday.

---

## 3. The Admin | Mentor switch

Kept, as decided, and given a job it can do honestly.

- **Visible.** A two-segment `Segmented` control in the staff sidebar (`brand-soft` active segment,
  never orange), `aria-keyshortcuts="Alt+M"`, tooltip "⌥M"; a labelled row in the account sheet on
  phones. The active profile is readable without opening anything.
- **A cookie, not a route tree.** `profile=admin|mentor`, httpOnly, set by a `setProfile()` server
  action that revalidates. Every shared page reads it, which fixes the mode leak where they fall
  back to `user.role` (`notifications/layout.tsx:14`, `mentors/[id]/layout.tsx:19`).
- **It changes exactly four things:** (1) which home `/` resolves to (`/admin` or `/mentor`);
  (2) the sidebar item set; (3) the default filter on `/students`, `/sessions` and `/feedback`
  ("Just mine" vs "All in my programs"); (4) which action is *primary* on an entity page
  ("Log a session" in mentor lens, "Allocate time" in admin lens).
- **It never removes a control and never changes your place.** `/students/[id]`,
  `/mentors/[id]` and `/programs/[id]` always render the **union of the viewer's rights**
  (`canManageStudent ∪ mentorReaches`). ⌥M on an entity page repaints the rail and re-orders two
  buttons; the URL does not move and nothing disappears mid-task. This kills the counterpart map
  (`profile-switch.tsx:57-67`) and the fallback-to-the-other-home (`:108-110`).
- **Authority never comes from the lens.** `authz.ts` decides what a person may do to an object.
  The lens decides emphasis. A server action ignores the cookie entirely.
- **Calm without hiding.** Admin-only actions on a shared entity page group behind one labelled
  **⋮ Manage** menu in the header (Allocate time · Approve · Move program · Remove student), so the
  header carries at most two primary buttons in either lens while every right stays one click
  away — the middle between hiding admin power and dumping the union on the page.

---

## 4. Shell and navigation

### 4.1 Staff, ≥ lg — a 220px fixed left sidebar

The horizontal bar is over capacity by its own admission ("Four things do not fit a 320px row",
`app-shell.tsx:171-173`) and has no entry for Programs, Sessions, Notifications or Settings
(`nav.ts:13-39`). Labelled text items, never icon-only. The main column widens from `max-w-5xl`
(`app-shell.tsx:219`) to `max-w-6xl`.

```
freshlog                        ← wordmark, brand blue
[ Admin | Mentor ]              ← dual-role only, ⌥M
Find a student or mentor…       ← submits to /students?q= or /mentors?q=
Inbox                     3     ← count = Needs-you rows
Students
Mentors
Programs                        ← collapses to the program's NAME when scope = 1
Sessions
Feedback
──────────
Notifications             4
⚙ Settings                      ← gear WITH the word
[avatar] Name                    ← menu: Settings · Platform · Switch profile · Help · Sign out
```

**Counts appear on exactly two items: Inbox (attention rows) and Notifications (unread).** No count
anywhere else in the chrome. Items come from `navFor(viewer, profile)`, derived from capabilities —
never from a static `NAV_BY_ROLE`.

Mentor lens: Inbox · Students · Sessions · Feedback. `ProgramStaff` level LEADER: Inbox · Students ·
Feedback · {Program}. Level SALES: Inbox · Students · {Program}.

### 4.2 Below lg

- **Staff, mentor lens:** bottom tabs **Inbox · Students · Sessions · Feedback**.
- **Staff, admin lens:** bottom tabs **Inbox · Students · Programs · More** (More is a sheet:
  Mentors, Sessions, Feedback, Settings, Switch profile). Admin is desktop-first and must not
  break; it does not.
- **Students, every width:** no sidebar ever — a student must never feel "accidentally let into an
  internal admin tool" (PRODUCT.md). A light top bar (wordmark · bell · avatar) plus a 4-item
  bottom tab bar below md: **Home · Meetings · Book · Feedback**. At ≥ md the same four become text
  links in the top bar. Student pages are `max-w-2xl`, centred. This retires the hidden `<details>`
  "Menu" (`app-shell.tsx:181-214`); NN/g measured hidden navigation at 27% use versus 48–50% visible.
- **Onboarding, PENDING and UNASSIGNED:** `PublicShell` — wordmark + sign out only. No nav that
  bounces the reader back (`book/page.tsx:35`), no bell.

### 4.3 Program context

There is no program switcher; programs are entities and filters, not silos. A reader knows which
program they are looking at from three places only: the program page's `h1` and breadcrumb, the
**Program** select in every `FilterBar` (mirrored in the URL), and the muted program suffix on
inbox and list rows. A scoped admin with one program sees that program's name in the sidebar
instead of "Programs".

---

## 5. The shared foundation

### 5.1 The typed status model — `src/lib/status.ts`

One file owns every state, its wording, its severity and its destination. Nothing else derives a
status: `flagsFor()` (`admin/programs/[id]/page.tsx:40-82`), `Deadline`, the three `PROGRESS_TONE`
maps, `INTERVIEW_STATUS_META`'s viewer-agnostic labels and 19 free-text `Chip` labels fold into it.

```ts
export type Severity  = "neutral" | "ok" | "attention" | "problem";
export type Kind      = "actionable" | "informational" | "blocked";
export type Audience  = "staff" | "mentor" | "student";

export type Status = {
  type: StatusType;          // stable string union, below
  severity: Severity;
  kind: Kind;
  label: string;             // ≤ 4 words, already resolved for this audience
  explanation?: string;      // ≤ 12 words, says what to do
  href?: string;
  subject?: { kind: "student" | "mentor" | "program"; id: string; name: string };
  program?: { id: string; name: string };
  at?: Date;                 // for ordering inside a severity band
  count?: number;            // set only on roll-up rows
};

export type ViewerContext = {
  audience: Audience;        // from role + lens, NOT authority
  userId: string;
  now: Date;                 // computed ONCE per request at the query layer
};

export function studentStatuses(s: StudentStatusInput, v: ViewerContext): Status[];
export function mentorStatuses(m: MentorStatusInput,  v: ViewerContext): Status[];
export function programStatuses(p: ProgramStatusInput, v: ViewerContext): Status[];
export function taskStatuses(t: TaskStatusInput,       v: ViewerContext): Status[];
export function sessionStatuses(s: SessionStatusInput): Status[];
export function meetingStatus(i: MeetingStatusInput,   v: ViewerContext): Status;
export function rollUp(list: Status[], opts?: { threshold?: number }): Status[];
export const SEVERITY_RANK: Record<Severity, number>;   // problem 0, attention 1, neutral 2, ok 3
export const EXPIRY_WINDOW_DAYS = { staff: 14, student: 30 } as const;
```

Rules: `now` is passed in and never read inside a component (this removes the
`Date.now()`-during-render class at `deadlines.ts:9-11` and `programs/[id]/page.tsx:74`). Severity
is the **only** thing that picks a colour; the glyph and the word always ride along
(`○` neutral · `✓` ok · `!` attention · `×` problem). A `blocked` state may render **one** `Callout`
per page; every other state is a chip, a row, or a figure tone. `rollUp` collapses more than three
statuses of the same type into one row — `"10 students have no time allocated →"` — which is what
keeps a first screen calm no matter what the data does.

| Type | Label — staff / mentor / student | Sev | Kind | Renders in |
|---|---|---|---|---|
| `STUDENT_PENDING_APPROVAL` | Pending approval / — / Awaiting approval | attention | actionable (admin) · blocked (student) | admin inbox (**Approve** inline), student workspace header, students table, onboarding step 3 |
| `STUDENT_NOT_SIGNED_IN` | Hasn't signed in | neutral | informational | students table, workspace header |
| `STUDENT_PLACEHOLDER_EMAIL` | Needs a real email | attention | actionable (admin) | admin inbox, workspace `FactList` |
| `BALANCE_OVERDRAWN` | Over by 2h 10m | problem | actionable (admin) · informational (others) | inboxes, workspace lead figure, tables, student home, allocation rows |
| `BALANCE_NONE` | No time allocated / — / Your team is setting up your time | attention | actionable (admin) · blocked (mentor: cannot log) · informational (student) | admin inbox, workspace, program overview, log-button reason |
| `POOL_UNASSIGNED` | 3h not with a mentor | neutral | informational | workspace Time section, `/student/book` state line |
| `NO_MENTOR` | No mentor yet | attention | actionable (admin) | workspace header, student home |
| `ALLOCATION_EXPIRING` | 4h 38m expires Sep 30 | attention | actionable (mentor: schedule · student: book) | inboxes, Up next, allocation rows, book rows, students table "Use by" |
| `ALLOCATION_EXPIRED` | 3h expired unused | problem | blocked (logging blocked) | workspace, student home, allocation rows, breakdown key |
| `MEETING_AWAITING_ANSWER` | Awaiting Aziz's answer / Awaiting student's answer / Needs your answer | attention | informational (mentor) · actionable (student) | mentor inbox, student home + Up next, timeline rows |
| `MEETING_CONFIRMED` | Confirmed | ok | informational | timeline rows |
| `MEETING_DECLINED` | Student can't make it / — / You can't make it | problem | actionable (mentor: move or cancel) | timeline rows, mentor inbox |
| `MEETING_UNLOGGED` | Meeting passed, nothing logged | attention | actionable (mentor: log) · informational (admin) | mentor inbox, admin inbox, Up next "Overdue", `/sessions?view=scheduled` |
| `MEETING_CLOSED` | Held · Cancelled | neutral | informational | scheduled ledger history |
| `SESSION_NO_SHOW` | No-show, time charged | attention | informational | session rows, receipts |
| `SESSION_LATE` | Came late | neutral | informational | session rows |
| `SESSION_EXTRA` | Extra, no time charged | neutral | informational | session rows, breakdown key |
| `SESSION_RESCHEDULED` | Rescheduled, no time charged | neutral | informational | session rows |
| `SESSION_VOIDED` | Voided, time returned | neutral | informational | session rows |
| `TASK_NOT_STARTED` / `TASK_IN_PROGRESS` / `TASK_DONE` | ○ Not started / ◐ In progress / ✓ Done | neutral / neutral / ok | informational | task rows |
| `TASK_OVERDUE` | Due Aug 10, not done | attention | actionable (mentor, admin) | inboxes, workspace tasks, student home |
| `TASK_OVER_BUDGET` | 1h 20m over budget | problem | informational | task rows |
| `TASK_NEEDS_MENTOR` | Needs a mentor / — / Mentor to be confirmed | attention | actionable (admin) | task rows, admin inbox |
| `BOOKING_LINK_MISSING` | No booking link | attention | actionable (mentor → Settings) · informational (admin, student) | mentor inbox, mentor page, mentors table, program settings, book rows |
| `MENTOR_UNASSIGNED` | Not in any program / Waiting for a program | attention | actionable (admin) · blocked (mentor) | admin inbox, mentors table, mentor inbox |
| `MENTOR_NAME_MISSING` | Name missing | attention | actionable (mentor) | onboarding gate, mentors table |
| `FEEDBACK_LOW` | Low rating | attention | actionable (admin: review) | admin inbox, feedback table |
| `PROGRAM_ARCHIVED` | Archived | neutral | informational | program header, programs list |
| `PROGRAM_NO_MENTORS` | No mentors | attention | actionable (admin) | program overview, programs list |
| `STAFF_UNSCOPED` | No programs granted | problem | blocked | admin inbox, as ONE line (replaces three copies of the "staff configuration" sentence) |
| `DIGEST_OFF` | Weekly email off | neutral | informational | `/settings` row only — never on a home |
| `ALL_CLEAR` | Nothing needs you | ok | informational | empty `AttentionList` |

**Notification categories** are the same vocabulary: `Notification.category ∈ {HOURS, SESSIONS,
MEETINGS, TASKS, ACCOUNTS, DEADLINES, FEEDBACK, WEEKLY}`, mapped from the 17 existing types
(`constants.ts:239-257`) inside `notify()`. Two missing producers are added: `FEEDBACK_RECEIVED`
(program staff, and the rated mentor anonymised) and `WEEKLY_SUMMARY` (an in-app row, so the email
toggle maps to something visible).

### 5.2 The primitive set — 75 component files → 51

Each primitive names its API and what it deletes. **A file merge only lands in the commit that
rewrites its call sites — never as a standalone tidy-up.**

#### Kept as-is or trimmed (22)

`ui/table.tsx` (`Table/Tr/Td label`) · `ui/pagination.tsx` · `select.tsx` (full ARIA combobox; gains
`searchable`) · `ui/field.tsx` (gains `size="compact"` and a `NativeSelect` export) ·
`ui/button.tsx` · `ui/submit-button.tsx` · `ui/meter.tsx` (tones `accent | danger`, gains
`segments`) · `ui/callout.tsx` (tones `info | warn | danger`, always with a glyph) ·
`ui/empty-state.tsx` (restructured, **no `action` slot**) · `error-state.tsx` ·
`forms/program-settings-forms.tsx` (rebuilt on `SettingsRow`) ·
`expandable-text.tsx` · `icons.tsx` (extended) · `hours-breakdown.tsx` (three fills) ·
`hours-ring.tsx` (**repaired**, see below) · `avatar.tsx` (3 tones; absorbs the `EntityMark` role) ·
`person-chip.tsx` (gains `PersonCell`) · `students-table.tsx` (presets) · `notification-list.tsx`
(anchor rows) · `rating.tsx` · `toaster.tsx` · `app-shell.tsx` (rebuilt).

#### New (29 files)

| Primitive | API | Replaces |
|---|---|---|
| `ui/status-chip.tsx` | `<StatusChip status={Status} size="sm\|md" />` — glyph from severity; **wraps** (`whitespace-normal`, no `nowrap`) | `chip.tsx` (5 tones, 19 free-text labels), `deadline.tsx`, the `notification-list` TONE pill, the `booking-link-form` amber pill, `RoleBadge`, 3 `PROGRESS_TONE` maps |
| `ui/figure.tsx` | `<Figure value unit label size="lead\|md\|inline" tone="ink\|hours\|danger\|muted" />`; **one `lead` per page** | `stat-card.tsx` (57 instances / 10 files), `ProgramIslandCard` `dl`, `HoursRing` centre text, 8 `PanelHeader` caption tallies |
| `ui/section.tsx` | `<PageTitle back? eyebrow? title lead? actions? />` · `<Section title count? action? children />` · `<Eyebrow />` | `ui/page-header.tsx` (12 gradient washes + monogram), `ui/panel.tsx` (4 tones), `ui/card.tsx` (0 imports), `LedgerBoard.GroupRule`/`ColumnHead`, 9 eyebrow class variants |
| `ui/link.tsx` | `<ArrowLink href label />` · `<ExternalLink icon label href />` | `arrow-link.tsx`, `telegram-handle.tsx`, `student-folder-link.tsx`, meeting/booking anchors, `→` text glyphs |
| `ui/segmented.tsx` | `<SegmentedRadio name options legend hint />` · `<TabLinks items count? />` (longest-match active) | `attendance-picker.tsx`, `time-kind-picker.tsx`, `program-tabs.tsx`, the `ProfileSwitch` segment, `MentorHoursFilter` pills, progress buttons — 6 implementations |
| `ui/popover.tsx` | `<Popover trigger origin>` on `useAnchoredPosition`; owns portal, outside-click, Escape | 3 mechanisms: `<details>` menus ×3, per-file portals |
| `ui/disclosure.tsx` | `<Disclosure label count? param? hint? defaultOpen?>` on native `<details>/<summary>`; one rotating chevron, count in the summary, optional URL param | 6 idioms: `<details>` ×2 hand-styled, `booking-link-form.tsx:73` "Show ▾/Hide ▴", `program-forms.tsx` "New program" **and** "+ Add a cohort" (same file, two shapes), `mentor-list.tsx:86` inline Edit |
| `ui/row-action-menu.tsx` | `<RowActionMenu trigger="dots\|pencil" label>` | 4 clone popovers (`allocation`/`assignment`/`interview`/`session-row-actions`, effect copied at L70-86 ≡ L85-101 ≡ L59-75 ≡ L78-94) |
| `ui/confirm-inline.tsx` | `<ConfirmInline label question confirmLabel action disabledReason? />` | 8 two-step confirms (`DangerButton`, `program-settings-forms.tsx:106-152`, promoted) |
| `ui/filter-bar.tsx` | `<FilterBar q selects presets dateRange summary reset />` — URL-preserving, output feeds a Prisma `where`; `q` per §5.5 | `ui/search-form.tsx`, `mentor-hours-filter.tsx` (322 lines), 3 filter cards |
| `ui/save-state.tsx` | `SaveState = idle \| editing \| unsaved \| saving \| saved{at} \| failed{retry}`; `useSaveState(action)` around `useActionState`; `useUnsavedChanges()` | `forms/action-feedback.tsx`, inline error spans |
| `ui/settings-row.tsx` | `<SettingsRow label description? control state />` | `own-name-form`, `booking-link-form` rows, `student-folder-form`, the digest panel, rename form |
| `ui/fact-list.tsx` | `<FactList items={[{label, value, change?}]} />` — GOV.UK summary list with inline **Change** + `SaveState` | `student-corrections.tsx` and `student-folder-form.tsx` as panels; header subtitle runs |
| `ui/receipt.tsx` | `<Receipt changed balance next />` | the ~60-word run-on success line (`sessions.ts:497-538`) |
| `attention-list.tsx` | `<AttentionList statuses groupBy="kind" cap={20} voice="staff\|student" empty="Nothing needs you." />` — problems first, roll-up applied | admin pending `Callout`, `flagsFor` panel, mentor booking pill, 4 student `Callout`s, "Awaiting assignment" box, the UNASSIGNED welcome card |
| `timeline.tsx` | `<Timeline items groups={["overdue","today","week","later"]} viewer />` · `<TimelineItem />`; items are meetings, use-by dates and task due dates | `scheduled-meetings.tsx` + violet `DateLeaf`, `LedgerBoard.UpcomingMeetingRow`, "Your diary" |
| `session-row.tsx` | `<SessionRow session variant="table\|timeline\|line" columns actions viewer />` · `<SessionsTable />` | `meetings-log.tsx` (mounted on 6 routes), `LedgerBoard.LoggedMeetingRow`, `student-journey.tsx`, the `/mentor/sessions` inline table |
| `task-row.tsx` | `<TaskRow task viewer actions />` · `<TaskTable />`; over-budget is danger everywhere, done is a `✓` chip with no wash | `assignments-panel.tsx`, `LedgerBoard.TaskRow`, `student-goals.tsx` `GoalCard`, the program page inline table |
| `allocation-row.tsx` | `<AllocationRow allocation person="mentor\|student" lead="remaining" actions? booking? />` | `mentor-hours-list.tsx` (the `2h 30m h left` double unit at `:77-79`), the "Time by mentor" table, the admin mentor table, `/student/book` card internals |
| `mentors-table.tsx` | `<MentorsTable rows />` | `forms/mentor-list.tsx` (inline edit + N+1 `ProgramTargetsPicker`) |
| `feedback-list.tsx` | `<FeedbackList rows showStudent? />` with `formatDate` + `ExpandableText` | `mentor-feedback-list.tsx`, the two hand-rolled copies on `/admin/feedback` and `/mentor/feedback` |
| `sidebar.tsx` · `tab-bar.tsx` | `navFor(viewer, profile) → NavItem[]`; `<Sidebar />`, `<TabBar />` | `nav-links.tsx`, `NAV_BY_ROLE`, the mobile `<details>` menu, the duplicated header DOM |
| `forms/session-forms.tsx` | `SessionFields`, `LogSessionForm`, `CorrectSessionForm` | `log-session-form.tsx`, `session-row-actions.tsx` |
| `forms/meeting-forms.tsx` | `MeetingFields`, `ScheduleMeetingForm`, `MoveMeetingForm`, `MeetingResponse` | `schedule-interview-form.tsx`, `interview-response.tsx`, `interview-row-actions.tsx` |
| `forms/hours-forms.tsx` | `AllocateTimeForm`, `CorrectAllocationForm`, `TaskForm`, `TaskPicker` | `assign-task-form.tsx`, `allocation-row-actions.tsx`, `assignment-row-actions.tsx`, `task-picker.tsx` |
| `forms/people-forms.tsx` | `AddStudentsForm`, `RegisterMentorForm`, `EditMentorForm`, `ProgramPicker`, `ApproveButtons` | `add-students-form.tsx`, `create-mentor-form.tsx`, `mentor-profile-form.tsx`, `program-targets-picker.tsx`, `approve-student-buttons.tsx` |
| `forms/profile-forms.tsx` | `NameField`, `TelegramField`, `AvatarField`, `OnboardingForm` | `own-name-form.tsx`, `onboarding-form.tsx`, `avatar-form.tsx` (crop pipeline moves in unchanged) |
| `forms/platform-forms.tsx` | `GrantsEditor`, `NewProgramForm` | `program-forms.tsx`, `STAFF_SEED` as a management surface |
| `forms/feedback-form.tsx` | one `FeedbackForm` (mentor only) | `feedback-forms.tsx` (both halves; the website half is deleted) |

#### Retired outright (53 files)

`arrow-link` · `assignments-panel` · `chip` · `deadline` · `ledger-board` · `meetings-log` ·
`mentor-feedback-list` · `mentor-hours-filter` · `mentor-hours-list` · `nav-links` ·
`profile-switch` · `program-dashboard` · `program-island-card` · `program-students-island` ·
`program-tabs` · `scheduled-meetings` · `stat-card` · `student-folder-link` · `student-goals` ·
`student-journey` · `student-ledger` · `telegram-handle` · `ui/card` · `ui/page-header` ·
`ui/panel` · `ui/search-form` · `forms/action-feedback` · `forms/add-students-form` ·
`forms/allocation-row-actions` · `forms/approve-student-buttons` · `forms/assign-task-form` ·
`forms/assignment-row-actions` · `forms/attendance-picker` · `forms/avatar-form` ·
`forms/booking-link-form` · `forms/create-mentor-form` · `forms/feedback-forms` ·
`forms/interview-response` · `forms/interview-row-actions` · `forms/log-session-form` ·
`forms/mentor-list` · `forms/mentor-profile-form` · `forms/onboarding-form` ·
`forms/own-name-form` · `forms/program-forms` · `forms/program-targets-picker` ·
`forms/remove-assignment-button` · `forms/schedule-interview-form` · `forms/session-row-actions` ·
`forms/student-corrections` · `forms/student-folder-form` · `forms/task-picker` ·
`forms/time-kind-picker`.

**Result: 22 kept + 29 new = 51 component files, from 75 — a 32% cut with 53 files retired.**
`forms/` alone goes from 28 files to 8: `session-forms`, `meeting-forms`, `hours-forms`,
`people-forms`, `profile-forms`, `platform-forms`, `feedback-form`, `program-settings-forms`.

#### `HoursRing`, repaired not deleted

`hours-ring.tsx:29` computes `remaining = allotted − used` and ignores forfeited, so on any student
with expired time the ring disagrees with the sentence beside it (`hours.ts:157`). **The fix is to
delete the ring's own arithmetic and pass `allocationSummary.remaining` in.** Promote that to a rule
for the whole reorg: *when two renderers disagree about a number, delete the one that recomputes it.*
It applies to every `StatCard`, `dl` strip and header tally that `Figure` replaces.

### 5.3 Long text — the systemic fix

Six recurring causes, none ever fixed system-wide. All six are closed; two are enforced by lint.

1. **`Chip` is `whitespace-nowrap`** (`chip.tsx:28`) with sentence-length labels ("Rescheduled, no
   time charged"). `StatusChip` wraps (`whitespace-normal text-pretty`); labels are capped at 4
   words by the status model and the ≤12-word explanation is a sibling line, not chip content.
2. **`truncate` on a flex child without `min-w-0`** never truncates (`ledger-board.tsx:156`).
   `scripts/check-copy.mjs` fails when a `className` has `truncate` and neither `min-w-0` nor
   `max-w-`.
3. **`ExpandableText` reached 3 of ≥9 free-text slots.** It now wraps every one — session and
   meeting notes, task purposes and notes, feedback comments, notification messages — `lines={2}`
   in rows, `lines={3}` in detail.
4. **Unbounded `Callout` bodies and panel captions** — bodies are one clause; captions become a
   typed `count` slot on `Section`.
5. **Bordered contact buttons inside subtitle prose** (`admin/students/[id]:158-184`) — contacts
   become quiet `ExternalLink` icons on their own line.
6. **7–9 column tables stacking to 9 labelled lines on a phone** — **every table is capped at 6
   columns**, a row stacks below `sm` (existing `Td label`), and no table scrolls sideways.

### 5.4 Disclosure — what may be collapsed, and what may not

Fifteen page specs above say `▸`. This is what `▸` is, and — more importantly — when a thing has
earned one.

Collapsing is the easiest way to make a page *look* calm while leaving its mess in place, so it
needs a rule rather than a habit. Six idioms exist in the code today for want of one: two
hand-styled `<details>`, `booking-link-form.tsx:73`'s `Show ▾` / `Hide ▴` text glyphs,
`program-forms.tsx`'s "New program" toggle **and** its "+ Add a cohort" link (one file, two
shapes), and `mentor-list.tsx:86`'s inline Edit. Left alone that becomes the fourth cluster of the
kind this plan exists to remove.

**The decision, in order. Stop at the first yes.**

| Ask | Then |
|---|---|
| Is it what the page is *for*? | **Show it.** Never collapse the primary thing. `/sessions/new` does not hide its fields. |
| Does it belong to a different question? | **Move it to its own address.** Not a disclosure — an address. This is how `/students`, `/sessions` and `/settings` came to exist. |
| Is it free text past its clamp? | **`ExpandableText`.** Notes, comments, task purposes. Never `Disclosure`. |
| Is it a menu of actions on one row? | **`RowActionMenu`.** ⋮ or pencil, a popover, not an expanding row. |
| Is it an occasional action *on this page's subject*? | **`Disclosure`.** "Add students ▸", "Register a mentor ▸", "Allocate time ▸", "New program ▸", "Add a cohort ▸", "Edit ▸". |
| Is it the finished, historical or settled subset of a list on the page? | **`Disclosure` with a count.** "Finished · 6 ▸", "History · 18 ▸", "Past sessions · 42 ▸". |
| Is it a fact you would only read when something is wrong? | **`Disclosure`.** The student page's "Details" (sign-in email, enrollment, folder, danger zone). |
| Anything else | It is noise. **Delete it.** |

**Rules for the primitive.**

1. **Native `<details>`/`<summary>`.** Keyboard and screen-reader behaviour arrives free, it works
   before hydration, and browsers now expand a closed `<details>` to reveal a find-in-page hit —
   which a `useState` version silently breaks. This is the one place the app prefers a native
   control without argument.
2. **A count whenever it hides countable rows**, in the summary, before it is opened:
   `Finished · 6 ▸`. Collapsing may hide the rows; it may never hide the magnitude. A count of zero
   renders no disclosure at all.
3. **The label names what is inside**, as a noun or an imperative — never "More", "Details" alone,
   or "Show". `Show ▾` is retired.
4. **One glyph**, a single chevron rotated by CSS on `[open]`, at 150 ms and zeroed under
   `prefers-reduced-motion`. Two text glyphs (`▾`/`▴`) are two states to keep in sync and neither
   is announced.
5. **Height is never animated.** Reflowing a table under the reader's cursor is worse than an
   instant open.
6. **No disclosure inside a disclosure.** Two levels of hidden is a page that needs splitting.
7. **`param` ties open state to a URL search param** (`?add=1`) for the ones worth linking to — the
   add-students and register-mentor forms, so "open this and add someone" is one link. Without
   `param` the state is local and forgotten on navigation, which is correct for everything else.
8. **A collapsed form still owns its fields.** `<details>` does not disable what it hides, so a
   `Disclosure` wraps a whole `<form>` and never half of one — otherwise a closed section keeps
   submitting.
9. **One per section, at most.** A section with two disclosures is two sections.

**What this retires:** `booking-link-form.tsx`'s toggle (the links move to `/settings` in Phase 7
and stop being a disclosure at all), both `program-forms.tsx` shapes, `mentor-list.tsx`'s inline
Edit (becomes `Edit ▸` on `/mentors/[id]`), and the two hand-styled `<details>` in `app-shell.tsx`
(become `Popover`, which is a menu, not a disclosure — §5.2).


### 5.5 Search — where it exists, and what it looks in

One free-text box, on the five lists where a person arrives already knowing a name or a word.
Today exactly two pages have one (`/admin/students`, `/admin/mentors`) and the rest are browse-only,
which is why "find the student who mentioned scheduling" is currently impossible.

| Page | `q` matches | Why |
|---|---|---|
| `/students` | student name, sign-in email | Arriving with a name is the common case. Exists today; kept. |
| `/mentors` | mentor name, email | Same. Exists today; kept. |
| `/sessions` | **session note, task purpose**, student name, mentor name | The notes are the richest free text in the product ("Trimmed 12 activities to 10 and reordered by impact"). Searching them answers "when did we cover the Common App?", which nothing can answer today. |
| `/feedback` | **comment text**, mentor name | How a theme is found — "scheduling", "late", "rushed" — instead of reading 38 cards. |
| `/notifications` | message text | Years of history accumulate at 50 a page; the category filter narrows the kind, `q` narrows the subject. |
| Sidebar (staff, mentor) | student **or** mentor name → `/students?q=` or `/mentors?q=` | Typing a name and getting nothing because you guessed the wrong list is the failure this avoids. Disambiguates when both match. |
| `Select` in a form | option label + its hint line | Already built (`select.tsx:73` `matches()`), with localStorage recents. The log-session student picker is the one that matters. |

**Deliberately no search:** `/programs` (three of them — a list you can read is not a list you
search), a student's own pages (13 sessions, 8 tasks; the tabs are the navigation), and tasks
cross-program (no such list exists, and none is proposed). Do not add a box a person would never
have a reason to type in — an empty control is noise with a placeholder.

**Rules.**

1. **Server-side, always.** `q` becomes part of the Prisma `where`, never a `.filter()` over rows
   already fetched. The program filter used to be exactly that mistake: showing one program cost
   the price of loading all of them.
2. **`?q=` in the URL**, so a search is a link a person can send and the back button undoes it.
3. **Submit, don't live-search.** Enter or the button. There is no index on these columns and every
   keystroke would be a table scan; a spinner that fires per character is also its own kind of
   noise.
4. **`contains`, trimmed, no `mode`.** SQLite's `LIKE` is case-insensitive for ASCII already, so
   `{ contains: q }` matches "aziza" to "Aziza" with no extra option — and Prisma's
   `mode: "insensitive"` is not supported on SQLite, so asking for it would be a runtime error.
   *Known limit:* ASCII only. A Cyrillic name would match case-sensitively. Acceptable while every
   name in the data is Latin script; the fix is a lowercased shadow column, and it is not worth one
   yet.
5. **Every `q` is an OR across its listed fields**, and combines with the other filters as AND.
6. **The result count is stated in words** next to the reset: `12 results for "aziza" · Reset`. A
   filtered list that does not say it is filtered is how someone concludes a student was deleted.
7. **A no-results state is not an empty state.** "No students match "aziza"." with a Reset — never
   the "No students yet" copy, which says something false.
8. **One box per page**, in the `FilterBar`, first position. Never two search fields on one screen.


### 5.6 Palette and tokens

The complaint in numbers: 12 chromatic hue families where the rule allows about 5; 24 identity
tokens (8 hues × 3); amber carrying five meanings and violet four on one screen; **106 raw Tailwind
palette classes across 41 files** (`text-red-700` ×36 in `.tsx`); `accent-ink` #f18d05 on white at
2.46:1; orange spent on ≥10 non-hours chrome elements.

**Keep** — `canvas #f4f5f6` · `surface #ffffff` · `line #e5e6e8` · `ink #1a2733` ·
`muted-fg #6b7480` · `brand #124b84` · `brand-dark #0e3c6a` · `brand-soft #e7eef5` ·
`accent #f18d05` · `accent-ink #f18d05` · `shadow-soft`.

**Add** — `warn-soft #fdf3de` · `warn-line #f2dcb0` · `warn-ink #8a5a08` (the old `log-*` hexes;
5.92:1 on white — the only amber that survives) · `danger #c10007` · `danger-soft #fef2f2` ·
`danger-line #ffc9c9` · `danger-ink #b42318` (already the email "lost" red) ·
`tone-teal-{soft,ink,dot} #dcefe6 / #175f4a / #2e8468` ·
`tone-plum-{soft,ink,dot} #f1e6ef / #6f2d68 / #8f4b88` ·
`tone-moss-{soft,ink,dot} #e8eedb / #485c1c / #5f7a2b` — all AA for ink-on-soft and white-on-dot.

**Retire** — `accent-ink-dark` (dead, 0 uses) · `accent-dark` · `accent-soft` (no orange button, no
orange wash, no orange ground remains) · `log-*` and `plan-*` as tints · all 24 `tone-*` tokens ·
`ProgramTone`, `PROGRAM_TONES`, `programTone()`, `personBanner()`, `PROGRAM_TONE_COUNT`
(`person-tone.ts`) · every `bg-gradient-to-br` wash (`page-header.tsx:87`) · every ghost monogram
(10 call sites) · `Panel` tones · `Chip` green and violet · `Callout tone="brand"` (which renders
orange) · all 106 raw palette classes.

**Eight rules.**

1. A hue never appears without its glyph or its word.
2. Orange = hours fills (`Meter`, `HoursRing` stroke, `HoursBreakdown` delivered) and ≥24px hours
   readouts (`Figure tone="hours"`). Never a button, chip, badge, tab, border, wash or role label.
   The 2.46:1 is a documented, accepted brand trade-off *at ≥24px only* — the owner has decided not
   to darken it, so it is never used at 10–15px.
3. Blue = chrome, links, primary action, focus, selection, unread. **Never a status.** The bell's
   unread count is `brand`, not `bg-red-500` (`app-shell.tsx:52`); sign-out hover is canvas/ink, not
   red (`:100,:206`).
4. Amber (`warn-*`) and red (`danger-*`) are the only chromatic status hues. `neutral` and `ok`
   share the neutral chip so "nothing wrong" is calm. **No green anywhere** — `ok` is a `✓` glyph in
   ink on a neutral chip.
5. Identity tones appear only on `Avatar`/`PersonChip`/`PersonCell`, from `User.toneIndex` (0-2).
   **Programs have no hue and no monogram** — a program is a place, not a person.
6. Two text tiers only: `ink` and `muted-fg`. No coloured eyebrows.
7. No gradients, tinted headers, watermarks, tilts or brand-tinted hover shadows. `shadow-soft` is
   for popovers only.
8. Every hairline is `line`. A section is separated by whitespace and at most one rule.

**The hours bar has three fills, not four:** delivered `accent`; missed-but-charged the *same*
accent as a 135° diagonal stripe; expired/overdrawn `danger`; remaining `line`. Today `bg-accent`
(35°) sits beside `bg-amber-400` (44°) — nine degrees apart, identical for deutan and protan
viewers (`hours-breakdown.tsx:59-66`). Legend swatches differ in **shape** as well as fill: filled
circle, striped square, ring.

**Guard rail:** `scripts/check-colors.mjs`, run from `npm run lint`, fails on any
`(text|bg|border|ring|stroke|fill|divide|outline|from|to|via)-(red|amber|green|emerald|yellow|blue|violet|purple|indigo|sky|cyan|teal|lime|orange|rose|pink|fuchsia|slate|gray|zinc|neutral|stone)-[0-9]`
under `src/`, with one allowlisted file for the Google logo (`login/page.tsx`).

### 5.7 Copy rules

1. **One noun each:** mentor · student · **session** (logged) · **meeting** (scheduled) · task ·
   program · cohort · booking link · time. Banned: *interview, diary, goal, assignment, allotment,
   enrollment, in-plan, pool, in flight, danger zone, staff configuration, active hours, Hrs*.
2. **One verb each:** Add (students) · Register (mentor) · New (program) · Log (session) ·
   Schedule / Move / Cancel (meeting) · Allocate / Correct (time) · Approve / Reject · Edit ·
   Remove · Archive.
3. **One label per quantity, one word for every reader.** The ledger has exactly three headline
   words and they are the same on every surface — student, mentor, admin, email:
   **Total** (what was granted) · **Completed** (what has been delivered) · **Remaining** (what is
   still there). No audience spelling, no synonyms. All of *Allotted, Allocated, Delivered, Left,
   "time left", "Still yours", "Hrs left", "you can book", "still to deliver", "X used"* go. The
   three quantities that are NOT the triple keep their own names and are never folded into it:
   **Missed** (charged, not delivered), **Expired unused** (forfeited), **Extra** (out of plan).
4. **A figure carries its unit once** — never `2h 30m h left` (`mentor-hours-list.tsx:79`),
   `16h 52m hours logged`, `45 min unused minutes` (`deadline-reminders.ts:94`).
5. **Status = word + glyph**, ≤4-word label, ≤12-word explanation, per audience: a student reads
   "You can't make it", never "Student can't make it" (`constants.ts:203`).
6. **Empty states are one sentence** — what is empty, what normally fills it. No "appears here"
   (×14 today), no "the form below", never red, **never an action button**.
7. **No eyebrow sentences.** Eyebrows are ≤2-word nouns or nothing; provenance eyebrows ("Logged by
   mentors", "Granted by an admin") die with the tints that justified them.
8. **Address the reader.** Students: "you / your". Staff: the student's name.
9. **"Program contact" is a named person with a link, or the phrase is dropped.**
   `programContact(programId)` → `{ name, email } | null` (the program's first `ProgramStaff(ADMIN)`,
   else the platform admin), at most once per page. Today it appears 5× with no name and no link.
10. **Dates and times.** `formatDate` everywhere, no ISO strings. "Use by" for an allocation, "Due"
    for a task, and a zone label on every meeting time: **"15:00 Tashkent"**.
11. **Receipts are structured:** what changed · balance now · one next action, ≤20 words.
12. **Titles are nouns** — no greeting in a staff `h1`, no category labels, no metaphors. One
    product name in chrome: **freshlog**; "Freshman Academy" only on the `/login` card.
13. **Plain declaratives.** The em dash is not the default connective (60+ uses today), and no
    hedging ("so check back soon", "the usual case").
14. **Prose budgets** (§6) are a PR-checklist item. What is mechanical is enforced:
    `scripts/check-copy.mjs` fails lint on the banned phrases — `appears here`, `appear here`,
    `lands here`, `newest first`, `Hrs`, `config/app-config.ts`, `still to deliver`,
    `Talk to your`, `program contact` outside `programContact()`, `.toISOString().slice` — plus the
    `truncate`-without-`min-w-0` pattern.

### 5.8 Save, freshness and recovery

`SaveState` is the one indicator: `idle | editing | unsaved | saving | saved{at} | failed{retry}`,
rendered `✓ Saved 12:04` in ink. Every `FactList` row, `SettingsRow`, booking link and inline editor
owns one and saves independently; `useUnsavedChanges()` warns before navigation. Errors stay
**inline beside the field**, `Toaster` only echoes, and after any mutation the page re-reads
server-derived values — no client-side hour arithmetic, ever. Freshness is chrome: the admin inbox
carries one muted `Updated 09:12` from the server render time, and no other page claims it, because
no other page has the plumbing.

---

## 6. The pages

Sections are listed **in order**. "Prose" is the maximum words of helper text in that section —
labels, figures and row content do not count. No page opens with a banner, wash, monogram or strip.

### 6.1 Admin inbox — `/admin`

Viewers: platform admin, program admin, `ProgramStaff` LEADER/SALES, dual in admin lens.
Core question: *is anything in my programs waiting on me right now?*

| # | Section | Content | Prose | Built from |
|---|---|---|---|---|
| 1 | Title row | `h1` "Inbox" · one muted line "3 programs · 41 students · 212h remaining" · `Updated 09:12` | 12 | `PageTitle` + `Figure inline` |
| 2 | Needs you | `AttentionList` grouped by kind, problems first: **Approvals** (pending signups, **Approve** inline) · **Time** (overdrawn, expiring ≤14d, expired unused, no time allocated) · **Meetings** (passed, nothing logged) · **Mentors** (not in any program, no booking link) · **Tasks** (overdue, needs a mentor) · **Feedback** (low rating). Row = `StatusChip` · subject · ≤12-word explanation · program (muted) · →. Cap 20, roll-up above 3 per type, then "N more →". Empty: "Nothing needs you." | 8 / row, 4 empty | `AttentionList` |
| 3 | Up next | Today / Next 7 days: meetings in scope (this is the first render of `ScheduledMeetings view="staff"`, implemented at `scheduled-meetings.tsx:48` and never used), use-by dates ≤7d, task due dates. ≤10 rows · "All scheduled →" | 4 | `Timeline` |
| 4 | Programs | One row per program in scope: name · students · mentors · remaining (`Figure inline`, danger if <0) · attention count · →. Hidden when scope = 1. No meter, no tilt, no hue, no monogram. | 0 | `Section` + `Table` |
| 5 | Recent | ≤5 read-only lines "Aug 30 · Malika logged 90 min with Aziz · Master's" · "All sessions →" | 0 | `SessionRow variant="line"` |

**Removed:** the banner + count sentence (`admin/page.tsx:77-79`), the orange "N mentors awaiting
assignment" pill (`:81-90` → a row), the amber approvals `Callout` (`:94-131` → group 1),
`StatCardGrid` (`:133-149`), the editable `MeetingsLog` (`:151-158`), `CreateProgramForm` (`:165` →
Platform), the `ProgramIslandCard` grid (`:167-199`). Zero grants → one line: `STAFF_UNSCOPED`.

### 6.2 Mentor inbox — `/mentor`

Core question: *who am I meeting this week, what needs my answer or a logged session, and who is
running out of time?* What a mentor sees on Monday morning, in three lines:

```
Inbox                                    12h 40m left across 6 students   [Log a session]
Needs you (3)   ! Meeting passed, nothing logged · Aziza Yusupova · Thu        Log →
                × 4h 38m expires Sep 30 · Nigel Brooks · Master's        Schedule →
                ! No booking link · Flexible Program                          Set →
Up next         Today 15:00  Lyusyena Petrosyan   ✓ Confirmed                 Join
                Thu 10:00    Sam Kim              ! Awaiting student's answer
```

| # | Section | Content | Prose | Built from |
|---|---|---|---|---|
| 1 | Title row | `h1` "Inbox" · lead `Figure` "12h 40m left across 6 students" · primary **Log a session** → `/sessions/new` (full width under the title below md, so it is the first thing a thumb finds) | 6 | `PageTitle` + `Figure lead` |
| 2 | Needs you | Meeting passed with nothing logged (→ `/sessions/new?meeting=`) · no booking link per pairing (→ `/settings`) · student expiring ≤14d or overdrawn with me · expired with me · overdue task assigned to me · awaiting the student's answer (informational) · pending approval (informational) · UNASSIGNED mentor sees one `blocked` row "Waiting for a program". Cap 10. Empty: "Nothing needs you." | 8 / row | `AttentionList` |
| 3 | Up next | Overdue · Today · Next 7 days: my meetings with status chip, zone-labelled time, Join link, and **Move / Cancel** in a `RowActionMenu` **only on my own rows** (today `InterviewRowActions` renders on every row, `scheduled-meetings.tsx:131-141`) · use-by dates ≤7d · "All scheduled →" | 4 | `Timeline` |
| 4 | Your students | ≤8 rows: `PersonCell` (one chip) · left with you · use by · last session · →. Program `SegmentedRadio` filter only when >1 program. "All students →" | 0 | `StudentsTable preset="mentor"` |

**Removed:** the greeting banner (`mentor/page.tsx:404-415`), six lifetime `StatCard`s
(`:417-436`), `ProgramToggleIsland` (`:438-458`), the recent-meetings log (`:470-477` →
`/sessions`), the 9-column table (`:381-392`), `BookingLinksForm` (`:589-599` → `/settings`),
`LogSessionForm` (`:601-632` → `/sessions/new`).

**Caseload is defined here, once — it is the loudest bug in the mentor's Monday.** "My students" =
`mentorReaches`: allocation ∪ ever-met ∪ `MentorAssignment` on the student's program (cohort-scoped
where set) — the rule already written four times (`interviews.ts:46-74`, `sessions.ts:229-275`,
`mentor/students/[id]/page.tsx:63-109`, `admin/students/[id]/page.tsx:93-106`). Rows sort "holding
time with you" first and a student with no allocation shows an em dash, **never dropped**. Today a
mentor with no allocations sees zero students while the picker offers eleven.

### 6.3 Student home — `/student`

Core question: *how much time do I have left, what do I need to do next, when am I meeting someone?*
Phone-first. **The first "Needs you" row must begin above 420px at 390×664** — verified by
screenshot in Phase 8.

| # | Section | Content | Prose | Built from |
|---|---|---|---|---|
| 1 | Title row | eyebrow program · `h1` "Hi, Aziza" · `HoursRing` **96px** beside the h1 (not a full-width hero), repaired to read `allocationSummary.remaining` · quiet "Book a session →" link | 6 | `PageTitle`, `HoursRing` |
| 2 | Needs you | Student-voiced: meeting awaiting your answer (with **I'll be there / I can't make it** inline — the one write on this page) · overdrawn · time expired · task overdue · time expiring ≤30d · no mentor yet · no calendars shared yet. Empty: "Nothing to do right now." | 10 / row, 5 empty | `AttentionList voice="student"` |
| 3 | Up next | Today / Next 7 days meetings, zone-labelled, with Join; task due dates ≤7d. Empty: "Nothing scheduled." (distinct from "nothing available") | 6 | `Timeline` |
| 4 | Your time | `HoursBreakdown` bar + a key of **delivered · missed · expired** only — remaining is the ring and is never stated twice | 4 | `HoursBreakdown` |
| 5 | Working on | In-progress and not-started `TaskRow`s (purpose, mentor chip, logged/budget `Meter`, due chip). "N finished ▸" as one collapsed line | 4 | `TaskRow` |
| 6 | Latest change | One line: the newest notification + "All notifications →" | 0 | `NotificationItem` compact |

**Removed:** the orange gradient hero and 120px watermark (`student/page.tsx:77-88`), the balance
sentence (`:96` — a third statement of one number), both red `Callout`s (`:139-152` → Needs you),
`StudentJourney` (13 unpaginated entries, ~1200px → `/student/meetings`), `MentorHoursList` (→
`/student/book`), the footer counts (`:126-135`). The PENDING wall (`:42-58`) → `/onboarding` step 3.

### 6.4 Student meetings — `/student/meetings` (new)

1. `PageTitle` "Meetings" — 0 prose. 2. **Coming up**: `TimelineItem` rows — date · mentor chip ·
zone-labelled time · status word · `MeetingResponse` (**I'll be there / I can't make it**) when
proposed, then a quiet "Change answer". Empty: "Nothing scheduled. Your mentors schedule meetings
here." — 8. 3. **Past sessions**: `SessionRow variant="timeline"` (the rail from `StudentJourney`
survives here) — date · mentor · minutes · task · note (`ExpandableText`) · one exception chip · a
quiet **Rate** link → `/student/feedback?mentor=`. Paginated 20. Empty: "No sessions yet." — 3.

### 6.5 Book — `/student/book`

1. `PageTitle` "Book a session" — 0. 2. One state row, only when needed: "No calendars shared yet.
Email your mentors below." / "3h not yet assigned to a mentor." — ≤12. 3. `AllocationRow` per
mentor **holding time or a booking link**, ordered by use-by: `PersonChip` · **13h 10m left** · thin
accent `Meter` · "Use by 30 Nov" (`StatusChip` soon/expired) · primary **Book** (brand blue,
`ExternalLink`) **or** muted "No booking link" + the mentor's **email as a `mailto` `ExternalLink`**.
An expired or overdrawn pairing shows the red state instead of a Book button. **Mentors with no
allocation and admin-only accounts are hidden**; a bookable mentor must have a full name.
0 prose.

This closes the product's worst dead end: 0 of 8 Master's pairings have a link, so today the page
is eight dashed placeholders under a subtitle promising a Telegram route it does not offer — with
"Freshman Academy Admin" offered as bookable (`book/page.tsx:66-70,152`).

### 6.6 Feedback (student) — `/student/feedback`

1. `PageTitle` "Rate a mentor" — 0. 2. One `FeedbackForm`: mentor `Select` (preselected from
`?mentor=`, limited to mentors with a session or an allocation), stars, comment, one line "Your name
isn't shown to the mentor." — 8. 3. "What you've said": one list by date — `PersonChip` · stars ·
`ExpandableText` · `formatDate` — 3. The website card and `WebsiteFeedback` are gone (decision 3).
A student with no profile is redirected to `/onboarding` instead of shown a raw red box
(`feedback/page.tsx:19`).

### 6.7 Student workspace — `/students/[id]`

Viewers: platform/program admin (full), LEADER/SALES (read + folder), mentor with reach (log,
schedule, own corrections), dual (union; lens sets which action is primary).
Core question: *how much time is left, with whom, until when — and what needs doing now?*

| # | Section | Content | Prose | Built from |
|---|---|---|---|---|
| 1 | Header | back "Students" · `h1` name · one line: Program › Cohort · email · Telegram · Folder as quiet `ExternalLink` icons · ONE `StatusChip` (highest severity; "Pending approval" carries **Approve** / **Reject** beside it for an admin) · actions: **Log a session** (enabled only when `mentorReaches ∧ ACTIVE ∧ (allocation ∨ pool)`, otherwise disabled **with its reason**), **Schedule a meeting**, and **⋮ Manage** (Allocate time · Move program · Remove student) | 0 | `PageTitle`, `RowActionMenu`, `ConfirmInline` |
| 2 | Needs attention | This student's statuses only; hidden when empty | 10 / row | `AttentionList` |
| 3 | Time | Lead `Figure` remaining (the only `lead` on the page; danger + the word "over" when negative) · `HoursBreakdown` · then `AllocationRow` per mentor and the unassigned pool: mentor · left · used of total · use-by chip · ⋮ (Correct · Remove). A mentor viewer's own row is first and labelled "you". "History · 18 ▸" = the `HourAllotmentChange` audit, paged 20 | 8 | `Figure`, `HoursBreakdown`, `AllocationRow` |
| 4 | Up next | `Timeline` Overdue · Today · Next 7 days, with **Move / Cancel** for the owning mentor and **Log** (prefilled) on an overdue row | 0 | `Timeline` |
| 5 | Sessions | `SessionsTable`, last 10, all mentors: date · mentor · minutes · task · note (`ExpandableText`) · exception chip only · ⋮ (own sessions; admin all) · "All sessions with this student →" (`/sessions?student=`) | 3 | `SessionsTable` |
| 6 | Tasks | `TaskTable`: task · mentor (or "Needs a mentor") · logged/budget + thin `Meter` · due chip · progress glyph · ⋮. "Finished · 6 ▸" collapsed | 0 | `TaskTable` |
| 7 | Details | Collapsed `FactList` (admin; LEADER/SALES see folder only): Sign-in email · Program / cohort · Folder · Telegram · Registered · Approval — each with inline **Change** + `SaveState`. "Remove student" with its blocked reason: "Can't be removed: they have logged sessions." | 12 (inside fields) | `FactList`, `SettingsRow`, `ConfirmInline` |

**On ≥ lg, sections 5 and 6 sit side by side in a two-column grid** (stacked below). That is how
the deleted `LedgerBoard` earns its keep: `DESIGN.md:88-94` prized holding both halves at once, and
a CSS grid preserves that reading while every session and task renders exactly once.

**Deleted here:** `LedgerBoard` and `StudentLedger` (every session and task rendered twice —
`ledger-board.tsx:135-184, 186-248` against `meetings-log.tsx:167-283` and
`assignments-panel.tsx:99-194`, over-budget red on one and amber on the other), the 5–8 `StatCard`s
(`student-ledger.tsx:64-95`), seven stacked `Panel`s in three tints, the approval `Callout`
(`:187-196`), `StudentFolderForm` and `StudentCorrections` as panels, and the fourth copy of the
reach rule (`:93-106`).

### 6.8 Students list — `/students`

1. `PageTitle` "Students · 41" · **Add students ▸** disclosure (admin/leader/sales; sales capture
amount paid where the program tracks it) — 0 prose (10 inside the disclosure).
2. `FilterBar`: search (name/email) · Program · Cohort · presets **Pending · Overdrawn · Expiring ·
No time · Not signed in** · **Mine** (default on in mentor lens) · "Showing 12 · Reset" — all URL
params, all in the Prisma `where`, never a `.filter()` over everything.
3. Table, **6 columns**: `PersonCell` (name, email, ONE chip) · Program (cohort as a muted suffix) ·
Left (danger if <0; muted "of 12h") · Use by (nearest; "· expired") · Last session · one icon cell
(Telegram, Folder). Mentor lens reads "Left with you". Default sort: attention first, then program,
name. Rows link to the workspace. 4. `Pagination` 25. Empty (no results): "No students match. Reset
filters." — 5.

This also fixes the missing forfeiture column: today a student at 0h because their time **expired**
is indistinguishable from one who used it (`students-table.tsx` omits `forfeitedMinutes`).

### 6.9 Mentor page — `/mentors/[id]`

One route, one file, three views by viewer. No tabs.

**Staff view:** 1. Header — name · email · programs as text · one chip · **Edit ▸** (name/email;
platform admin only when the target is another admin) — 0. 2. Needs attention (no booking link, not
in any program) — 8/row. 3. Students holding time, `AllocationRow` by use-by → workspace — 0.
4. Delivered — period `Select` (30 days / 90 days / all) · three `Figure`s (delivered · meetings ·
missed) · per-program rows without meters and **without the two footer sentences**
(`admin/mentors/[id]/page.tsx:306-341`) — 0. 5. Recent sessions (10) → `/sessions?mentor=` — 0.
6. One line "4.6 · 12 ratings →" — 0.

**Student view:** `Avatar` · name · programs in common · one blue **Book** per pairing with a link,
or the mentor's email as an `ExternalLink` — never a dashed placeholder · "Rate this mentor →".
≤20 words on the page. (Today this is a 56-word page that says "Book a session" three times and then
says no.)

**Self view:** the staff view minus admin actions, plus "Edit your profile and booking links →
Settings". The forms leave this page (`mentors/[id]/page.tsx:125-159`).

### 6.10 Mentors list — `/mentors`

1. `PageTitle` "Mentors · 12" · **Register a mentor ▸** disclosure — 0 (8 inside).
2. `FilterBar`: search · Program · presets **Unassigned · No booking link**.
3. Table: `PersonCell` ("Admin" as a muted text suffix, never a green chip) · Programs (plain text) ·
Booking links ("1 of 2 set") · Students holding time · one status chip. Unassigned first.
4. `Pagination` 25. **Removed:** the orange "Awaiting assignment" box
(`admin/mentors/page.tsx:95-125`), the always-open register form, per-row inline edit with its
N+1 `ProgramTargetsPicker` (`mentor-list.tsx:86-138`).

### 6.11 Programs list — `/programs`

Admin lens; the sidebar item collapses to the program's name when scope = 1.
`PageTitle` "Programs · 3" · **New program ▸** (platform admin) · `TabLinks` **Active · Archived** ·
one row per program: name · students · mentors · remaining · attention count · →.
**Prose 0. No monogram, no hue, no meter, no tilt.**

### 6.12 Program overview — `/programs/[id]`

Header: back · `h1` program name · one line "41 students · 6 mentors · 212h remaining"
(`Figure inline`, danger when negative) · `StatusChip` "Archived" when archived · actions
**Add students ▸** and **⚙ Settings** (gear *with* the word). Tabs: **Overview | Students | ⚙
Settings**.

1. Needs attention — `AttentionList` across the program's students and mentors; when empty, one
line "Nothing needs attention." — 3. 2. Up next — `Timeline`, 7 days, staff view — 0. 3. Mentors —
one line each: name · booking-link chip → mentor page; ≤10 then "All →" — 0. 4. "Last session Aug 30
by Malika · All sessions →" — 0.

**Removed:** the program-hue banner and 104px monogram (`layout.tsx:52`), the 4–6 `StatCard`s that
repeated the subtitle (`page.tsx:170-189`), the 12-row editable `MeetingsLog` (`:224`), the violet
"Tasks in flight" panel (`:233`), the duplicated Mentors list (`:334-356` ≡ settings `:173-197`).
The layout's `program.findUnique` + `studentsWithHours` and the page's identical pair are wrapped
in `cache()` so they run once (`layout.tsx:26-42` vs `page.tsx:97-107`).

### 6.13 Program students — `/programs/[id]/students`

Exactly `StudentsList` (§6.8) with the program fixed and the Program filter hidden; **Add
students ▸** on the right. This is where leaders and sales add students. 0 prose beyond the
disclosure's one sentence.

### 6.14 Program settings — `/programs/[id]/settings` (the gear the owner asked for)

| # | Section | Content | Prose |
|---|---|---|---|
| 1 | Mentors | One `SettingsRow` per pairing: name · cohort · booking-link chip · **Remove** (`ConfirmInline`). **Assign a mentor**: `Select` + button. This is the ONE write surface for pairings. | 0 |
| 2 | Cohorts | Rows with "12 students · 3 mentors" · Delete when empty · **Add a cohort ▸** with the flat-to-cohort rule as the disclosure's hint | 7 (inside) |
| 3 | Admins | **Read-only** list of this program's `ProgramStaff` rows with their level. Platform admin sees "Manage on Platform →". | 0 |
| 4 | Program | Name (`SettingsRow` + `SaveState`) · **Track amount paid per allocation** toggle (`Program.tracksPayment`, replacing the `MASTERS_PROGRAM_NAME` match at four sites) · **Archive program** (`ConfirmInline`: leaves every picker and home, keeps every ledger page reachable) | 10 |
| 5 | Delete | **Delete program** (`ConfirmInline`), only when empty, with a plain blocked reason and **never a file path** (`settings/page.tsx:83`, `programs.ts:153`) | 12 |

**Cut:** the "Enrolled students" removal panel — removal lives on the student's own page.

### 6.15 Sessions — `/sessions` (tabs) and `/sessions/new`

**`/sessions?view=logged`** (default): `PageTitle` "Sessions" · one filtered summary line
("96h logged · 3h missed · 2h extra") · `TabLinks` **Logged | Scheduled** · `FilterBar` (search: note,
task, student, mentor · Student · Mentor [staff] · Program · Date range · Attendance · Kind ·
Status · **Mine**) · `SessionsTable`
(Date · Student · Mentor · Duration · Task (ink, not violet) · Notes (`ExpandableText`) · exception
chip only — no "Logged" chip on every row · ⋮) · `Pagination` 25. Mentor lens defaults
`mentor=me`. **This is the admin ledger from TODO batch 1, and it replaces `MeetingsLog` on six
surfaces.**

**`/sessions?view=scheduled`**: `Timeline`, **Overdue** first · `FilterBar` (Status · Date range ·
Mentor · Student). Meetings keep their calendar shape and sessions their table shape — the
ahead/behind split `DESIGN.md` argues for, as two tabs instead of two tints. This is the staff
meetings destination that does not exist today (`ScheduledMeetings view="staff"` finally renders).

**`/sessions/new`** — a full page, because on a phone that is the difference between usable and not:
1. back · `h1` "Log a session" — 0. 2. Form: Student (`Select`, searchable, recents, prefilled from
`?student=`, showing "11h 20m left with you" underneath) · Task (`Select`: the student's open tasks,
then the presets, then "Something else", each option saying why it is relevant) · Minutes · Date ·
Attendance (`SegmentedRadio`, consequence line ≤8 words: "No-show still charges time.") · Kind
(`SegmentedRadio`: "Extra charges nothing.") · Note. `SubmitButton` with a **duplicate-submit
guard**; **values preserved on failure**; **errors adjacent to their field**; the draft is
reflected in the URL so a phone interruption or a back button does not lose it. Prefilled from
`?meeting=` when it discharges a `MEETING_UNLOGGED` row. — 16.
3. `Receipt` on success, replacing the form: "Logged 90 min with Aziz. 11h 20m left." ·
**Correct** · **Log another** · **Back to student** — 8.

### 6.16 Feedback — `/feedback`

Staff: `PageTitle` "Feedback" · one muted summary line · `FilterBar` (search: comment, mentor · Mentor · Program · Rating ≤ ·
Date range) · a compact mentors table (mentor · average as a number with small ink stars · ratings ·
lowest recent · last rated · `StatusChip warn` "Low" when the average <3.5 or any rating ≤2 in 30
days), **default lowest average first** (today it is ordered by rating *count*, which hides
low-rated mentors — `feedback.ts:26`) · one chronological list (`FeedbackList`) · one `Pagination`.
LEADER scope filters by **`student.programId`**, which closes the cross-program leak at
`leader/feedback/page.tsx:18-27`. Mentor lens: "4.6 · 12 ratings · anonymous" then rows, no strip.
The N+1 (2 queries per mentor, up to 25 — `feedback.ts:33-45`) becomes one grouped query.

### 6.17 Notifications — `/notifications`

1. Title row: `h1` "Notifications" · "4 unread" · **Mark all read** — 0. 2. `TabLinks` **All ·
Unread** + category `Select` (Time · Sessions · Meetings · Tasks · Account · Deadlines · Feedback ·
Weekly summary) — URL params, a server `where` on `Notification.category` — 0. 3. Rows as **real
anchors** `<a href="/n/[id]">` (marks read, then 302s to the destination, so middle-click works —
today each row is a `<form><button>` and every student href lands on the top of `/student`) : unread
`brand` dot · message (`ExpandableText`) · muted "Sessions · 2 h ago" · → . One `warn`/`danger`
chip only for missed, voided and deadline — 0. 4. `Pagination` 50. Empty: "Nothing new. Changes to
your time land here." — 8. 5. One muted line "Email preferences →" — 3.

**Removed:** the orange banner and 21-word blurb (`:66-71`), the second panel header (`:73-87`),
three statements of "newest first", the count stated four ways, and the digest form (`:111-137`).

### 6.18 Settings — `/settings`

`SettingsRow`s with per-row `SaveState`. 1. **Profile** — picture, full name (every role: the
`canActAsMentor` gate at `profile.ts:33-36,63-66,107-110` is lifted so students and non-mentor
admins finally own a name and a picture), sign-in email (read-only) — 0. 2. **Contact** — Telegram
(students; today captured once at onboarding and never editable) — 0. 3. **Booking links**
(mentors) — one row per pairing, program named, hint "Students book you through this link." — 6.
4. **Email** — weekly summary toggle, then the per-category in-app/email matrix (Phase 7), line "A
Monday summary of time used and deadlines." — 8. Reached from the sidebar gear and the account menu.
**40 words of hints on the whole page.**

### 6.19 Platform — `/settings/platform` (platform admin only)

1. `PageTitle` "Platform" — 0. 2. **Program access** — one table: person · level per program
(Admin / Leader / Sales) · **Edit** → inline `GrantsEditor` (program checkboxes × level select) ·
`SaveState` · **Add person** (any mentor, staff, or an email). Hint: "Program admins manage that
program's students, mentors and time." — 10. **The sole write surface for admin grants; it replaces
`STAFF_SEED` as the way admins are made** (decision 1), and §6.14 shows the same rows read-only.
3. **Programs** — name · status · students · Archive/Restore · **New program ▸** — 0.
4. **Organisation** — read-only: sign-up domain, email live/dry-run, cron last run — 0.

### 6.20 Onboarding and public pages

**`/onboarding`** — one gate, `PublicShell`, one `h1`, one sentence, one form, ≤12 words per branch:
"Your name" (mentor) · "Welcome to {Program}" (staff-registered student: name + Telegram) ·
"Complete your registration" (self-signup: name, Telegram, program, cohort) · **"Registration
received. An admin will approve you shortly."** (PENDING — moved off `/student`). Merges
`/student/onboarding` and `/mentor/onboarding` and kills the third "enter your name" form.

**`/login`** — `PublicCard`: wordmark · `h1` "Sign in" · `Callout danger` on `?error` · **Continue
with Google** · one line "Students use the email their program registered; staff use
@freshman.academy." (which resolves the contradiction between `login/page.tsx:9` and `:66`) — ≤20.
**`/unsubscribe`** — the same card, three states kept, `Button`/`LinkButton` primitives, a hairline
instead of the orange rule — ≤20.

---

## 7. Every contradiction, resolved

The completeness critic listed twelve cross-agent contradictions. All twelve are decided here; none
goes back to the owner.

| Contradiction | Decision |
|---|---|
| **Admin/mentor data model** (three incompatible proposals) | Explicit `ProgramStaff(userId, programId, role ADMIN\|LEADER\|SALES)` + `User.platformAdmin`. Scope comes from **explicit grants only**, never derived from `MentorAssignment` — derivation makes `setMentorAllocation`'s auto-pairing (`students.ts:786-797`) a privilege-escalation path, and would leave the admin who does not mentor with zero scope. Seeded once: every current ADMIN gets a grant for every program; tech@ becomes `platformAdmin`. `User.programId` is emptied and stops being read now, dropped in Phase 8. `Program.staff` becomes `ProgramStaff[]` and `deleteProgram`'s `_count.staff` guard (`programs.ts:139,150`) re-points at it in the same commit. |
| **LedgerBoard's fate** | Deleted. Its side-by-side reading survives as a two-column CSS grid on ≥ lg (§6.7). Every session and task is rendered once. |
| **Green as a status hue** | None anywhere. `ok` is a `✓` glyph in ink on the neutral chip. |
| **Blue as a status hue** | Never a status: chrome, links, primary action, focus, selection, unread. |
| **Program identity hue** | None. Name only; `PROGRAM_TONES`, `programTone()`, `personBanner()` and every program monogram are deleted, and there is no `Program.toneIndex`. |
| **Amber's survival** | One meaning: **attention** (`warn-*`, the old `log-*` hexes). Never a panel tint, an identity hue or a bar segment again. `text-amber-700` on "Missed" cells becomes `text-ink` (a labelled column is a fact), over-budget becomes `danger` (that *is* a problem), and a missed session is never softened — the chip reads "No-show, time charged" with an `!` glyph. |
| **Navigation shape** | Hybrid: 220px labelled sidebar ≥ lg, bottom tabs < lg for staff; students get a top bar plus 4 bottom tabs < md. Counts on exactly two items. |
| **Settings route name** | `/settings` (personal, every role) · `/settings/platform` · entity settings on the entity, reached by a gear **with the word "Settings"**. `/me`, `/mentor/settings`, `/account` and a renamed `/mentors/[id]` are rejected: one address per preference. |
| **`/mentors/[id]` audience** | One route, three views by viewer (§6.9): the student view survives and becomes useful (Book, contact, Rate), staff get the workspace at the same URL, LEADER keeps today's access. |
| **Mentor nav contents** | Inbox · Students · Sessions · Feedback, with Notifications and Settings in the sidebar footer. "My profile" as a nav item is gone. |
| **Recent sessions on the mentor home** | Cut (→ `/sessions`): the mentor logged them. The **admin** inbox keeps ≤5 read-only lines, because a cross-program admin has no other ambient view. |
| **Student history destination** | A **Past sessions** section of `/student/meetings`, paginated 20. No `/student/progress` or `/student/history`: the tabs are Home · Meetings · Book · Feedback, and Feedback stays a tab because decision 3 kept ratings first-class. |
| **Empty-state action buttons** | `EmptyState` has **no `action` slot**. An action never appears only because a list is empty; it lives in the section header, where it lives when the list is full. |
| **Interview time zone** | Keep the stored wall-clock (`format.ts:97-109` is deliberate), **label it** "15:00 Tashkent", and bucket today/overdue in `Asia/Tashkent` rather than UTC against the server clock (`interviews.ts:25-27`) — between 00:00 and 05:00 Tashkent, "today" currently reads as overdue. |
| **"Unassigned mentor" count queries** | One `mentorsNeedingSetup()` behind the status model feeds both surfaces; the two disagreeing queries (`admin/page.tsx:52-54`, `mentors/page.tsx:28`) collapse. |
| **Counts quoted in different units** | The audited figures of record: **106 raw palette occurrences across 41 files**, `text-red-700` **×36** in `.tsx`, **57** `StatCard` instances in 10 files, **75** components, **33** routes, **11** `requireRole(ROLES.ADMIN)` call sites (9 pages + 2 layouts, verified today). |
| **TODO.md vs code** | Rewritten in Phase 8. Batch 1's pagination and student search are already done; batch 2's `Date.now()`-in-render item closes with the status model's injected `now`. |
| **Deploy premise** | `autoDeploy: false`; hand deploys at milestones; `main` pushed continuously, one logical change per commit. The start command's `db:seed` is handled in §8.5. |
| **Docs vs decisions** | Phase 8 rewrites `PRODUCT.md`'s orange line, `DESIGN.md`'s Color and Components, `README.md`'s roles table, and regenerates `docs/guides/*.pdf` from `src/lib/brand.ts`, killing the third palette. |
| **MeetingsLog student link** | Fixed by construction: with one `/students/[id]`, the hard-coded admin link that bounced a plain mentor (`meetings-log.tsx:188-193`) cannot exist. |

---

## 8. Data, permissions and the things that break

### 8.1 Schema changes, in dependency order

Every migration is hand-written SQL under `prisma/migrations/<timestamp>_<name>/migration.sql`
(repo convention — Prisma's scaffolded SQLite redefinitions drop data; see the header of
`20260829110000_durations_in_minutes`). Rebuilds wrap in
`PRAGMA defer_foreign_keys=ON; PRAGMA foreign_keys=OFF; … ON`. Run `npx prisma migrate deploy`
against `prisma/dev.db` locally before pushing.

| ID | Phase | Change | SQLite shape |
|---|---|---|---|
| ~~**M1**~~ | — | ~~`User.toneIndex INTEGER`~~ **not needed** | `person-tone.ts` hashes the id in JS, so a stored column would only be a second source of truth for a value that is already stable and free. The 8→3 cut landed without it. |
| **M2** | 3 | `ProgramStaff` + `User.platformAdmin`, grants seeded, `User.programId` emptied | `CREATE TABLE "ProgramStaff" (id TEXT PK, userId TEXT NOT NULL, programId TEXT NOT NULL, role TEXT NOT NULL, createdById TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FK userId→User, FK programId→Program)` + `CREATE UNIQUE INDEX "ProgramStaff_userId_programId_key"` + `ALTER TABLE "User" ADD COLUMN "platformAdmin" BOOLEAN NOT NULL DEFAULT false;` + `INSERT INTO "ProgramStaff" … SELECT u.id, p.id, 'ADMIN' … FROM "User" u CROSS JOIN "Program" p WHERE u.role = 'ADMIN';` + `UPDATE "User" SET "platformAdmin" = true WHERE email = 'tech@freshman.academy';` + `UPDATE "User" SET "programId" = NULL;`. **Additive only — no table rebuild.** |
| **M3** | 6 | `Program.status`, `archivedAt`, `tracksPayment` | Three `ADD COLUMN`s with constant defaults (`status TEXT NOT NULL DEFAULT 'ACTIVE'`), then `UPDATE "Program" SET "tracksPayment" = 1 WHERE name = 'Master''s Program';`. No `createdAt`/`position`: SQLite forbids `CURRENT_TIMESTAMP` as an `ADD COLUMN` default, and programs order by name. |
| **M4** | 6 | `Notification.category`, `readAt` | `ADD COLUMN "category" TEXT NOT NULL DEFAULT 'OTHER'` + `ADD COLUMN "readAt" DATETIME` + the backfill `UPDATE … SET category = CASE WHEN type = 'HOURS_GRANTED' THEN 'HOURS' WHEN type LIKE 'SESSION_%' THEN 'SESSIONS' WHEN type LIKE 'INTERVIEW_%' THEN 'MEETINGS' WHEN type LIKE 'GOAL_%' THEN 'TASKS' WHEN type = 'HOURS_DEADLINE' THEN 'DEADLINES' ELSE 'ACCOUNTS' END;` + `UPDATE "Notification" SET "readAt" = "createdAt" WHERE read = 1;` |
| **M5** | 6 | Drop `WebsiteFeedback` | `DROP TABLE "WebsiteFeedback";` — decision 3. Its own migration, so the cut is one reviewable commit. |
| **M6** | 7 | `Assignment.deadline → dueNote`, `+ dueOn DATETIME` | `ALTER TABLE "Assignment" RENAME COLUMN "deadline" TO "dueNote";` (already used in `20260806170000`) + `ADD COLUMN "dueOn" DATETIME`. `setMentorAllocation` stops writing `formatDate()` text into the field (`students.ts:866`). This is what makes `TASK_OVERDUE` derivable — today two past-due tasks render neutral. |
| **M7** | 7 | `NotificationPreference` | `CREATE TABLE "NotificationPreference" (userId TEXT NOT NULL, category TEXT NOT NULL, inApp BOOLEAN NOT NULL DEFAULT true, email BOOLEAN NOT NULL DEFAULT false, PRIMARY KEY (userId, category), FK userId→User ON DELETE CASCADE)` + seed one `WEEKLY_SUMMARY` row per user from `User.weeklyDigest`. `weeklyDigest` is kept for one release for the HMAC unsubscribe path. |
| **M8** | 8 | Drop `User.programId` | The **only** table rebuild in the plan, and it is last: `User` has an FK on `programId` so `DROP COLUMN` is refused. Create `new_User` with every column named explicitly, `INSERT … SELECT`, drop, rename, recreate indexes, inside the `defer_foreign_keys` pragmas. By this point nothing has read the column for a release. |

### 8.2 `src/lib/authz.ts` (new)

```ts
adminScope(user): Promise<"ALL" | Set<programId>>   // React-cache()d; explicit grants only
staffLevel(user, programId): Promise<"ADMIN" | "LEADER" | "SALES" | null>
requireAdminAccess(): Promise<User>                  // any non-empty scope; replaces requireRole(ADMIN)
requireProgramScope(programId): Promise<User>         // notFound() when out of scope
canManageStudent(user, profile): Promise<boolean>
canManageProgram(user, programId): Promise<boolean>
canManageMentor(user, mentorId): Promise<boolean>     // shares at least one in-scope program
mentorReaches(user, profile): Promise<boolean>        // THE one reach rule (4 copies deleted)
assertProgramScope(actor, programId): ActionResult    // for server actions
```

`mentorReaches` collapses `interviews.ts:46-74`, `sessions.ts:229-275`,
`mentor/students/[id]/page.tsx:63-109` and `admin/students/[id]/page.tsx:93-106` into one function,
and it is the definition of caseload everywhere (§6.2).

### 8.3 Gates

**11 `requireRole(ROLES.ADMIN)` call sites exist today** (9 pages + `admin/layout.tsx:15` +
`admin/programs/[id]/layout.tsx:28`). Every one becomes `requireAdminAccess()` or
`requireProgramScope(id)`. **Every new page in §6 calls its own gate at the top of the page
function**, and each of the 14 new pages is counted as a gate site in Phase 6's checklist. A
permission-branching page (the three-view `/mentors/[id]`) gates first and branches second.

The 26 `actor.role !== ROLES.ADMIN` literals in server actions become scope checks, split across
three commits by file group so the money path is never in a diff with anything else:
students/programs (12 gates), mentors/assignments (7), sessions/interviews (7). `moveStudent`
requires **both** source and target in scope, or a program admin can poach students.
`updateMentor`'s name/email edits become platform-admin-only — once admins are peers,
`mentors.ts:174-176` is an account-takeover path. `createProgram` and every `ProgramStaff` write are
platform-only; `createMentor` is allowed when every target program is in scope.

### 8.4 One write surface for admin grants

`/settings/platform` › **Program access** is the only place a grant is created, changed or removed.
`/programs/[id]/settings` › **Admins** lists the same rows **read-only** with "Manage on
Platform →". `STAFF_SEED` shrinks to the bootstrap admin and is never again the way an admin is
made. This closes the only decision-compliance wobble in the winning proposal.

### 8.5 The seed, and why it must be one commit

`render.yaml:25` runs `db:migrate:deploy && db:seed && next start` on **every boot**, and
`prisma/seed.ts:44-60` upserts `role`, `programId` and `isMentor` from config. So a config-shaped
grant list would re-grant an admin the owner had just demoted on the next hand deploy — and a
`seed.ts` still writing `programId` fails to typecheck the moment the schema drops the relation,
which does not fail a test, it **fails the boot**. Therefore **M2, `prisma/seed.ts`,
`config/app-config.ts` (STAFF_SEED → tech@ only), the `deleteProgram` guard and the schema edit are
ONE commit.** Phase 8 then removes `db:seed` from `startCommand`, since staff now live in the
database.

### 8.6 Aggregates: the rule that protects the numbers

Two pages print a scope-wide "remaining" figure (§6.1, §6.12). Forfeiture is computed **per
allocation in JS** against each row's own deadline (`queries.ts:80-100`, `hours.ts:79-88`), and
`studentsWithHours` with a `slice` totals that page only. Therefore:

- **No UI aggregate may re-derive `remaining`** — not with a SQL `groupBy`, not with a second reducer.
- One tested helper: `programTotals(programIds: string[], now: Date)` in `src/lib/hours.ts`, reusing
  `studentsWithHours` **unsliced** per program and summing its per-student results, `cache()`d once
  per request. At the designed scale (5-10 programs, 100-300 students) that is the honest cost.
- It ships with vitest coverage in the same commit — one expired allocation, one overdraw, one EXTRA.
- `totals()` (`admin/page.tsx:24-34`) and its three copy-pastes (`programs/[id]/page.tsx:117-125`,
  `program-dashboard.tsx:35-43`, `program-students-island.tsx:26-32`) are deleted in its favour.

### 8.7 Notifications

`staffIdsFor(programId)` replaces `adminIds()` (`notify.ts:72-78`) at `sessions.ts:314,647,720,783`
and `students.ts:335-338`. It returns **platform admins ∪ that program's `ProgramStaff(ADMIN)`** —
which ends the fan-out that sends every session in every program to all ten admins, nine of whom
are mentors. Two producers are added (`FEEDBACK_RECEIVED`, `WEEKLY_SUMMARY`); the correction
template stops repeating unchanged fields ("now 2 hours on August 6 (was 2 on August 6)",
`sessions.ts:637` area). `ensureDeadlineReminders()` is removed from the three page GETs and the
cron owns it.

### 8.8 The import wall, handled by design

10 of 11 Master's students have logged sessions and **zero** `HourAllocation` rows, so a naive
attention list opens with twenty near-identical red rows. Whatever the owner decides (§10 q1), the
design does not demo as broken: `AttentionList` caps at 20 and `rollUp()` collapses more than three
statuses of one type into one row:

> `× 10 students have no time allocated · Master's Program →`

That row links to `/students?program=…&preset=no-time`. This is a decision, not a workaround: a list
of twenty identical facts is one fact.

---

## 9. Phases

Every step is one commit with a real message, pushed to `main` (repo cadence). Every phase is
independently shippable: at the end of each, `npm run lint`, `npx tsc --noEmit` and `npm run build`
pass, and the app is coherent. The owner deploys by hand at any phase boundary.

**The order is chosen so the noise drops first.** By the end of Phase 2 — before any route moves,
any permission changes, or any risky migration — the palette is calm, the stat strips are gone, the
washes and monograms are gone, long text is fixed system-wide, and all three homes answer their
question in three sections. Everything after that is structure.

### Phase 0 — Guard rails (3 commits)

1. `vitest` + `vitest.config.ts` + `npm test` script; first tests for `src/lib/hours.ts`
   (`allocationSummary`: forfeiture on an expired allocation, overdraw, no-show counted as used and
   missed, EXTRA excluded from every total, a voided session returning time, the ungranted-mentor
   derived row). **This is the first commit of the project and it lands before a single token
   changes** — the repo has zero test files.
2. `scripts/check-colors.mjs` + `scripts/check-copy.mjs`, wired into `npm run lint` as **warnings**.
3. `next.config.ts` `redirects()` skeleton, checked in empty, with the §2.3 policy as a comment.

*Verify:* `npm test` green; `npm run lint` prints the raw-class and banned-phrase counts (expect
106 and ~40).

### Phase 1 — Tokens, the status model, quiet chrome (13 commits)

4. `globals.css`: add `warn-*`, `danger-*` and the three identity tones; delete the 24 `tone-*`
   tokens, `log-*`/`plan-*`, `accent-ink-dark`, `accent-dark`, `accent-soft`. Add
   `src/lib/brand.ts` as the single hex source and import it in `email/layout.ts`.
5. `person-tone.ts` → 3 tones; delete `ProgramTone`, `PROGRAM_TONES`, `programTone()`,
   `personBanner()`, `PROGRAM_TONE_COUNT`. **M1** in this commit.
6. `src/lib/status.ts` + `src/lib/status.test.ts` (every type's severity, per-audience labels,
   `rollUp`, `SEVERITY_RANK`, the expiry windows).
7. `ui/status-chip.tsx`; migrate every `Chip` call site (green → `ok`/`neutral`, amber → `warn`,
   red → `danger`, violet → `neutral`); delete `chip.tsx` and `deadline.tsx`.
8. `ui/callout.tsx` → `info | warn | danger`, always with a glyph; the one-per-page ceiling.
9. `ui/section.tsx` (`PageTitle`, `Section`, `Eyebrow`) **and `ui/disclosure.tsx`** (§5.4: native
   `<details>`, count in the summary, one rotating chevron); delete `ui/panel.tsx`, `ui/page-header.tsx`,
   `ui/card.tsx`; remove the `tone` prop from 18 call sites and every wash and monogram.
10. `ui/figure.tsx`; replace all 57 `StatCard` instances; delete `stat-card.tsx`. One `lead` per page.
11. `hours-breakdown.tsx` three fills + shaped legend swatches; `hours-ring.tsx` reads
    `allocationSummary.remaining` (the disagreement dies).
12. `ui/empty-state.tsx` restructured with no `action` slot; delete the 6 inline `<p>` empties and
    the 3 raw red error paragraphs.
13. `expandable-text.tsx` applied to every free text (§5.3 item 3); `StatusChip` wrapping; the
    `min-w-0` sweep; every table capped at 6 columns.
14. `ui/link.tsx` (`ArrowLink`, `ExternalLink`); delete `telegram-handle.tsx`,
    `student-folder-link.tsx`, `arrow-link.tsx` and every `→` text glyph.
15. `programTotals()` in `hours.ts` + tests; delete `totals()` and its **four** copies (a fifth
    lived in `admin/programs/[id]/students`). It also returns `overdrawn` — a count no page shows
    yet, and the demo data is 10 of 11 students overdrawn behind a single grey "−20h 2m
    remaining". Two copies summed only `allotted` and `completed`, so their caption reads
    "83h 2m of 65h completed" once a program is over its grants; the caption goes in commit 40.
16. `check-colors.mjs` and `check-copy.mjs` to **error**.

*Verify:* zero raw palette classes, zero banned phrases, `npm test`, and screenshots of
`/admin/students/[id]` and `/student` at 390px and 1280px — the two 14-hue pages now carry two
chromatic statuses plus identity.

### Phase 2 — The three homes go quiet (5 commits)

No route moves. No migrations. This is the phase the owner is waiting for.

17. `/sessions/new` as a page: re-host the existing `LogSessionForm` (no rewrite), add the
    duplicate-submit guard, value preservation, adjacent errors, the URL draft, and `ui/receipt.tsx`
    with **Correct · Log another · Back to student**.
18. `attention-list.tsx` + `timeline.tsx` (built on the status model).
19. `/mentor` → §6.2: Needs you · Up next · Your students, `mentorReaches` as the caseload, the
    embedded forms and the six lifetime figures deleted.
20. `/admin` → §6.1: Needs you (with inline **Approve**) · Up next · Programs rows · Recent, the
    stat strip and editable log deleted.
21. `/student` → §6.3: ring beside the `h1`, Needs you with the inline meeting answer, Up next,
    Your time, Working on, Latest change; `StudentJourney` and `MentorHoursList` unmounted from the
    home (they still exist; they get their new homes in Phase 6/7).

*Verify:* sign in as admin, dual admin (both lenses), plain mentor, student; screenshot each home
at 390px and 1280px; confirm `/student`'s first "Needs you" row starts above 420px at 390×664.

### Phase 3 — Permissions and program scope (7 commits)

22. **M2 + `prisma/schema.prisma` + `prisma/seed.ts` + `config/app-config.ts` (STAFF_SEED → tech@
    only) + the `deleteProgram` staff guard, in ONE commit** (§8.5).
23. `src/lib/authz.ts` + `src/lib/authz.test.ts`.
24. Re-gate pages: 11 `requireRole(ROLES.ADMIN)` sites → `requireAdminAccess()` /
    `requireProgramScope()`.
25. Re-gate actions, group 1: `students.ts`, `programs.ts` (12 gates, `moveStudent` both-sides).
26. Re-gate actions, group 2: `mentors.ts`, `assignments.ts` (7 gates; name/email edits become
    platform-only).
27. Re-gate actions, group 3: `sessions.ts`, `interviews.ts` (7 gates; the money path alone in its
    own diff, with `hours.test.ts` green).
28. `staffIdsFor()` replaces `adminIds()`; delete `/leader/**`, `/sales/**`,
    `program-dashboard.tsx`, `program-students-island.tsx`.

*Verify:* `npm test`; sign in as platform admin, a one-program admin, dual admin, plain mentor,
student; an out-of-scope student page 404s and an out-of-scope action returns its error; running
`npm run db:seed` twice does not re-grant a demoted admin.

### Phase 4 — Shell and lens (4 commits)

29. `profile` cookie + `setProfile()` server action; `/` becomes a server `redirect()`;
    `homeFor(user, profile)`.
30. `ui/segmented.tsx` + `ui/popover.tsx`; `ProfileSwitch` rebuilt on them (visible, `brand-soft`,
    ⌥M guards kept from `profile-switch.tsx:80-119`); delete `profile-switch.tsx`, `nav-links.tsx`,
    `RoleBadge`.
31. `sidebar.tsx` + `tab-bar.tsx` + the utility cluster (bell count in `brand`, labelled gear,
    account menu, student search); `navFor(viewer, profile)` replaces `NAV_BY_ROLE`; `max-w-6xl`.
32. One `error.tsx` per shell (7 → 2); `PublicShell` for `/login`, `/unsubscribe` and onboarding;
    the minimal shell while PENDING or UNASSIGNED.

**Touch targets, measured at 390px** (found while consolidating the links in commit 14; `md`
buttons are already 44px, these are what is left):

| Control | Now | Where |
|---|---|---|
| Notification bell | 40px | every shell — `h-10 w-10` |
| `<Select>` | 40px | `/mentor` log form, every filter |
| RSVP `I'll be there` / `I can't make it` | 32px | `/student` — a student's only reply to an invite |
| `PersonChip` as a link | 40px | `/student/book`, program pages |

The RSVP pair is the one that matters: it is `size="sm"`, it is the primary action of the view on a
phone, and it sits next to its opposite, so a mis-tap declines a meeting. It becomes `md`.

*Verify:* ⌥M on a student page keeps the URL and removes no control; the bell and a mentor page no
longer flip the nav to Admin; 390px and 1280px screenshots of both shells; every control on
`/student` and `/mentor` measures ≥44px.

### Phase 5 — Shared renderers (6 commits)

Each commit replaces its whole cluster and rewrites its call sites.

33. `session-row.tsx` (`SessionRow`, `SessionsTable`); delete `meetings-log.tsx`,
    `student-journey.tsx` and the `/mentor/sessions` inline table.
34. `task-row.tsx` (`TaskRow`, `TaskTable`); one progress map; delete `assignments-panel.tsx`,
    `student-goals.tsx`.
35. `allocation-row.tsx`; delete `mentor-hours-list.tsx`. The `2h 30m h left` double unit this
    was written for went with the Phase 1 copy sweep — `mentor-hours-list.tsx:84` now reads one
    unit. What is left is the consolidation: four surfaces render an allocation four ways.
36. `ui/filter-bar.tsx` from `SearchForm` + `MentorHoursFilter` (URL → Prisma `where`) +
    `src/lib/filters.test.ts`; delete `ui/search-form.tsx`, `mentor-hours-filter.tsx`.
37. `ui/row-action-menu.tsx` + `ui/confirm-inline.tsx`; rebuild the 4 popovers and the 8 confirms;
    delete `forms/remove-assignment-button.tsx`; the four `*-row-actions.tsx` files fold into
    `forms/session-forms.tsx`, `forms/meeting-forms.tsx` and `forms/hours-forms.tsx`.
38. `person-cell` in `person-chip.tsx`, `ui/settings-row.tsx`, `ui/save-state.tsx`
    (+ `useUnsavedChanges`), `ui/fact-list.tsx`; delete `forms/action-feedback.tsx`.

*Verify:* every session, task and allocation renders through one component (grep for the deleted
names returns nothing); `npm test`; a keyboard-only pass over a row menu and a confirm.

### Phase 6 — Role-neutral routes and destinations (9 commits)

39. The `next.config.ts` redirect map filled in **plus** role-neutral hrefs from every producer
    (`notify.ts:81-90`) **plus** the `/n/[id]` handler — one commit, so no link ever points at a
    route that does not exist yet. No stored rows are rewritten.
40. `/students` (FilterBar, 6 columns, presets, pagination) and `/programs/[id]/students`.
    The 8 columns today are Student · Program · Telegram · Folder · Allotted · Completed · Missed ·
    Remaining. **Telegram and Folder merge into one `Contact` cell** — two columns that are an
    em-dash in most rows — and `Program` goes, because the page is reached from a program or
    carries a program filter. That is 6.
41. `/students/[id]` — the workspace (§6.7); delete `ledger-board.tsx`, `student-ledger.tsx`,
    `forms/student-corrections.tsx`, `forms/student-folder-form.tsx`, and both old student pages.
42. `/sessions` with both tabs (the TODO-batch-1 admin ledger) and the `MeetingsLog` mounts on six
    surfaces removed.
43. `/mentors` (`mentors-table.tsx`) and `/mentors/[id]` (three views); delete
    `forms/mentor-list.tsx`, `forms/create-mentor-form.tsx`.
44. `/programs` + `/programs/[id]` overview with `cache()`d shared reads; delete
    `program-island-card.tsx`, `program-tabs.tsx` (→ `TabLinks`).
45. `/programs/[id]/settings` + **M3** (`status`, `archivedAt`, `tracksPayment`) + `archiveProgram`;
    the `MASTERS_PROGRAM_NAME` match retired at all four sites.
46. `/feedback` (one page, three shapes, lowest-average-first, the leak closed, the N+1 collapsed) +
    **M5**; delete `mentor-feedback-list.tsx` and the website form.
47. `/notifications` + **M4** (category, readAt) + the category filter + `FEEDBACK_RECEIVED` and
    `WEEKLY_SUMMARY` producers.

*Verify:* every route in §2.1 resolves or 308s; a stored notification href from before the change
still lands correctly; screenshots of `/students/[id]`, `/sessions`, `/programs/[id]` at both widths.

### Phase 7 — Settings, platform, student app (6 commits)

48. `/settings` (profile for every role — the `canActAsMentor` gate lifted; Telegram; booking links
    out of the mentor home and the mentor page; the digest toggle out of the feed).
49. `/settings/platform` with the `GrantsEditor` as the sole grant write surface, the Programs
    section, and the read-only Organisation facts.
50. **M7** + the per-category notification matrix; `weekly-digest.ts` and both unsubscribe paths
    read the `WEEKLY_SUMMARY` row.
51. `/onboarding` (all four branches, including the PENDING step moved off `/student`); delete both
    old onboarding routes and `forms/onboarding-form.tsx`, `forms/mentor-profile-form.tsx`,
    `forms/own-name-form.tsx`, `forms/avatar-form.tsx` (its crop pipeline moves into
    `forms/profile-forms.tsx` unchanged).
52. `/student/meetings` (Coming up + Past sessions, paginated) and `/student/book` (§6.5, the email
    fallback, hidden non-mentors) and `/student/feedback` (§6.6).
53. **M6** (`dueNote` + `dueOn`) + `TASK_OVERDUE` live + `setMentorAllocation` writing a real date;
    `ensureDeadlineReminders` removed from the three page GETs; the `Asia/Tashkent` bucket fix and
    the zone label.

*Verify:* a student on a phone can answer a meeting, book, and rate a mentor; a mentor sets a
booking link and watches the inbox row disappear.

### Phase 8 — Copy, docs, cleanup, verification (6 commits)

54. Copy sweep against §5.7 — every grammar bug in the audit list ("Your mentoring time are all
    used up", "before your time appear", "Your time with them run to", "Extra — none of your used",
    "45 min unused minutes", the comma splice on `admin/page.tsx:79`), `formatDate` everywhere, one
    product name, `programContact()` wired.
55. Brand assets: `public/brand/` (favicon, apple-touch-icon, `logo.svg`), the five Next.js starter
    SVGs deleted, `docs/guides/generate-guides.cjs` importing `src/lib/brand.ts`.
56. `DESIGN.md` rewritten (Color, Components, the two rules from §1); `PRODUCT.md`'s orange line;
    `README.md`'s roles table; `AGENTS.md` gains the page-level-gate rule; `TODO.md` rewritten;
    `UX-IMPLEMENTATION-PROMPT.md` marked superseded by this file.
57. Delete the redirect map (one release after Phase 6) and the `db:seed` step from
    `render.yaml`'s `startCommand`.
58. **M8** — the `User` rebuild that drops `programId`.
59. **Verification pass.** `npm run lint`; `npx tsc --noEmit`; `npm run build`; `npm test`. Then per
    `.claude/skills/verify/SKILL.md`, sign in as **platform admin, program admin, dual admin in
    BOTH lenses, plain mentor, and student**, and capture screenshots at **390px and 1280px** of
    `/admin`, `/mentor`, `/students/[id]`, `/students`, `/sessions`, `/sessions/new`,
    `/programs/[id]`, `/programs/[id]/settings`, `/student`, `/student/meetings`, `/student/book`,
    `/notifications`, `/settings`. Run **keyboard-only** through *Log a session* and *Approve a
    student*. Confirm: no table scrolls sideways at 390px; no page shows two chromatic status hues
    other than warn and danger; every free text clamps with a working "Show more"; reduced-motion
    zeroes the staggered delays. **The audit produced zero rendered evidence at any viewport — this
    is the first time the owner's "long text not rendering right" is actually observed.**

---

## 10. Owner decisions — answered 2026-09-03

All six are settled. Where the answer differs from the recommendation above it, the owner's answer
governs and the reason it is safe is stated.

1. **Imported Master's data — LEAVE IT AS IT IS.** No backfill, no EXTRA re-marking, no new state,
   no wipe. The Master's ledger keeps reading `-20h 2m still to deliver` and `83h 2m of 65h
   completed`, and 10 of 11 students keep the `BALANCE_NONE` + `BALANCE_OVERDRAWN` statuses their
   rows honestly earn. This is survivable precisely because of §5.1 `rollUp()`: more than three
   statuses of one type collapse to a single row (`"10 students have no time allocated →"`), so the
   first screen stays calm without anyone inventing a balance. Do NOT add a special case for
   imported rows anywhere; the honest-ledger principle is doing its job.
2. **Money — every admin, everywhere it appears today.** Keep the figure on the admin dashboard,
   the program overview and the student page as well as on allocation rows and program settings. It
   still moves behind `Program.tracksPayment` (M3) rather than the `MASTERS_PROGRAM_NAME` string
   match, so renaming a program stops silently disabling billing. No SALES-only view is built.
3. **tech@ as a student-facing mentor — keep as is.** `tech@` stays `isMentor: true` and remains
   bookable. Note that two of the three symptoms disappear anyway: the `"Hi, Freshman"` greeting
   goes when Phase 2 deletes the greeting banner (`mentor/page.tsx:404-415`), and `/student/book`
   stops offering mentors with no allocation and no booking link (Phase 7). What remains by choice
   is the organisation's name owning ledger rows and appearing in the feedback picker.
4. **Platform admin — tech@ only.** Step 22's seed marks exactly one account. The accepted risk is
   that a lockout freezes program creation and grant-making; the escape hatch is one statement in
   the Render shell (`UPDATE "User" SET "platformAdmin" = true WHERE email = '…';`), which is why a
   second address is not required. Do not widen this without asking.
5. **DEPT_LEADER and SALES — keep as `ProgramStaff` levels with exactly today's powers.** Read the
   program, add students, and for LEADER see that program's feedback. No approving signups, no
   allocating time. Add nothing until a real person holds the role.
6. **Nothing else is cut.** Mentor ratings and the weekly digest email both stay, as specified.
   `WebsiteFeedback` remains the only removal (M5).

## 11. Out of scope (the post-redesign list)

Not in this plan, deliberately, and each for a stated reason. Do not fold them in.

- **`TaskType` table + `Assignment.taskTypeId`** — SQLite cannot `ADD COLUMN` with a foreign key, so
  it is a full rebuild of `Assignment`, whose rows live sessions point at. `TaskPicker` reading
  `TASK_PRESETS` loses the user nothing. Its own commit, later, behind a Platform section.
- **`Session.attendance` column** replacing `attended`/`late`/`RESCHEDULED`-in-status — it rewrites
  columns the ledger reads.
- **`MentorAssignment.calendlyUrl → bookingUrl`** and **`Interview.kind`** — naming hygiene with a
  migration attached.
- **Cohort dates and status**, `HourAllocation.source`, `ReminderLog`, the `Feedback` table merge.
- **A mentor Telegram field.** The email fallback in §6.5 works today with no schema change. If
  students should reach mentors on Telegram, that is a `User` column plus a `/settings` row.
- **Per-user time zones.** The stored wall-clock plus a "Tashkent" label is the smallest honest fix.
- **Saved views as a persistence model** — URL presets only, per the brief.
- **A staff-management system beyond grants** — the brief forbids it, and §8.4 is the minimum
  decision 1 requires.
