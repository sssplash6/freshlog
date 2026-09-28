# UI/UX Audit & Reference — freshform ("freshlog" / Freshman Academy)

**Generated:** 2026-09-27 · **Method:** five parallel static audits of `src/` against `PRODUCT.md`, `DESIGN.md`, `REDESIGN.md` (the binding spec) and `AGENTS.md`. Everything below is source-derived — no runtime, browser, or assistive-technology pass was performed; findings marked "verify" need a live check.

**Purpose of this document:** a complete memory of the UI as it actually is — every screen, component, token, copy string and rule — plus a severity-graded list of where it drifts from its own spec. Use it as context when iterating on the UI so design decisions stay consistent with the system's own contract.

---

## Product in one paragraph

A mentoring-hours ledger for Freshman Academy. Five roles share one site: **staff** (admins, department leaders, sales — desktop, mid-task), **mentors** (@freshman.academy accounts — log sessions, check totals, read anonymous feedback), and **students** (external clients applying to universities abroad — check remaining hours, book mentors via Calendly links, leave feedback). Admins grant per-mentor hour pools keyed `(student, program, mentor)`; sessions draw them down; EXTRA work charges nothing; no-shows charge and tally "missed"; deadlines are hard and unused minutes are forfeit; every change is audited and notified. `ProgramExchange` lends a student from one program to another under a minute cap — the host program's ledger carries the rows, stamped `exchangeId`, and every membership label must say "(on exchange)". Brand voice: warm, encouraging, dependable — a supportive coach with a tidy ledger. The stated anti-references: SaaS stat-tile dashboards, LMS density, marketing gloss, gamification.

## The two design rules everything obeys

1. **One `h1`, one lead figure, hairlines.** No banner washes, no stat strips, no tinted panel headers. A section is a title, an optional count, an optional action, one rule.
2. **Status is a word with a glyph.** Four severities (`neutral`/`ok`/`attention`/`problem`), two chromatic hues (warn amber / danger red), a glyph on every chromatic chip. Callers pick a severity; severity picks the colour. **There is no green** — "nothing wrong" is a ✓ on a neutral chip.

Colour semantics: `brand` blue = actions/chrome/focus/unread, **never** a status. `accent` orange = hours and progress **only**. Person tones (teal/plum/moss) and program hues (indigo/cyan/violet/slate — dot + label only) are identity, not state. Three lint guards enforce the system: `check-colors.mjs` (no raw Tailwind palette classes), `check-copy.mjs` (banned phrases, date formats, truncate rules), `check-spacing.mjs` (vertical rhythm scale). `npm run lint` runs all three.

## Route map

| Route | Role(s) | Section |
|---|---|---|
| `/` | all (redirect) | §11 |
| `/login` | public | §11 |
| `/unsubscribe` | public (HMAC link) | §11 |
| `/onboarding` | settling-in users | §11 |
| `/admin` | staff | §13 |
| `/mentor` | mentors (+ dual-role admins) | §19 |
| `/student` | students | §12 |
| `/student/book` | students | §12 |
| `/student/feedback` | students | §12 |
| `/student/interviews`, `/[id]`, `/people/[id]` | students | §12 |
| `/students`, `/students/[id]`, `/students/[id]/allocate` | staff + mentors (scoped) | §14 |
| `/mentors`, `/mentors/[id]` | staff + self + shared-program students | §15, §12 |
| `/programs`, `/programs/[id]` (roster/settings/allocate) | staff (program-scoped) | §17 |
| `/sessions`, `/sessions/new` | staff + mentors | §20 |
| `/feedback` | staff + mentors | §21 |
| `/notifications` | everyone | §22 |
| `/analytics` | staff + mentors | §23 |
| `/settings`, `/settings/platform` | everyone / platform admin | §16 |
| `/n/[id]` (handler), `/api/*` | — | §18, §22 |

Foundations (tokens, chrome, primitives, responsive, a11y, motion, long-text, hierarchy, status model, icons, spec conformance) live in §1–§10.

## Consolidated findings — what to fix first

Severity: **Critical** = blocks/misleads users or breaks the product's trust promise; **High** = degrades a class of users or misreports a figure; **Medium** = real inconsistency/spec violation, bounded blast radius; **Low** = polish/drift. Full tables with `file:line` evidence live at the end of each section.

### Critical

| # | Issue | Where |
|---|---|---|
| C1 | **`/student/meetings` doesn't exist** — the "All meetings" link (`student/page.tsx:386`) and the unconfirmed-session attention row (`attention.ts:648`) both 404 into a bare framework page. The student's session history — the place to verify hours charged against them — is unreachable. | §12 |
| C2 | **`SessionAnswerForm`/`answerSession` are orphaned** — the confirm/dispute flow ("Did this happen?" → yes / something's wrong) is fully built with actions and notifications but mounted on no route. The ledger's core trust promise has no UI. | §12, §20 |
| C3 | **LEADER/SALES program grants confer full admin power.** The grants editor promises "reads the program" but `adminScope` counts every `ProgramStaff` row as full scope and `staffLevel` only composes nav — never refuses a write. A "Sales" grantee can allocate hours, edit students, delete the program. Check `SELECT role, COUNT(*) FROM ProgramStaff GROUP BY role` in prod. | §16 |

### High

| # | Issue | Where |
|---|---|---|
| H1 | **Audit trail is deleted, not appended.** `removeMentorAllocation`, `returnExchange`, `rejectStudent`/`deleteStudent` delete `HourAllotmentChange` rows — after which History silently claims completeness it no longer has. | §18 |
| H2 | **History capped at 20 with misleading count** — `take: 20` then `<Disclosure count={changes.length}>` reports the slice as the total; the 21st change is unreachable. | §14, §18 |
| H3 | **Forfeited minutes invisible where staff read balances** — no use-by column or forfeited figure on staff allocation rows; an expired grant reads "Remaining 0" identically to a spent one. `HoursBreakdown` omits forfeiture by design; only the capped bell names it. | §14, §18 |
| H4 | **Zero-grant staff see "0 programs · 0 students"** on `/admin` — the `STAFF_UNSCOPED` sentence exists in the status model but renders only on `/notifications`; "the school is empty" vs "you hold nothing". | §13 |
| H5 | **"Remaining with you" mislabels the mentor roster** — it sums every mentor's grants in every program, not the viewer's own tally. | §14 |
| H6 | **Program surfaces under-report computed totals** — `programTotals()` yields `missed`/`forfeited`/`extra`/`overdrawn` that never render; §6.11's attention column is absent; the Overview tab was removed so program attention lives only behind the global bell. | §17, §18 |
| H7 | **No account-level status on the student home** — `BALANCE_NONE`/`NO_MENTOR`/expiring/forfeited exist only on `/notifications`; a zero-balance student sees "0m remaining" plus three empty sections with no explanation. | §12 |
| H8 | **Analytics shows every mentor every mentor's school-wide hours with `#1 of N` rank framing** — a peer leaderboard inside the calm/quiet product; combined with density (year drill + 365-cell heatmap + rankings + chips) it's the largest deviation from "no noise". | §23 |

### Themes worth holding while iterating

- **The system works; the drift is at the edges.** Tokens, one-renderer-per-thing, a typed status model, and three lint guards mean most findings are "spec vs shipped" mismatches rather than design failures. Fixes are usually *wiring existing pieces* (mount `SessionAnswerForm`, render `STAFF_UNSCOPED`, add the route REDESIGN already specifies).
- **The bell swallowed the homes.** Moving "Active issues" off all three homes into `/notifications` was deliberate — but `/admin` and `/mentor` are both titled "Inbox" while containing no inbox, the student home shows nothing when empty, and program pages lost their attention block entirely. The consolidation overshot in three places.
- **Forfeiture is the quiet casualty.** The one number that makes this product honest — time lost to deadlines — is computed everywhere and rendered almost nowhere for staff. Any iteration on balances should name forfeited minutes.
- **Spec vs shipped vocabulary.** REDESIGN self-contradicts on program hues; "Super admin"/"Admin" drift; "Danger zone" survives a banned-phrase list; "Inbox" labels pages without inboxes. Copy rules need a check-copy.mjs update more than they need willpower.
- **a11y is engineered, not verified.** Persistent live regions, real radios under custom controls, `aria-sort`, focus trapping, re-stepped dark tokens — all correctly wired in source; all flagged for a real screen-reader/keyboard pass. No skip link exists.

---

## 1. Design foundations

This audit is based on static inspection of the repository at `/Users/doston/projects/freshform` — `DESIGN.md`, `REDESIGN.md`, `PRODUCT.md`, `src/app/globals.css`, the shared component layer under `src/components/`, the status/format/filter libraries under `src/lib/`, and the route tree under `src/app/`. No build, test, lint, or guard script was run; everything below describes what the source declares, not observed runtime behaviour.

**Palette.** The palette is deliberately small — five chromatic families plus a neutral grey scale — and lives once, as Tailwind v4 `@theme` tokens in `src/app/globals.css:9-131`:

- Grounds and hairlines: `canvas #f4f5f6`, `surface #ffffff`, `line #e5e6e8` (globals.css:10-12).
- Text: `ink #1a2733`, `muted-fg #6b7480` (globals.css:51-52).
- `brand #124b84` with `on-brand #ffffff`, `brand-dark #0e3c6a`, `brand-soft #e7eef5` — structural chrome, links, primary actions, focus, selection, and the unread state. Explicitly never a status (globals.css:14-22; REDESIGN.md:575-577).
- `accent #f18d05` with `accent-dark #ed7a2d`, `accent-soft #fdebcf`, `accent-ink #f18d05` — hours and progress only (globals.css:24-26, 47-49).
- Status, two chromatic severities only: `warn-soft/line/ink #fdf3de/#f2dcb0/#8a5a08` for "attention, nothing lost" and `danger #c10007` + `on-danger`, `danger-soft/line/ink #fef2f2/#ffc9c9/#b42318` for "a problem — hours gone or balance negative" (globals.css:28-46). `neutral` and `ok` deliberately share the neutral chip; there is no green anywhere (REDESIGN.md:578-580, 1002-1005).
- Identity: three person tones — teal, plum, moss — each in `soft`/`ink`/`dot` triples (globals.css:73-83), assigned per person via `User.toneIndex`/`src/lib/person-tone.ts`, hue-separated from every semantic colour so a person chip can never be mistaken for a status (globals.css:54-64).
- Program identity: four hues — indigo, cyan, violet, slate — same triple shape, permitted only as a dot and label via `ProgramDot`/`ProgramChip`/`src/lib/program-tone.ts` (globals.css:85-101). This is the documented September 2026 amendment to the original "programs get no hue" rule (REDESIGN.md:582-592).
- Elevation: three brand-tinted shadow steps — `shadow-sm` resting card, `shadow-lg` floating menu/popover, `shadow-xl` modal (globals.css:103-117).
- Type: Geist Sans/Mono via `--font-sans`/`--font-mono` (globals.css:119-120).
- Motion tokens: `--ease-out-strong`, `--ease-in-out-strong`, `--ease-nav`, and a 150ms default transition duration (globals.css:122-130).

The same hexes are duplicated as values in `src/lib/brand.ts` for the two consumers that never see the stylesheet (email `layout.ts`, PDF guide generation); the file header documents the edit-both-places contract (brand.ts:1-18).

**Dark theme.** A complete re-stepped token set under `:root[data-theme="dark"]` (globals.css:163-222): each token is re-chosen for the dark ground rather than inverted — soft washes deepened, inks lightened, dot fills unchanged, shadows re-derived in black alpha. Because every component reads semantic tokens (enforced by `check-colors.mjs`), dark mode is this one block with zero `dark:` variants in `src/`. `color-scheme` is set correctly in both themes, and `theme-light-only`/`theme-dark-only` utility classes let `ThemeToggle` render without duplicating state in React (globals.css:227-230). Opt-in via `data-theme`, so it does not affect users who never toggle it.

**Density.** The root font size steps to 94% from `sm` upward (globals.css:250-254) — every size is rem-relative so this is the app's zoom — while phones keep full size to protect 44px targets. Breakpoints are unaffected since media-query rems are always 16px.

**Global baseline.** `html` sets `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation` (no double-tap delay anywhere), `overscroll-behavior-y: contain` (defers Android pull-to-refresh to the app's own), and `scroll-padding-top: 4.5rem` so `#session-x` anchor targets land below the sticky bar; `body` sets `100dvh`, `overflow-x: clip`, and the canvas background so overscroll never flashes white (globals.css:256-288).

**Vocabulary and figures.** The ledger's headline words are fixed as **Total / Completed / Remaining** for every reader (`check-copy.mjs:40-47` bans `Allotted|Allocated|Delivered|Left` in label positions). Missed, Expired unused, Extra, and Overdrawn remain distinct secondary quantities. A **session** is logged; a **meeting** is scheduled; tasks and agenda are two different things (`student-tasks.ts` split). Number formatting is centralised in `src/lib/format.ts`: `formatMinutes` for a single record ("90 min"), `formatDuration` for roll-ups ("18h 20m"), `formatRough` for orientation figures that round *down* and take a "+" ("130+ hours" — the comment at format.ts:34-54 explains why overstating is worse than being long), `formatMoney`, `formatDate` (spelled-out months, year only when not current), `formatAgo`, `formatDateTime`. `toDateInputValue` is the only permitted ISO conversion (format.ts:103-109; enforced by check-copy).

**Enforcement.** Three guard scripts run hard in `npm run lint` (package.json:9): `check-colors.mjs` fails on any raw Tailwind palette class in `src/` (sole allowlist: the Google mark on the login page), `check-copy.mjs` fails on banned phrases, machine dates in UI, trailing `→` link glyphs, and `truncate` without `min-w-0`/`max-w-`, and `check-spacing.mjs` fails on any vertical step off the three-value scale (`space-y-4` between blocks, `py-2.5` section headers, `py-2` inside sections). This is the mechanism that keeps the small palette and the rhythm from drifting back. Whether they currently pass was not verified — `npm run lint` was not executed.

## 2. App chrome & shared primitives

**Shells.** `src/components/app-shell.tsx` is one component with three presentations chosen by role, not by route tree: `StaffShell` (fixed 13.75rem rail ≥lg + bottom `TabBar` <lg + sticky `TopBar` <lg + a fixed top-right `NotificationMenu` at ≥lg), `StudentShell` (no rail at any width — a deliberate PRODUCT.md requirement that a student never feel "accidentally let into an internal admin tool"; inline top-bar nav ≥md, tab bar <md, `max-w-2xl` measure), and `PublicShell` for users still settling in (pending approval, missing name/Telegram — `settlingIn`, app-shell.tsx:432-448). The lens comes from the cookie, never from the route, fixing the old bug where a dual-role admin saw admin chrome regardless of working lens (app-shell.tsx:450-459). Navigation is derived by `src/lib/nav.ts` from actual scope — a scoped admin sees their one program's *name* instead of a Programs list, and a person with no grants gets a minimal nav rather than empty destinations. Inbox is the only rail count; the bell carries its own unread count, and the two are deliberately never on screen together (the bell badge hides ≥lg where the rail already states it — app-shell.tsx:50-55).

**Top bar.** `TopBar` (app-shell.tsx:224-276) is sticky, frosted (`bg-surface/80` + `backdrop-blur-xl backdrop-saturate-150`), safe-area aware on all four edges, and gains its hairline only once content scrolls beneath it (`data-scrolled`, toggled by `PhoneChrome` past 6px). Its `vt-topbar` view-transition name keeps it still during page pushes (globals.css:709-733). Contents: `BrandWordmark` (with a hover-reveal version tag via `rise-in`), the notification bell at a true 44px (`h-11 w-11`, `aria-label="Notifications (N unread)"`, brand — not red — count capped at "99+"), and the account `Popover`.

**Account menu.** A real `Popover` replacing a `<details>` that never closed on Escape and left focus stranded (app-shell.tsx:89-101). Contains identity header, `ProfileSwitchMenu` for dual-lens users (kept here rather than the tab-bar More sheet because the mentor lens has no More sheet — app-shell.tsx:153-161), Settings, Platform (platform admins only), My profile (mentors), `ThemeToggle`, and a sign-out whose hover is `danger-soft`/`danger-ink`.

**Page scaffold.** `src/components/ui/section.tsx` supplies the whole vocabulary: `Eyebrow`, `PageTitle` (one `h1`, optional back link/eyebrow/subtitle/avatar/actions, on the page ground with no wash or masthead), and `Section` (rounded surface, hairline border, divided header band, optional count/action). `Figure`/`FigureRow` (`ui/figure.tsx`) give lead/normal/inline figure sizes where `hours` is the only coloured tone — and inline hours fall back to ink because the orange fails small-text contrast.

**Buttons and links.** `ui/button.tsx`: `primary` (brand fill), `secondary` (surface + hairline), `ghost`, `danger` (quiet), `dangerSolid`; sizes xs/sm/md with `md` ≈44px. Orange is never a button colour. `LinkButton` defaults `transitionTypes={["nav-forward"]}` so forward navigation animates as a push. `check-copy.mjs` bans trailing `→` glyphs as link affordances; `ArrowLink`/`ExternalLink` own that pattern, and a `→` *between* values ("2h 30m → 4h", or `from → to` program chips in `exchange-panel.tsx:68-71`, marked `aria-hidden`) remains legal because it denotes change, not navigation.

**Tables.** `ui/table.tsx` renders a hairline-header table ≥`sm` and *stacks rows into labelled lines* below it — `<thead>` hides, `Td` repeats its column label in a `sm:hidden` eyebrow span (table.tsx:114-127). The header comment documents the reasoning: a sideways-scrolling table hides every field but the first behind an unsignposted swipe (table.tsx:23-37). `Tr` carries `deal-in` entrance; `Column.sort` produces `SortHeader` links that encode order in `?sort=`/`?dir=` with `aria-sort`. The wrapper retains `sm:overflow-x-auto` (table.tsx:52) — see Issues.

**Rows and folds.** `session-row.tsx` is the single session renderer (log/timeline/line variants) replacing four divergent versions; `task-row.tsx` is the single agenda/task row (`table`/`list`/`line`), whose header records the pre-redesign disagreement — over-budget amber in one place and red in another — and the rule that settled it (task-row.tsx:23-44). `RowFold` (`ui/row-fold.tsx`) collapses a phone row to its headline cell plus one figure — e.g. the roster folds to name + remaining balance (students-table.tsx:187-207) — with `aria-expanded`, ≥44px trigger, hidden ≥`sm`; cells opt out via `data-fold` (globals.css:669-678). `RowActionMenu` standardises the ⋮/pencil overflow that used to be four cloned popovers.

**Forms.** `ui/field.tsx` gives one input chrome — labels, hints, required markers, `aria-invalid` errors — with `text-base` on mobile so iOS never zooms on focus, plus `GrowingField`, a mirror-span auto-growing textarea. `ui/submit-button.tsx` derives pending state from `useFormStatus` (spinner, disable, `aria-busy`, pending text). `ui/save-state.tsx` centralises `idle | editing | unsaved | saving | saved | failed` with fixed precedence; both live regions are mounted persistently from first render (save-state.tsx:144-149 — the reason the old inline `role="status"` announced inconsistently), success is an ink `check-draw` check rather than green, failure is `role="alert"` in `danger-ink` with a 44px "Try again". `ui/confirm-inline.tsx` is the two-step destructive pattern: quiet danger → filled danger, focus moved to the confirm button, Escape reverts, explicit consequence wording, disabled reasons supported. `ui/switch.tsx` is a native checkbox under custom visuals with `peer-*` styling (and a 4ms Android `navigator.vibrate` tick, switch.tsx:36-37). `select.tsx` is a full ARIA combobox/listbox — arrow/Home/End/PageUp/PageDown, typeahead, search once ≥6 options, single tab stop, hidden form input — which becomes a bottom sheet on phones. `ui/date-field.tsx` is a keyboard-operable calendar grid. `forms/dictate-button.tsx` records ≤120s, converts to 16kHz mono WAV, posts to `/api/notes/dictate`, and surfaces recording/processing/error states — the recording dot is `animate-pulse` `bg-danger`, errors are `role="alert"`, and the button label itself carries the state ("Stop 0:12", "Tidying…", dictate-button.tsx:120-145).

**Disclosure, filtering, paging.** `ui/disclosure.tsx` and `expandable-note.tsx` use native `<details>` so they work before hydration. `ui/filter-bar.tsx` keeps search + Apply visible, folds secondary filters into a named disclosure that auto-opens when filters are active, and is URL-driven throughout — every filter state is shareable, and `lib/filters.ts` owns the param vocabulary (`FILTER_PARAMS`, `PAGE_PARAMS`, `SEARCH_LABEL`/`SEARCH_PLACEHOLDER` per surface, `DATE_PRESETS`, `filterSummary`). `ui/segmented.tsx` is deliberately two shapes off one track: `SegmentedRadio` for form choices at 44px even in the dense popover variant (segmented.tsx:30-43 — the comment explains a mis-tap in a correction popover is the costliest tap in the app) versus `TabLinks` for URL filters at 32px (`min-h-8`, segmented.tsx:44-60 — documented tradeoff: a wrong tap on a filter costs nothing). `ui/pagination.tsx` is prev/next + "x–y of n units · page p of q" in an `aria-live="polite"` line, `aria-disabled` ends.

**States.** `ui/empty-state.tsx` distinguishes a healthy empty, a filter-produced `no-results`, and a `blocked` condition — copy is banned from saying "appears here" (check-copy.mjs:29). `error-state.tsx` backs the two-boundary error contract: `app/error.tsx` sits *above* the shell (because the shell queries the DB itself and a boundary beneath it could only re-render the thing that threw — error.tsx:5-21), and `global-error.tsx` replaces the root layout with its own `<html>`/stylesheet. `page-skeleton.tsx` is an `animate-pulse` skeleton, `aria-hidden`.

**Identity.** `person-chip.tsx` defines exactly three shapes chosen by *position*, never by person type (REDESIGN.md:594-604): `PersonCell` when the person is the row, `PersonChip` when the person is a value inside a row, `PersonBadge` for face-only. All truncate with `min-w-0`, carry the stable per-user tone, and link where the reader may open the profile. `program-chip.tsx` is a coloured dot + label; a linked program underlines only the name.

**Hours visualisations.** `hours-ring.tsx` is the student's lead figure — used+forfeited sweep, remaining in the centre, overdraw in `danger`, an sr-only sentence for the SVG, and remaining passed in explicitly (never derived as allotted−used). `hours-breakdown.tsx` draws allotted total as the track, completed in accent, missed-but-charged as the same accent diagonally striped, and *overdraw outside the track* in danger — the geometry itself says overdraw is not part of the grant; expiry is excluded because it belongs to a grant+deadline, and the legend doubles as the numeric readout. `ui/meter.tsx` is the small progress bar with `bar-grow` and proper `aria-valuenow/max/label` wired at every call site (verified: allocation-row.tsx:263-265, task-row.tsx:282-284, student/page.tsx:84-86). `ledger-board.tsx` puts Meetings and Tasks side-by-side ≥lg with the Agenda full-width below, each pane independently scrolling at ~40svh.

**Attention and feed.** `attention-list.tsx` renders the derived `Status[]` list — grouped by `STATUS_GROUP_LABELS` when the list is long enough to earn headings (status.ts:125-230, worst-severity-first), with per-row action slots (e.g. `ApproveStudentButtons` inline on `/notifications`, notifications/page.tsx:135-150). `notification-list.tsx` splits unread/read under an "Earlier" divider; the whole row is a plain `<a>` to `/n/[id]` — deliberately not `next/link`, because prefetching would mark rows read on hover (notification-list.tsx:48-60) — with a per-type label chip, actor `PersonBadge`, and `formatAgo` timestamp. `/notifications` is the *only* place either half lives (notifications/page.tsx:21-37).

**Feedback.** Read-only `Rating` renders `★`/`text-line ★` with `aria-label="N out of 5 stars"` (rating.tsx:4-9); the feedback form uses `StarIcon` buttons. `receipt.tsx` renders `ActionReceipt` (headline + notes + subject) after mutations. `toaster` keeps two live regions — `role="status"` for info/success, `role="alert"` for errors.

## 3. Responsive behaviour

- **Tables never scroll sideways on phones.** Below `sm` every table becomes stacked labelled lines (§2); the `data-fold` CSS additionally lets rows collapse to headline + one figure (globals.css:669-678). The `sm:overflow-x-auto` escape hatch on `Table`'s wrapper applies only *above* the phone breakpoint.
- **Six-column cap** by convention — `task-row.tsx:105-114` documents merging student+mentor into one `people` slot and logged/budget into one `hours` slot specifically to reach six.
- **Custom overlays become sheets on phones.** `select.tsx` and `popover.tsx` render `sheet-up` bottom sheets with safe-area padding and keyboard-offset (`--kb`) below the `useMediaQuery` breakpoint (which uses `useSyncExternalStore` to avoid a wrong first frame), and `use-anchored-position.ts` flips/clamps the desktop variant against the viewport. `use-swipe-down.ts` dismisses sheets on a 72px drag or downward flick while handing scroll back to the list when it isn't at top.
- **Safe areas everywhere**: top bar pads all four insets including landscape `max()` gutters (app-shell.tsx:255-265), tab bar clears the home indicator, main clears the bottom bar (`pb-24`).
- **Touch**: `touch-action: manipulation` kills double-tap delay; the bell and all `md` controls are 44px; `text-base` inputs prevent iOS zoom; horizontal chip strips use `scroll-x` with an edge fade and a gesture-layer exclusion so a chip fling can't arm swipe-back (DESIGN.md:399-401).
- **Dynamic viewport**: `100dvh`, `svh` ledger panes, `--kb` for the software keyboard.
- **Density**: the 94% root zoom applies only ≥`sm` so phones keep true pixel sizes (§1).
- **Native gestures**: pull-to-refresh at scroll top runs `router.refresh()` past 72px (`native-gestures.tsx` + `overscroll-behavior-y: contain` suppresses the browser's own), status-bar tap scrolls to top, swipe-back is armed on the left edge.
- **Route transitions** are directional: forward = `vt-fwd` push, back = `vt-back` pop, everything else a 140ms `vt-fade` — including filters and pagination, which therefore do not fake a drill-in (globals.css:696-769).

## 4. Accessibility

- **Landmarks**: semantic `<header>`, `<main>`, and `<nav aria-label="Primary">` in each of rail/tab-bar/student-top-bar contexts. There is **no skip link** — a keyboard user tabs through the wordmark, bell, and account control (and the rail's ~7 items at desktop) on every page. Small exposure, but real.
- **Live regions done right**: `SaveState` mounts `role="status"` and `role="alert"` persistently and animates inner spans (save-state.tsx:162-199); toaster has separate status/alert regions; `SubmitButton` sets `aria-busy`; `Pagination` announces its range politely; `DictateButton` errors are `role="alert"` and the button text itself communicates recording state.
- **Status is never colour alone** — every severity carries a glyph (`GLYPH`: ○ ✓ ! ×, status.ts:269-274, explicitly citing WCAG 1.4.1) and a word; person/program hues always accompany a name.
- **Contrast**: `warn-ink` on `warn-soft` is 5.37:1, `danger-ink` on surface 6.57:1, person `ink`-on-`soft` ≥6.26:1, white-on-`dot` ≥4.5:1 (globals.css:35-46, 62-64). The deliberate exception is `accent-ink #f18d05` at 2.46:1 — documented as brand-fidelity for large readouts (globals.css:47-49) — but it is *also* used for required-field `*` markers at ~13px across `field.tsx:173`, `segmented.tsx:156`, and several form files; the asterisk's semantics are backstopped by native validation and error text, so this is cosmetic risk rather than a hard failure.
- **Focus**: visible `focus-visible` rings throughout (brand outline on controls, e.g. switch.tsx:45), `ConfirmInline` moves focus into the confirmation step and Escape returns it, `Popover` traps Tab within portaled panels and restores focus on close (popover.tsx:287).
- **Custom controls**: `select.tsx` implements the full combobox/listbox contract (`aria-expanded`, `aria-controls`, `aria-activedescendant`, keyboard model, one tab stop, hidden input for native required-validation — DESIGN.md:320); `date-field.tsx` is a keyboard-operable grid; `Switch` is a real checkbox. These are substantial ARIA implementations — correctly wired in source, but they merit real assistive-technology testing (see Issues).
- **Decorative discipline**: icons are `aria-hidden` (icons.tsx:20), the `→` between exchange programs is `aria-hidden`, `HoursRing`'s SVG has a screen-reader sentence, `PageSkeleton` is `aria-hidden`, `Meter` callers all supply `aria-valuenow/max/label`.
- **Sorting**: `SortHeader` links set `aria-sort` and encode state in the URL, so a sort is shareable and announced.
- **Target sizes**: the general rule is 44px and it holds for buttons (`md`), inputs, selects, switches, `RowFold` triggers, the bell, and both `SegmentedRadio` variants. The documented exception is `TabLinks`/`SEGMENT_TAB` at `min-h-8` (32px) — above WCAG 2.5.8's 24px AA floor but below the 44px house rule, a deliberate cost-benefit decision recorded in segmented.tsx:44-56.
- **Non-visual status for non-visual output**: `navigator.vibrate(4)` on `Switch` has no reduced-motion/haptics gate (minor; Android-only). The rating's unicode stars are wrapped in `aria-label`, so the empty `★`s don't announce separately.
- **Reduced motion**: a single `@media (prefers-reduced-motion: reduce)` block flattens all animation *and* transition durations to 0.01ms, zeroes stagger delays (so a 300ms-delayed row can't sit invisible — globals.css:820-833), explicitly neutralises view-transition pseudo-elements, and converts `:target`'s 2.5s `land` fade into a static tint (globals.css:859-860).

## 5. Motion

The motion vocabulary is a named utility layer in globals.css:333-628, everything on the strong ease-out curves and almost everything under half a second:

| Utility | Use | Timing |
|---|---|---|
| `pop-in` | popovers, select list (desktop), empty-state icon | 150–300ms |
| `modal-in` / `overlay-in` | dialogs | ~200ms |
| `scrim-in` | sheet/scrim backdrop (`bg-ink/30`) | 200ms |
| `sheet-up` | mobile sheets (select, popover) on `ease-nav` | 340ms |
| `rise-in` | inline reveals: forms, save ticks, error text | 180ms |
| `deal-in` | row/list entrances with per-index stagger (~24ms, capped at index 12–14 ≈ 300–336ms) | 400ms |
| `lift-in` | panel entrances | 500ms |
| `bar-grow` | meters grow from left (`scaleX`) | 800ms |
| `ring-draw` | `HoursRing` sweeps to its value on load | 1100ms |
| `check-draw` | save/attention checkmarks draw themselves (~23-unit path) | 380ms |
| `badge-pop` | nav counts that changed (nav-links.tsx:92) | 320ms |
| `land` | `:target` row highlight, fades out so it doesn't read as selected | 2.5s |
| `vt-fwd` / `vt-back` / `vt-fade` | page push / pop / crossfade; chrome (topbar, tabbar, rail) is named-captured and held still | 340 / 340 / 140ms |
| `brand-sheen` | wordmark hover sheen, once, brand-coloured | 650ms |
| `theme` transition | chrome joins the crossfade on theme switch so it doesn't snap (globals.css:804-818) | 240ms |
| `liquid-edge` | a rotating conic "filament" of accent around **one** element — the student page's "Log a session" button, "the one control on the page that spends the student's hours" (students/[id]/page.tsx:423-425) | 3.2s, **infinite** |

Assessed against the stated rule — "felt, not watched… each is under half a second, runs once, and asks for nothing" (globals.css:583-588) and "nothing loops and nothing idles, and no motion celebrates" (DESIGN.md:403) — the system is honest with two exceptions: `liquid-edge` is a literal infinite loop (deliberate, single-use, and it *is* killed by reduced-motion via `animation-iteration-count: 1` + 0.01ms duration), and `hint-bounce` is a dead keyframe DESIGN.md itself flags (DESIGN.md:403-404). The `deal-in` stagger is the biggest systemic cost — it delays content on every list render, including re-renders after pagination and filter changes; under reduced-motion all delays are zeroed correctly.

## 6. Long-text rendering

Long text was the owner's explicit complaint ("text blocks, long text not rendering right") and the system now has a single answer to it:

- `expandable-text.tsx` clamps to 1–3 lines, *measures* whether text actually clipped, and only then shows "Show more"/"Show less" — no affordance on text that fits. `whitespace-pre-line` preserves author line breaks; `min-w-0` makes the clamp work inside flex rows.
- `expandable-note.tsx` uses native `<details>` with the note itself as summary — clamps to one line collapsed, works pre-hydration, no duplicate hidden DOM text, keyboard/AT behaviour free.
- `GrowingField` grows input text vertically via a hidden mirror span rather than scrollable boxes.
- `check-copy.mjs` lints `truncate` without `min-w-0`/`max-w-` — the exact CSS bug that made names "truncated" while still blowing columns open (check-copy.mjs:13-16).
- Every free-text surface routes through one of these: agenda `purpose` fields (`ExpandableText lines={2}`, student/page.tsx:57), session notes, task descriptions, exchange notes.
- Person names, program names, and chips all truncate inside `min-w-0` flex contexts; `PersonCell` keeps the subject line readable rather than letting a name destroy the row.

## 7. Information hierarchy

- **One `h1`, one lead figure.** `PageTitle` is the only title block and `Figure lead` the only oversized readout — on a student's page that figure is the `HoursRing` remaining balance.
- **Hairlines, not containers**: sections are bordered surfaces with divided header bands; stat-card strips, tinted panel headers, banner washes, gradient heroes, and ghost monograms are all gone (and the two-boundary error system even exists partly *because* the shell owns the queries).
- **The ledger's three quantities stay three**: `students-table.tsx` deliberately renders Completed before Total/Remaining, keeps the roster to one chip ("Not signed in") instead of a severity stack per row — "a roster of forty rows wearing a red chip each is a roster nobody reads" (students-table.tsx:37-42, 134-139) — and demotes expiry to the student's own page + the bell.
- **One place for bad news**: "Needs you" blocks were removed from all three home pages; active issues + history live only at `/notifications`, grouped when the list earns it (`groupStatuses`, worst-first, status.ts:208-230), with at most one `blocked` page-level `Callout` per page by rule.
- **Meaningful ordering everywhere**: figures sort desc-on-first-click (students-table.tsx:107-127), notification categories order by change frequency, attention groups order by worst severity then `GROUP_ORDER`, unread precedes read under an "Earlier" divider.
- **Folded depth**: finished agenda items hide behind a "Finished · n" fold, exchange session logs behind a `Disclosure`, secondary filters behind a named disclosure that auto-opens only when active — the settled information is retrievable without competing with what's live.
- **Scope-true labelling**: a two-program student shows only the enrollments the reader administers (students-table.tsx:213-237), exchange memberships are always labelled "on exchange" per the AGENTS.md rule that a visit must never read as an enrollment, and column labels follow the *reader's* lens ("Remaining with you" for mentors).

## 8. Status & colour consistency

`src/lib/status.ts` is a single exhaustively-typed model: every `StatusType` maps to a `Severity` (`neutral`/`ok`/`attention`/`problem`), an actionability `Kind` (`actionable`/`informational`/`blocked`), per-`Audience` labels and explanations, a `StatusGroup`, and a glyph — with `now` injected rather than read from the clock, and `ViewerContext` carrying whose words a page speaks. `status-chip.tsx` maps severity to surfaces: neutral = canvas/muted, ok = canvas/ink, attention = warn-soft/warn-ink, problem = danger-soft/danger-ink. The consequences observed in source:

- **Over-budget and overdraw are `danger` everywhere** — task-row.tsx:33-38 records this as a settled rule and routes the question through `taskStatuses` rather than comparing numbers locally, which is also why a student never sees red they can't get an explanation for.
- **"Done" is a ✓ glyph on a neutral chip** — progress is a shape (○ ◐ ✓ via `ASSIGNMENT_PROGRESS_GLYPH`), never a wash (task-row.tsx:40-44).
- **A missed session is never softened** — "No-show, time charged" is an `!` chip, and missed-but-charged hours keep the accent fill *with* striping rather than switching hue, because they're still hours that count.
- **Blue is never a status** — the unread count is `bg-brand`, and the only thing red means is loss/danger.
- **Program and person hues are identification, not state** — tones sit at hues (160/306/79 and 246/192/282/215) chosen to be clear of amber and red precisely so a chip can never be mistaken for a severity.
- **The one parallel colour system** is `notification-list.tsx`'s `TONE` map (`brand`/`accent`/`plan`/`success`/`warning` → five chip styles, notification-list.tsx:7-13 + `NOTIFICATION_META`, constants.ts:424-459): notifications are historical facts rather than statuses, so "success"/"plan" intentionally map to neutral and "warning" to warn — coherent, but it is a second vocabulary with its own fallback ("Update"/brand), noted in Issues.
- **Per-reader expiry windows** (`EXPIRY_WINDOW_DAYS`: staff 14 / mentor 7 / student 30, status.ts:283) match each audience's useful action — a thoughtful example of status-as-communication rather than status-as-data.

## 9. Icon catalog

`src/components/icons.tsx` is a single 24×24 stroke-icon set (`strokeWidth=2`, `round` caps/joins, all `aria-hidden`, sized by `h-/w-` classes):

| Icon | Documented role |
|---|---|
| `ArrowRight`, `ArrowLeft`, `ArrowUpRight`, `ChevronDown/Left/Right` | navigation affordances; `ChevronRight` is `data-chev` — the iOS-style drill-in mark that leans 2px on hover/touch (icons.tsx:112-119, globals.css:631-639) |
| `Bell` | notifications — the same glyph on chrome and page, deliberately (icons.tsx:38-43) |
| `Alert`, `Info` | attention/problem vs. informational — same glyph shape family, tone distinguishes |
| `Check` | saved/done (with `check-draw`) |
| `Pencil`, `MoreVertical`, `MoreHorizontal` | edit; row ⋮ menu; tab-bar overflow |
| `LogOut`, `Send` (Telegram), `Folder` (student folder link) | account + contact actions |
| `Star` | **filled**, unlike the stroke set — ratings |
| `Search`, `Calendar`, `Chart`, `Link` | search; meetings; analytics; booking links |
| `Inbox`, `Users`, `User`, `Layers`, `Gear`, `Home`, `Panel`, `Plus`, `X` | the nav's minimal wayfinding set — icons sit beside a word and carry no meaning alone (icons.tsx:259-263); `Plus` is "add one of whatever this list holds"; `X` is dismiss-only, "never delete" |

Two inconsistencies: `XIcon` alone uses a 20×20 viewBox at `strokeWidth=1.7` (icons.tsx:349-355), and read-only ratings render unicode `★` (rating.tsx, feedback/page.tsx:596) rather than `StarIcon` — visually equivalent, but two star renderings exist.

## 10. Alignment with the redesign specification

Measured against the owner's complaint and `REDESIGN.md`/`DESIGN.md` (where REDESIGN wins disagreements, per DESIGN.md):

- **"Too clowny / too many colors"** → resolved structurally: ~12 hue families collapsed to five semantic families plus 3+4 identity hues, and `check-colors.mjs` hard-fails lint on any raw palette class. Colour now *means* something everywhere it appears.
- **"Repetitions"** → one renderer per thing: one table chrome, one session row (4 impls → 1), one task row (4 → 1, including one that disagreed with itself about over-budget), one popover (4 cloned effect blocks → `use-anchored-position`), one expandable text, one save-state machine, one status model with audience words, one error boundary above the shell (5 near-identical → 1 + `global-error`). REDESIGN.md claims 53 files retired against 51 kept.
- **"Long text not rendering right"** → §6; the failure mode itself (`truncate` without `min-w-0`) is a lint error now.
- **"Too much noise / everything all over the place"** → one h1, one lead figure, hairlines, no washes, one attention list at one address, folded settled work, two live-region chrome elements instead of scattered banners.
- **"Why does a mentor see nonsense on the homepage"** → nav derives from scope (`navFor`), status words come in the reader's audience, staff see staff words, and homes no longer double as inboxes.
- **"No settings page/icon for programs"** → `/settings` exists in the account menu + rail utility slot, `SettingsRow` colocates description/control/save-state, program settings forms live under `/programs/[id]`'s own surface, and `Platform` appears only for `platformAdmin`.
- **Trust in figures** → `formatRough` rounds *down* (never overstates), `HoursRing` takes `remaining` explicitly, `HoursBreakdown` draws overdraw *outside* the track, exchanged hours can't double-count (AGENTS.md model surfaces in the UI: "on exchange" labels, host-program allocations), and `EXPIRY_WINDOW_DAYS` differs per reader by design.
- **Spec-vs-implementation drift** is real but small and concentrated in documentation: the program-hue sections of REDESIGN.md disagree with each other (§4 amended vs. the "Removed" table and overview row), "retired" tokens still ship, and the flat "no table scrolls sideways" statement coexists with a deliberate `sm:` escape hatch. Details below.

### Issues found

Severity scale: **[Critical]** blocks or misleads users / loses data; **[High]** likely to degrade the experience for a class of users; **[Medium]** real inconsistency or spec violation with bounded blast radius; **[Low]** polish, hygiene, or documented-but-worth-tracking debt. All findings are from static inspection; none was verified at runtime.

- **[Medium] Table spec vs. escape hatch.** `DESIGN.md:337` states "no table scrolls sideways" flatly, and the phone half of that is fully true (rows stack below `sm`), but `ui/table.tsx:52` retains `sm:overflow-x-auto` on the wrapper — at ≥640px a wide table in a narrow window or collapsed-rail layout can still scroll sideways. Probably a deliberate safety valve, but it's undocumented against a flat rule, and the six-column cap it protects is convention, not lint. Worth either documenting in DESIGN.md or removing to see what breaks.
- **[Medium] REDESIGN.md contradicts itself on program hues.** The amended rule at REDESIGN.md:582-592 permits four program hues as dot+label (implemented in `program-tone.ts` and `--color-prog-*`, globals.css:85-101), but line 64 still says "programs get no hue" and the removed-features table at :1004 still claims "Program identity hue: None… `PROGRAM_TONES`, `programTone()` … are deleted." Future readers will find whichever paragraph they grep first; the amendment should be propagated.
- **[Low] `accent-ink` (2.46:1) is used for required-field asterisks.** The token's low contrast is a documented, acceptable tradeoff for *large* hour readouts (globals.css:47-49), but `field.tsx:173`, `segmented.tsx:156`, `task-picker.tsx:73`, `assign-task-form.tsx`, `student-task-forms.tsx:131`, `program-targets-picker.tsx:125`, `profile-forms.tsx:162,178`, and `notification-list.tsx:9` also use it at ~13px or on `accent-soft`. Asterisks are semantically backstopped by native validation and error copy, so impact is cosmetic, but the token is quietly doing small-text duty it was excused from.
- **[Low] Notification chips run a parallel colour vocabulary.** `notification-list.tsx:7-13` maps `brand|accent|plan|success|warning` to chip styles while the rest of the app speaks `neutral|ok|attention|problem`; unknown notification types fall back to a `brand`-toned "Update" chip that could read as actionable chrome. Coherent today (facts ≠ statuses), but it's the kind of second system the redesign was built to eliminate, and `SESSION_ANSWERED`/`ACCOUNT_APPROVED` wearing "success" is exactly the green-by-another-name the palette removed.
- **[Low] `liquid-edge` is the one loop.** The infinite 3.2s accent filament on "Log a session" (students/[id]/page.tsx:425, globals.css:500-526) is deliberate and single-use, and reduced-motion does neutralise it — but it literally contradicts "nothing loops" (DESIGN.md:403), which names `hint-bounce` as the only such exception. Either the rule or the doc should acknowledge the exception.
- **[Low] Dead/redundant motion and tokens.** `hint-bounce` has no call site (globals.css:563-580; DESIGN.md:404 acknowledges it). `accent-dark` and `accent-soft` were declared retired (REDESIGN.md:561, :64) yet still exist in both themes and are still consumed — `accent-dark` solely by `liquid-edge`'s gradient (globals.css:519-521), `accent-soft` by the notification `TONE` map — meaning the "retired" tint can keep spreading.
- **[Low] Haptics bypass the motion preference.** `navigator.vibrate?.(4)` on `Switch` (switch.tsx:37) has no reduced-motion gate. Android-only and harmless, but it is feedback the preference can't reach; similarly `DictateButton`'s pulsing danger dot relies on `animate-pulse` (which *is* flattened under reduced-motion, leaving a static dot — acceptable, but verify the recording state still reads).
- **[Low] No skip link.** With a sticky top bar, account popover, and (at desktop) a labelled rail all preceding `<main>`, keyboard users repeat a short-but-nonzero tab run per page; nav is small so exposure is bounded.
- **[Low] Icon set inconsistencies.** `XIcon` is a 20×20 viewBox at `strokeWidth=1.7` against the 24×24/2 convention (icons.tsx:349-355); unicode `★` duplicates `StarIcon` for read-only ratings (rating.tsx:8-9, feedback/page.tsx:596-597).
- **[Low] Stale documentation in `brand.ts`.** The tones comment still asserts identity hues are "assigned per person, never per program: a program is a place, not a face" (brand.ts:47-50) — pre-amendment language; `BRAND` also carries no program hexes, so email/PDF can never render a program dot (likely fine, but worth a line saying so).
- **[Low] `Rating`'s empty stars use `text-line` as a *text* colour.** `#e5e6e8` stars at rating.tsx:9 are decorative and the `aria-label` carries the value, so this is fine for AT — flagged only because a border token doing text duty is a misuse the colour system otherwise avoids.
- **[Low] Untested-by-design surfaces.** The custom `Select` combobox, `DateField` calendar grid, `Popover` focus handling, sheet swipe gestures, and view transitions are all correctly wired in source but are exactly the components where static review can't substitute for assistive-technology and device testing. `npm run lint` (including the three custom guards) and `vitest` were not run during this audit; their configured status is "hard-fail in lint" per package.json:9.

**Net assessment.** The redesign's core promise — a clean ledger where every colour and every number means exactly one thing — is implemented *systemically*, not cosmetically: the rules live in tokens, shared components, a typed status model, and three lint guards rather than in review discipline. The remaining issues are drift at the edges (documentation contradicting amendments, retired tokens still loaded, one looping animation, a parallel notification vocabulary, an undocumented table-scroll escape hatch) rather than failures of the system — which is precisely the class of problem this architecture was built to make visible.

---

## 11. Public, auth & onboarding surfaces

Public reach is controlled by `src/proxy.ts`: `PUBLIC_PATHS = ["/login", "/unsubscribe", "/api/email"]` (line 15). Everything else without a session cookie redirects to `/login` — but the proxy is explicitly optimistic; real enforcement is per-page DAL gating.

### `/` — `src/app/page.tsx`

Server-only fork, renders nothing: `getCurrentUser()` → anonymous users go to `/login`, everyone else goes to `homeFor(user, await profileOf(user))` — students resolve to `/student` (`src/lib/profile.ts:84`). No intermediate markup means no flash of the wrong home; the cost is a server round-trip before any paint.

### `/login` — `src/app/login/page.tsx`

- **Audience/question:** "Can I get in?" — for existing users and first-time self-signups alike.
- **Gate:** verified `getCurrentUser()` (line 24), not cookie presence — a user whose cookie no longer decrypts can still reach the form and overwrite it. Signed-in users are redirected to their own home.
- **Anatomy:** standalone centered card (`max-w-sm`, `bg-surface`, `rounded-2xl`, `shadow-sm`) on `bg-canvas` — the page does **not** use `PublicShell` (no wordmark header). Brand eyebrow "Freshman Academy" (uppercase, `text-brand`), `h1` "Welcome back", subcopy "Sign in to see your mentoring time and book your next session." A `<Callout tone="danger">` maps `?error=` to one of three sentences (`ERROR_MESSAGES`, lines 8–13), including "Students can sign up with any Google account; mentors must use their @freshman.academy account." — the only place the student/mentor sign-in asymmetry is explained. One `<form>` wrapping a bordered "Continue with Google" button; footer microcopy "Students: use the email your program registered. Mentors: use your @freshman.academy account."
- **Interactions/states:** the submit is a plain `<button type="submit">`, not the shared `SubmitButton` — there is **no pending/disabled state** while the action runs `signIn("google", { redirectTo: "/" })`, so a slow OAuth bounce offers no feedback and allows a double-tap. The error Callout is a plain `div` (no `role="alert"`), acceptable since it renders on a fresh page load.
- **Warmth/judgment:** the single focused card and plain-language copy are right for external students; "Welcome back" is slightly wrong for first-time registrants, and the brand says "Freshman Academy" while the rest of the product (wordmark, unsubscribe page, email footers) says "freshlog" — three names in circulation (Freshform, Freshman Academy, freshlog).

### `/unsubscribe` — `src/app/unsubscribe/page.tsx` (`force-dynamic`)

- **Audience/question:** "Make the weekly email stop" — reachable signed-out, from an email client.
- **Gate:** none on the page; authorization is an HMAC token in `?u=`/`?t=` verified server-side (`src/lib/actions/email-prefs.ts:101-119`). A GET only arms a confirm button — mail scanners can't unsubscribe you — and the action is a **plain form action that redirects**, deliberately not `useActionState`, so it works before hydration/with scripting off.
- **Anatomy:** own compact card with a `freshlog` wordmark bar; three states verbatim — armed: "Turn off weekly summary emails?" / "You'll stop getting the Monday email about time you've used and time still to book. Deadline reminders inside the app carry on." with "Turn them off" + "Keep them" (→`/`); done: "You're unsubscribed" / "No more weekly summary emails. Your time and deadlines are unchanged — you can still see them any time by signing in." + "Go to freshlog" (→`/`); invalid: "This link isn't valid" + "It may have been broken by your email client, or it may be from before a security change. **Sign in and use the toggle on your notifications page instead.**"
- **Issue:** that last pointer is stale — the weekly-summary toggle lives on `/settings`, not `/notifications`. "Keep them" and "Go to freshlog" both land on `/`, which bounces a signed-out user to `/login` — acceptable but abrupt.

### `PublicShell` — `src/components/public-shell.tsx`

The pre-/non-member chrome: `freshlog` wordmark, and when signed in the user's email plus "Sign out"; **no navigation by design** — a blocked/onboarding user never sees links they can't use. `max-w-2xl`, `PageTransition`, safe-area padding. Used by `src/app/onboarding/layout.tsx` and by `AppShell` for `settlingIn` users (pending students). Login and unsubscribe are standalone pages that echo the same card language without the header.

### `/onboarding` — `src/app/onboarding/{layout,page}.tsx`

- **Gate:** `requireUser()` first line; the layout supplies only `PublicShell`.
- **Branches** (page.tsx, verified order): mentor missing name → name step; staff → redirect home; student without profile → registration; staff-registered student missing name/Telegram → details; `PENDING` with details → waiting step; otherwise → `/student`.
- **Steps verbatim:** "Your name" / "So students and staff see who you are." · "Complete your registration" / "Tell us who you are and which program you're in." · `Welcome to {program}` / "Confirm your name and how your mentors reach you." (eyebrow = cohort/program label) · waiting: eyebrow `enrollmentsLabel`, "Registration received" / "An admin will approve you shortly." — **no form, no expected timeframe, no contact path, no "you'll be notified" promise**.
- **Anatomy:** shared `Step` wrapper (`max-w-md`, `PageTitle` h1, fields in a rounded surface, `SaveState` status line). `NameStepForm` submits "Set my name"; `DetailsStepForm` "Save and continue"; `RegistrationStepForm` "Submit registration" with a program `Select` (searchable, recents via localStorage) and a cohort sub-select.
- **Validation:** shared `NameInput` — browser `pattern` + title "First and last name, please — not just one word."; server `parseNameField` errors "Enter your full name — first and last, not just one word." / "That name is too long (80 characters max)." (`src/lib/actions/shared.ts:159-179`). Telegram: "Enter your Telegram username (5–32 letters, digits or underscores)." Errors render through the `SaveState` `role="alert"` region; success is a redirect (details → `/student`; registration → `/student` which bounces the now-PENDING user back to the waiting step — a two-hop loop that resolves correctly).
- **Judgment:** the one-question-per-step structure is genuinely warm. The waiting state is the weak link — a new applicant is told "shortly" with nothing else, which is exactly the moment "you always know where you stand" matters most.

## 12. Student area

### Shell — `src/app/student/layout.tsx` + `StudentShell` + `student/loading.tsx`

- `layout.tsx` calls `requireRole(ROLES.STUDENT)` **and** the page re-gates itself (per `AGENTS.md` — layouts and pages render in parallel). Unsettled students (no name/Telegram, `PENDING`) are re-wrapped in `PublicShell` by `AppShell`'s `settlingIn` check, so the shell swap itself is the "not yet" signal.
- `StudentShell` anatomy: `TopBar` (wordmark, `NotificationBell`, `AccountMenu`), desktop `NavLinks` ("Home · Book · Interviews · Feedback", longest-prefix active state), `PageTransition` around children, mobile `TabBar` (same four items — no overflow "More" is ever used for students), `PhoneChrome` (DOM-observes `data-large-title`/`data-back-href` to collapse title + synthesize a back row), `NativeGestures` (edge-swipe back, pull-to-refresh, status-tap scroll-top), plus a global toaster and theme control.
- `student/loading.tsx` renders `PageSkeleton` — `aria-live="polite"` sr-only "Loading…" + `aria-hidden` visual skeleton — so route transitions keep shell chrome and announce wait state.
- **Judgment:** four tabs is the right count for a student; nothing important hides behind "More". The gestures/view transitions are iOS-faithful and fully gated behind `prefers-reduced-motion`, but are invisible affordances — nothing on screen teaches swipe-back or re-tap-to-scroll-top, so discoverability is luck. The tab bar carries no unread badge; attention is entirely inside the bell.

### `/student` — `src/app/student/page.tsx`

- **Gate:** `requireRole(ROLES.STUDENT)` (151) → missing profile/name/Telegram or `PENDING` → `/onboarding` (167-174).
- **Primary question:** "How much mentoring time do I have left, and what should I do next?"
- **Anatomy, top to bottom:**
  1. `PageTitle` (220-245): eyebrow `enrollmentsLabel` ("Master's Program · Global Admissions (on exchange)"), `h1` "Hi, {first}", subtitle `ArrowLink` "Book a session" → `/student/book`, leading = 96px `HoursRing` (orange ring = gone time incl. forfeited; red when overdrawn; sr-text states allotted total). The single most important figure — remaining time — is the visual anchor.
  2. "Your time" `Section` (247-263, only when `allotted|used|extra > 0`): `HoursBreakdown` bar — Completed (orange), Missed·charged (striped orange), Overdrawn (red), Total. Remaining is deliberately **not** restated (`Math.min(0, remaining)` passes only overdraw).
  3. `Section` eyebrow "Set by your mentor", title "Tasks" (269-331): open `StudentTaskRow`s, each with inline `TaskProgressControl` (0/25/50/75 + separate Done); done tasks folded under `Disclosure label="Finished" count={n}` where the reopen path lives. Empty: "No tasks set" / "Your mentor gives you work to do between meetings."
  4. `Section` eyebrow "What your time is for", title "Agenda" (336-372): read-only `AgendaRow` cards (two-column `sm:grid-cols-2`), finished under a second "Finished" disclosure. Empty: "No agenda planned" / "Your team adds it with a time budget for each piece of work."
  5. "Meetings you've had" `Section` (379-408, only when sessions exist): folded `Disclosure label="Show them"`, aside link **"All meetings" → `/student/meetings` (386) — a route that does not exist**; `SessionRow` timeline entries show date, mentor `PersonChip` (not linked — no `href`), duration, task title (truncated, `title` attr), status chips ("Confirm this session" for unconfirmed rows), "missed" indicators.
- **Privacy:** `withoutMentorNotes(ledger.sessions)` (186) strips mentor notes server-side before any render — correct boundary.
- **What's missing from the page:** no account-level status surfacing at all. `BALANCE_NONE` ("No time yet"), `NO_MENTOR`, `ALLOCATION_EXPIRING`, expired-forfeited, missing-booking-link, and unconfirmed-session attention are computed by `studentAttention` (`src/lib/attention.ts:513-677`) but rendered **only** on `/notifications`. A zero-balance student sees a `0m remaining` ring, hidden "Your time" section, and three empty sections — with no "your team is arranging it" sentence anywhere on their home. The page's own comment says pending users get "a step of its own"; active-but-empty users get silence.
- **Vocabulary risk:** "Tasks" (student-movable, eyebrow "Set by your mentor") vs "Agenda" (eyebrow "What your time is for") is a deliberate split, but a student must infer the distinction from two eyebrows alone — no onboarding copy ever names it.

### `/student/book` — `src/app/student/book/page.tsx`

- **Gate:** `requireRole(STUDENT)`; missing/inactive profile → `/student`.
- **Primary question:** "Which mentor can I book, and how much time do I have with them?"
- **Anatomy:** `PageTitle` back to Home; per-mentor `AllocationRow` cards ordered **balance → meter → deadline chip → action**, mentor `PersonCell` linked to `/mentors/[id]`; bookable mentors get `ExternalLink variant="action"` "Book" (Calendly, new tab); a pairing with no link or an expired allocation renders a severity chip plus a `mailto:` fallback — the page's stated rule is "never a dead-end dash". Pooled (unassigned) time surfaces as a chip "{duration} unassigned" — accurate ledger-speak that may read as alarming to a student. Mentors with zero remaining fold under `Disclosure "Mentors with no time remaining"`.
- **Blocked states:** nothing-to-show students get a severity-keyed `EmptyState` — `NO_MENTOR` renders title "No mentor yet" with **no explanation body** (student voice has no `explanation`), while `BALANCE_NONE` explains "Your team is still arranging it."
- **Judgment:** balance-first card order is exactly right for an external student. External Calendly links open a new tab without warning copy (the arrow-up-right icon is the only signal), and "unassigned"/pool chips are jargon on a page that otherwise reads plainly.

### `/mentors/[id]` — student `MentorCard` view (`src/app/mentors/[id]/page.tsx:620-720`)

- **Gate:** `requireUser`; student readers with no profile/inactive → `/student`; a mentor sharing no program with the student → `notFound()` (665) — "not yours" = "doesn't exist", correct enumeration defense.
- **Anatomy:** `PageTitle` back-label "Book", eyebrow "Mentor", `h1` = name, subtitle = shared pairing labels; 80-96px avatar; one row per visible pairing — program name (only when >1 pairing) + "Book {first}" action link or a `mailto:` chip when there's no link or no time. Footer: `ArrowLink` "Rate {first}".
- **Issue:** that Rate link goes to bare `/student/feedback` — the `?mentor=` deep-link plumbing exists (`MentorFeedbackForm defaultMentorId`, page reads `searchParams.mentor`) and the form's own comment says "the person a 'Rate' link came from", but the card never passes it, so the preselect is dead code on the only in-app entry point.

### `/student/feedback` — `src/app/student/feedback/page.tsx`

- **Gate:** `requireRole(STUDENT)`; missing profile → `/onboarding`. Mentor list is derived from allocations + historical sessions (`allocationSummary`), matching the action's server-side relevance check (`submitMentorFeedback` requires an assignment or past session; error "Pick one of your mentors.").
- **Primary question:** "Which mentor can I rate, and what have I already said?"
- **Anatomy:** `PageTitle` back "Home", `h1` "Rate a mentor"; `MentorFeedbackForm` (`feedback-forms.tsx:79-125`): privacy line "Your name isn't shown to the mentor.", mentor `Select` (searchable), required `StarRating` (fieldset/legend "Rating *"; visually-hidden real radios, 44px star labels, hover-preview + "{n}/5" readout, `peer-focus-visible` outline), comment textarea placeholder "Optional: what went well, what could be better?", `SubmitButton` "Submit mentor feedback"/"Sending…", `SaveState`. Below: "What you've said" — three recent rows (mentor, stars, `ExpandableText` comment, date), earlier under `Disclosure "Earlier ratings"`.
- **States:** no mentor → blocked `EmptyState` "No mentor yet" / "Your program pairs you with one first." Server errors: "Pick a rating from 1 to 5.", "Only students can leave mentor feedback." Success: "Thanks! Your mentor feedback was recorded." and the row appears below via `revalidatePath`.
- **Issues:** the comment `<textarea>` uses local `inputClass` at `text-[0.9375rem]` (15px) — under the 16px threshold, so iOS auto-zooms on focus, unlike every shared `Field` input. No edit/delete affordance on past ratings (deliberate per server model — submissions append — but nothing says so). Star radios are keyboard-operable via the fieldset, but the hover-fill preview has no focus-visible equivalent beyond the outline (stars don't preview fill on keyboard focus).

### `/student/interviews` — `src/app/student/interviews/page.tsx`

- **Gate:** `requireRole(STUDENT)`; inactive/missing profile → `/student`.
- **Primary question:** "What practice interviews do I have, who can I practise with, and how do I offer a time?"
- **Anatomy:** `PageTitle` "Practice interviews" / "Rehearse with classmates." `OfferSlotForm` fieldset "Offer a time" — `DateField` (bounded `min`/`max`), `TimeField` labelled "Starts at (Tashkent)" — the zone is on the label — minutes radios (30/45/60), `SubmitButton` "Offer this time"/"Offering…". "Your times" rows: date + span (e.g. "Tue, Sep 30 · 15:00–15:45" — `formatSlotDay`/`formatSlotSpan` carry **no zone**, unlike `formatSlotWhen` used elsewhere), a `StatusChip` when booked ("Booked by {name}"-style subject), and a withdraw `CancelInline` on unbooked rows. Booked interviews list as `PersonCell` rows linked to detail. Classmates grid: `PersonCell`-style cards to `/student/interviews/people/[id]`.
- **States:** empty slots → nothing offered; empty classmates → blocked variant ("You're the only student in {program} so far."). Action copy verbatim: "You already have something at that time.", "A classmate booked this time. Cancel the interview instead.", "Time removed.", success "Offered {when}."
- **Judgment:** offering/hosting vs booking/guesting is left implicit — nowhere does the list page explain that offering a time makes you the interviewer, or that the template picker on the next screen chooses what the *host* asks. For a peer tool this asymmetry is discoverable only after booking ("You booked their time" eyebrow).

### `/student/interviews/[id]` — `src/app/student/interviews/[id]/page.tsx`

- **Gate:** `requireRole(STUDENT)`; fetch → `sideOf(interview, me.id)`; not found **and** not-yours both → `notFound()`.
- **Primary question:** "What is this interview, who is it with, what do I ask, what do I record?"
- **Anatomy:** `PageTitle` back "Practice interviews"; eyebrow "They booked your time" (host) / "You booked their time" (guest); `h1` = template name or "Practice interview"; subtitle = `formatSlotWhen` (includes "Tashkent"); `StatusChip` (Booked / Not marked done / Completed). "With" section: partner `PersonChip` (email stripped, `email: ""`; not linked to their people page) + caption "Arrange where to meet between you. You can mark it done once it starts." "Questions" section: template summary + ordered fixed question list with count. Actions by phase: `to-mark` → `MarkDoneButton` "Mark as done"; booked/to-mark → `CancelInterviewButton` → `ConfirmInline` "Cancel this interview?" / "Your classmate is told, and the time opens for others to book." Completed → "Notes" section, `InterviewNotesForm` (textarea `aria-label="Your notes"`, NOTES_MAX enforced: "Notes can be up to {N} characters.") + `DictateButton`.
- **Actions** (`src/lib/actions/interviews.ts`): `markInterviewDone` — "You can mark it done once the interview has started." / "Marked as completed." — **one tap, no confirm, irreversible** (re-marking is refused: "This interview is already marked done."); `cancelInterview` deletes the row, notifies the partner, redirects to the list; `saveInterviewNotes` writes host/guest-private notes. `NOT_YOURS` = "That interview isn't one of yours."
- **Judgment:** the phase-gated action set is careful, and participant-private notes are correct for practice. But "Arrange where to meet between you" is the page's only logistics guidance — no contact method is offered (Telegram isn't exposed between students), and mark-done's irreversibility deserves the same `ConfirmInline` cancel gets.

### `/student/interviews/people/[id]` — `src/app/student/interviews/people/[id]/page.tsx`

- **Gate:** `requireRole(STUDENT)`; self → `/student/interviews`; classmate must be active, named, and share a program via `areClassmates` (enrollments + exchanges) — else `notFound()`. Only shared programs are named.
- **Primary question:** "Which times can I book with {name}, and what do we practise?"
- **Anatomy:** `PageTitle` back "Practice interviews", avatar, `h1` = name, subtitle = shared program labels. "Available interview times" section w/ count: `BookInterviewForm` — slot radios (spans, again zoneless) + four template cards ("University admissions", "Scholarship panel", "Behavioral (STAR)", "Student visa" — each with its summary) + `SubmitButton` "Book this interview"/"Booking…". Both groups are `required` native radios. Empty: `EmptyState` "No times offered" / "{First} hasn't offered any times yet."
- **Actions:** `bookInterview` checks self/time/clash/status/classmates, transacts with `P2002` uniqueness as the last-line race guard, notifies the host, and **redirects straight to the new interview page** — a strong confirmation. Errors: "Pick what kind of interview to practise.", "Pick a time.", "That time isn't available any more. Pick another." (one sentence for "no such time" and "not yours to see").
- **Judgment:** the shared-program subtitle is the right amount of context; timezone only appears in the "Starts at (Tashkent)" label — the slot radios themselves don't repeat it. For students booking across borders this is the screen where the zone matters most.

### `/notifications` + `/settings` (student reach)

- `/notifications` (bell destination): `AttentionList` "Active issues" for students — grouped severity rows, whole-row links, count = actionable only, `dismissible: false` (deliberate), empty "Nothing to do right now." Sources: account rows (`ALLOCATION_EXPIRING` links to `/student/book`; everything else unlinked), overdue tasks/agenda, per-mentor `BOOKING_LINK_MISSING` → `/student/book`, and **unconfirmed sessions → `/student/meetings` (attention.ts:648) — the missing route again**. `NotificationList` rows are plain `<a>`s (no prefetch-triggered read-marking); "No notices for you." in the bell glance (six shown) vs "All caught up"-style feed states.
- `/settings` (account menu): `TelegramForm`, weekly-digest `Switch`, per-category in-app/email `Switch` matrix — switches fire `requestSubmit()` on change; failure surfaces a toast "Couldn't save that change — please try again." but the flipped switch does not revert until the next server render, so a failed write briefly lies. Heading "Active issues" is staff vocabulary on a student surface.

### Cross-cutting components and states

- **`StudentTaskRow` + `TaskProgressControl`** (`student-task-row.tsx`, `student-task-forms.tsx`): title, expandable note (`ExpandableText` — measured clamp, "Show more"/"Show less", inline at `lines={1}`), due date, % chip, mentor, program (only when multi-enrolled). Progress submits `setStudentTaskProgress` with `intent` percent/done/reopen; copy verified: "Pick how far along you are.", `"Saved — {n}%."`, reopen resets to 75 not 0 ("It isn't finished yet." / `"…" is open again.`). Pending = `useFormStatus`-driven `SubmitButton`/`aria-busy` spinners.
- **`TaskRow`/agenda rows**: read-only on the student page; `minuteLimit`/`loggedMinutes` meter + `dueNote` free text render factually; chips come from `taskStatuses` in student voice.
- **`SessionRow`/`toSessionEntries`**: `withoutMentorNotes` boundary honored; `sessionsCaption` excludes voided/rescheduled from the tally.
- **`AllocationRow`** student-card variant puts Balance → `Meter` (`role="progressbar"`, orange/red overdraw, animates from 0 on mount — a reader watching the animation sees a briefly-wrong zero) → `ExpiryChip` ("expires today"/"in N days" student windows) → action. Chip severities carry glyphs, so color isn't the sole signal.
- **`Disclosure`/`EmptyState`/`Callout`/`Figure`/`Table`** used per contract; student pages stack tables/rows cleanly; `Table`'s label-repeating stacked mode isn't exercised on student pages (rows are cards/lists).
- **`DictateButton`** (`dictate-button.tsx` + `/api/notes/dictate`): "Speak" → "Stop M:SS" → "Tidying…"; 16kHz mono WAV, mic tracks stopped on unmount, audio not persisted; route re-verifies actor+target ("Dictation works on your own interview notes.", "You are not signed in.", "No recording arrived."). **Mismatch:** client cap is 120s but the server error says "That recording is too long. Keep it under a minute." (~5MB ≈ 156s at 16kHz WAV) — neither limit matches the copy.
- **`SessionAnswerForm`** (`session-answer-form.tsx`) + `answerSession` (`sessions.ts:759`): a complete, thoughtful flow — "Did this happen?" → "Yes, it happened" (optional per-meeting `StarRating` + note) / "Something's wrong" (required note, "Say what was wrong, so it can be corrected."), mentor always notified, staff notified on dispute. **It is imported by nothing.** Combined with the missing `/student/meetings` route, the product's central promise — a student can verify the hours charged against them — has a server action, a status chip ("Confirm this session"), and an attention row, but no reachable UI.
- **`BookingLinksForm`** (`booking-link-form.tsx`): mentor-self surface only (folded "Edit your profile and booking links" on `/mentors/[id]`, auto-open when a link is missing); no student route imports it — correctly absent from student surfaces, but the student-facing consequence of an unset link (BOOKING_LINK_MISSING chip → `/student/book`) has no reciprocal pointer telling the student their mentor was asked to set one.
- **Errors/loading/not-found:** `student/loading.tsx` = `PageSkeleton`; no route-level `error.tsx` under `/student` → errors bubble to the app boundary ("This page didn't load" / "Try again" / "Back to safety" + digest), which replaces the whole shell — acceptable but a bigger chrome loss than a section-level boundary. **No `not-found.tsx` exists**: every `notFound()` (classmate not shared, interview not yours, mentor out of scope, and crucially the missing `/student/meetings`) renders the bare framework 404 — for the enumeration-hiding calls that's fine, for the broken link it compounds the failure.
- **Tokens/a11y:** consistent canvas/surface/line/ink, accent=orange-hours, warn=attention, danger=overdraw/gone — legible system; `text-accent-ink` on white (~2.4:1) sits below AA on the "Completed" figure at small sizes. Native `<details>` disclosures, real radios under star pickers, `role="status"`/`role="alert"` live regions mounted empty from the start, `useUnsavedChanges` on dirty forms, and full `prefers-reduced-motion` coverage including view transitions are all strong. The gesture layer is the weak spot: discoverability nil.

### Issues found

| Severity | Location | Issue | Impact | Suggested fix |
|---|---|---|---|---|
| [critical] | `src/app/student/page.tsx:386`, `src/lib/attention.ts:648` | `/student/meetings` route does not exist; "All meetings" link and the unconfirmed-session attention row 404 | The student's own session history — the place to verify hours were real — is unreachable; a bare framework 404 lands on a core trust path | Add the route (REDESIGN.md already specifies it) or repoint both links to the folded history on `/student` until it ships |
| [critical] | `src/components/forms/session-answer-form.tsx`, `src/lib/actions/sessions.ts:759` | `SessionAnswerForm`/`answerSession` are orphaned — no route mounts the confirm/dispute UI | "Confirm this session" chips and attention rows point nowhere actionable; students cannot flag a session that didn't happen — the ledger's trust promise has no surface | Mount the form on `/student/meetings` rows (or inline under each unconfirmed `SessionRow` on `/student`) |
| [high] | `src/app/student/page.tsx` | No account-level status renders on home: `BALANCE_NONE`, `NO_MENTOR`, `ALLOCATION_EXPIRING`, forfeiture, booking-link-missing exist only on `/notifications` | A zero-balance or unpaired student sees "0m remaining" plus empty sections with no explanation or next step — "always know where you stand" fails precisely when nothing is set up | Render `studentAttention` rows (or at least `BALANCE_NONE`/`NO_MENTOR`/expiry) as a status block beneath the `PageTitle` |
| [high] | `src/app/unsubscribe/page.tsx` (invalid state) | "use the toggle on your notifications page" — the toggle lives on `/settings` | A user whose unsubscribe link failed is sent to a page with no toggle | Change copy to "your settings page" |
| [medium] | `src/app/onboarding/page.tsx` (pending step) | "Registration received / An admin will approve you shortly." — no timeframe, contact path, or "you'll be notified" | The highest-anxiety moment in the funnel ends in silence | Add what happens next (notification/email on approval) and a contact route |
| [medium] | `src/app/student/interviews/[id]/page.tsx`, `interviews.ts:279` | `markInterviewDone` is one tap, no `ConfirmInline`, irreversible ("already marked done" on retry) | An accidental tap permanently locks the interview into completed state | Wrap in `ConfirmInline` ("This can't be undone — the notes step opens.") |
| [medium] | `src/components/forms/feedback-forms.tsx:11,111` | Comment textarea uses local `inputClass` at `text-[0.9375rem]` instead of the shared `Field`/`Textarea` | iOS auto-zooms on focus; inconsistent focus/height behavior vs every other input | Swap to shared `Textarea` (which sets `text-base` on mobile) |
| [medium] | `src/app/mentors/[id]/page.tsx:718` | "Rate {first}" links to bare `/student/feedback`; the `?mentor=` preselect plumbing (`defaultMentorId`, `searchParams.mentor`) is unused | Student lands on the form and must re-pick the mentor they just came from; deep-link code is dead | `href={\`/student/feedback?mentor=${mentor.id}\`}` |
| [medium] | `/student/interviews` list + `people/[id]` slots | Slot rows use `formatSlotDay`+`formatSlotSpan` (no zone); only the "Starts at (Tashkent)" field label and detail subtitle name the zone | External students booking across borders can pick a time believing their own zone | Append "Tashkent" (or a zone chip) to slot labels in `OfferSlotForm` rows and `BookInterviewForm` radios |
| [medium] | `src/app/notifications/page.tsx` (student), `attention-list.tsx:41` | Section title "Active issues" + non-dismissible rows on a student surface | Staff vocabulary ("issues") on a service page; fine for admins, cold for students | Title "Things to check" / "Needs you" for the student audience |
| [low] | `src/app/login/page.tsx:57` | Plain submit button, no pending/disabled state vs shared `SubmitButton` | No feedback during the OAuth bounce; double-submit possible | Use `SubmitButton` with pendingText "Opening Google…" |
| [low] | `src/app/student/book/page.tsx` | `NO_MENTOR` blocked `EmptyState` renders title only (student voice has no `explanation`); `POOL_UNASSIGNED` chip "{dur} unassigned" is ledger-speak | A mentor-less student sees "No mentor yet" with no why/what-next | Give NO_MENTOR a student-voice explanation ("Your program pairs you with one first." already exists on the feedback page — reuse) |
| [low] | `src/components/forms/dictate-button.tsx`, `/api/notes/dictate` | Client caps at 120s; server error says "under a minute" (~156s at 5MB/16kHz) | A 61–120s recording is rejected with copy that doesn't match either limit | Align copy to the real limit ("under two minutes") and the client cap to match |
| [low] | `src/app/student/interviews/[id]/page.tsx` | Partner `PersonChip` isn't linked; "Arrange where to meet between you" offers no channel (no Telegram/contact between students) | Students must coordinate logistics with no in-app path | Link the chip to `/student/interviews/people/[id]`, or add "message them on Telegram" if handles are shareable |
| [low] | `src/app/settings/page.tsx` switches | `Switch` flips optimistically; failed `requestSubmit` toasts but the knob stays in the wrong position until revalidation | A failed preference write looks saved | Revert `on` state when the action rejects (or submit non-optimistically) |
| [low] | Global | No `not-found.tsx` app-wide | Legitimate `notFound()` calls (broken links, expired records) hit the bare framework 404 with no way home | Add a `not-found.tsx` matching `ErrorState` language ("This page doesn't exist" / "Back to safety") |
| [low] | `src/components/ui/meter.tsx`, `hours-ring.tsx` | Meter animates 0→value on mount; ring draws itself | A reader watching first paint momentarily reads "zero progress/zero used" — harmless but misinformative at exactly the figure this app stakes trust on | Start at final value for `prefers-reduced-motion` (already done) and consider skipping the from-0 tween for very small values |
| [low] | Branding | "Freshman Academy" (login), "freshlog" (shell/unsubscribe), "Freshform" (repo) | External students see three product names | Pick one for student-facing surfaces |

---

## 13. Admin home — `/admin` (`src/app/admin/page.tsx`)

**What it is.** A deliberately sparse landing page: `PageTitle` "Inbox", a muted subtitle of `N programs · N students · <Figure> remaining`, a `CreateProgramForm` for platform admins only (`:109`), and a Programs table that is hidden when scope is one program (`:113-145`, comment at `:111-112`).

**What it does well.**

- **The numbers are trustworthy.** Figures come from `programTotals()` over the unsliced scoped roster, then per-program via `byProgram` (`:62-80`) — a two-program student is counted once per program with that program's own hours, and never double-counted. This is exactly the aggregate rule in AGENTS.md ("never key a total on `studentId:mentorId`") and REDESIGN §8.6.
- **One clock.** A single `now` is created once (`:44`) and threaded into `studentsWithHours`, so no figure can disagree about what has expired.
- **Scope is applied in query construction**, in the Prisma `where` (`:40, 48, 53, 57`), not by filtering fetched rows — matching the hard rule. `undefined` for a platform admin means "no filter", which the comment at `:35-38` correctly notes avoids going stale when a program is created.
- **It answers one question first** — "how big are my programs, and how much time is still in them" — and the remaining figure is the only orange on the page, rendered `danger` when negative (`:99-105, 133-140`). This is the cleanest possible expression of the redesign's "no noise" mandate.
- **Honest ordering and naming**: `count()` pluralizes once (`:30`), program names are links via `ProgramChip` with a 44px touch target on mobile (`:121-125`).

**Deviations from spec (deliberate vs. open).**

- REDESIGN §6.1 specified five sections — Active issues (`AttentionList`), Up next (`Timeline`), Programs, Recent sessions, plus an `Updated HH:MM` freshness stamp. The shipped page renders none of these: only counts + program table + (for platform admins) create-program. This is largely intentional — the owner moved "Needs you" behind the bell (`lib/attention.ts`, `/notifications`), and the file's own comment (`:13-27`) explains the reasoning. But two spec commitments were lost rather than moved:
  - **`STAFF_UNSCOPED` never renders here.** REDESIGN §6.1: "Zero grants → one line: `STAFF_UNSCOPED`". `status.ts:800-806` defines "No programs granted / A platform admin grants you a program to work in.", and `dal.ts:78-81` claims `/admin` "answers the question honestly" with that sentence — **but the page never renders it**. The status only appears inside `attentionFor()` (attention.ts:374-377), i.e. on `/notifications`. A staff member whose last grant was removed — precisely the reader `requireStaff` (dal.ts:83-90) was designed to let in to break a redirect loop — lands on "Inbox / 0 programs · 0 students · 0m remaining", which reads as "the school is empty" rather than "you hold nothing." This is a wrong-answer state, not an empty state.
  - **The `Updated` freshness stamp is absent** (spec §5.8, §6.1 row 1). Every other page is correctly forbidden from claiming freshness; the one page that may, doesn't.
- **Naming/IA tension**: nav (nav.ts:90) and the h1 both say "Inbox", but the operational inbox — Active issues — lives behind the bell at `/notifications`. A staff member looking for "what is waiting on me" at the place literally labeled Inbox finds a statistics table. Either the name or the destination should change.
- **CreateProgramForm stayed on `/admin`** (`:109`); §6.19 put program creation on `/settings/platform`. Minor drift — there is exactly one surface, which is what matters, but the platform page (the natural home for org structure) cannot create what it administers.
- The per-row **attention count** specified in §6.1 ("remaining · attention count · →") is absent — consistent with the bell decision, but it means the program table cannot answer "which program needs me" without a second page.

## 14. Students (admin/people views)

### 6a. Roster — `/students` (`src/app/students/page.tsx`, `src/components/students-table.tsx`)

**What it does well.**

- **One canonical roster** for admins and mentors, gated by `requireUser` + explicit audience split (`:47-66`): staff see granted programs via `programIds`, mentors see `loggableBy` reach (`studentsWhere`, filters.ts:749-820). A user with neither right is redirected home (`:66`). Non-staff, non-mentor readers can't enumerate anyone.
- **Every narrowing is a `where`** — search, program, cohort, `status=pending|not-signed-in`, `time=none|expiring|expired`, `mentor=me` all remain functional URL params (filters.ts:759-817), ANDed alongside scope so a param can only narrow, never widen (`:769-772` comment confirms the design).
- **URL-backed sort with a correct correctness-over-cost trade-off**: computed sorts (completed/total/remaining/seen) deliberately load the whole matching set and slice in JS rather than sort a DB page (`:121-155` — "a header that changes the URL and not the order is worse than a header that does nothing"). Name sort still slices in SQL. This is the right call for a school-sized roster and is documented as such.
- **Mobile stacking is genuinely good**: `RowFold` gives each collapsed row a headline figure (remaining balance) plus a labeled, `aria-expanded` chevron (row-fold.tsx:23-55; students-table.tsx:191-207); `Td label=` repeats the column name per cell (table.tsx:113-129) — no horizontal scroll, no mystery columns.
- **Deliberate restraint, documented**: no use-by column and no status chips except "Not signed in" — an explicit owner instruction (students-table.tsx:37-43). The program cell renders one chip per scoped enrollment with "(on exchange)" markers (`:211-243`), which satisfies AGENTS.md's "say it is a visit wherever a membership is named."
- **Completed precedes Remaining** (`:26-31` comment) — the delivered figure leads because "remaining" alone can't distinguish a new student from a depleted one. The `/{total}` denominator under Remaining (`:272-276`) is mildly redundant beside the Total column but defensible.
- **Contact consolidation**: Telegram + folder are two icon chips in one cell with `title` tooltips carrying the handle/URL and `sr-only` labels (`:283-318`) — 44px targets on mobile (`min-h-11`), narrower on pointer.

**Issues.**

- **Mislabeled figure for mentor viewers** — see Issues table (High). For `audience: "mentor"` the column is labeled "Remaining with you" (students-table.tsx:117) but `remainingMinutes` is summed across every mentor's grants in every program: `programIds` is `undefined` for mentors (students/page.tsx:62), and `studentsWithHours` only narrows by program, never by viewing mentor (queries.ts:88-104). A mentor reads 20h "with you" when they hold 4h of it. The workspace's per-mentor table is correct; only the roster label lies.
- **Pending signups are invisible on the roster.** The table renders only `STUDENT_NOT_SIGNED_IN` (`:140-155`), and that status excludes PENDING accounts (filters.ts:792-799). So a signup awaiting approval — the one state only an admin can act on — renders identically to a fully active student. The bell carries `STUDENT_PENDING_APPROVAL`, but the roster itself gives no glanceable signal. Given the owner's "no chips" instruction this may be deliberate; if so it's worth one muted text suffix rather than a chip.
- **Stale copy**: the mentor-facing subtitle still teaches the removed "Mine" preset — "Everyone in your programs. Mine is the ones you hold time with." (`:164`) — referencing a control that no longer exists on the page.
- **No "Add students" affordance** (spec §6.8 item 1). Registration lives only on `/programs/[id]` (AddStudentsForm, programs/[id]/page.tsx:175-181). The `No students yet` empty state says "Staff register them" without saying where (`:205-209`) — the one place an admin goes looking for the create path has none.
- Default sort is `name asc` (`:84`); §6.8 wanted attention-first ordering. Consistent with the chip removal but worth confirming as a decision, since "attention first" was the sort that surfaced expiring/overdrawn students at the top.

### 6b. Workspace — `/students/[id]` (`src/app/students/[id]/page.tsx`)

**What it does well.**

- **Gate discipline is exemplary**: `requireUser` → fetch the row → `canManageStudent`/`mentorReaches` → `notFound()` (`:99-121`) — "not yours" and "doesn't exist" are indistinguishable, per AGENTS.md. `studentScope` then narrows every downstream read to the admin's own programs (`:145-149`), so a one-program admin sees none of the student's other-program data.
- **Union-of-rights lens**: `manages` and `reaches` are computed independently and controls compose (`audience` sets wording only, `:123-131`). The lens never removes authority.
- **"Log a session" reasoning is visible**: rather than a dead disabled button, the reason text renders below the actions (`:443`), and `canLog = reaches && active` matches the action's own rule — the comment at `:215-238` explicitly rejects inventing permission the server doesn't enforce.
- **The LedgerBoard** (`ledger-board.tsx`) is a genuinely strong replacement for the old duplicated panels: Meetings | Tasks | Agenda, each pane self-scrolling at `40svh`, every row rendered once (`:55` comment), and row-level ⋮ menus wired for sessions/agenda/tasks with per-row authority (`:474-541` — menus appear exactly where the server action would agree).
- **Allocation rows merge plan into commitment**: `timeByMentorEntries` folds open agenda budgets into "Assigned = max(grant, plan)" (`:296-300`; allocation-row.tsx:97-167) — a task born of a grant isn't double-counted, and a plan with no grant gets its own row.
- **Correction surface is complete**: per-row ⋮ offers Correct (minutes + use-by + amount paid), Transfer-with-tasks, and Remove with named consequences (`hours-forms.tsx:56-195`); a pencil offers the fast minutes-only edit (`:277-336`); every form carries `useSaveState` feedback. The deadline-gated `entry.deadline` check at `:631,663` correctly suppresses menus only on synthetic plan-only rows, since `AssignTaskForm` requires a deadline (assign-task-form.tsx:156-167).
- **Audit trail**: `HourAllotmentChange` history in a `History` disclosure, admin-only (`:679-705`).
- **Exchanges** sit above the grant form on purpose (`:555-591`) with `visibleExchanges`/`sendableFrom`/`isParty` precisely matching the server-side rules.

**Issues.**

- **No scheduled-meetings surface.** Spec §6.7 section 4 ("Up next — Timeline with Move/Cancel and Log on overdue") is absent: the page fetches sessions, tasks, agenda, changes, exchanges — but no `Interview` rows at all (`:151-209`). The LedgerBoard "Meetings" column is logged sessions only. An attention row like "Meeting passed, nothing logged" routes the admin to a page that cannot show the meeting. Scheduled meetings are reachable at `/sessions?view=scheduled`, but the one page about the person can't say when they're next expected.
- **No consolidated "Needs attention" block** (§6.7 section 2): statuses surface as scattered row chips and the title's Pending chip rather than a per-student issue list. Acceptable given the bell consolidation, but a student's own page is the one place "what is wrong with this student" should arguably summarize — today the reader must infer it from three different sections.
- **`aria-disabled` on a live link**: the Log button renders `aria-disabled + title` (`:426`) but is still an `<a href>` — keyboard and AT users get "disabled" while the link still navigates. The reason text below mitigates it; a real `<button disabled>` or removing the link would be honest.
- **"Admin only" eyebrow** on Details (`:709`) is a provenance eyebrow — the species §5.7.7 retires — and the section is always-expanded rather than the collapsed FactList the spec wanted. Minor.
- `transferTo` excludes `me.id` (`:653-655`): an admin who also mentors can't transfer unused time to themself via the row — a real (if narrow) workflow gap.
- History disclosure shows only the latest 20 changes with no pagination (`:168`).

## 15. Mentors (admin views)

### 7a. Roster — `/mentors` (`src/app/mentors/page.tsx`, `src/components/mentors-table.tsx`)

**What it does well.**

- **Scope-first and correct**: `requireAdminAccess` + `adminScope` before any query (`:50-61`); pairings, holdings, and ratings are all narrowed to in-scope programs (`:101-143`) — including the subtle, correct choice to scope ratings by the *student's* enrollments, not the mentor's (`:130-142`).
- **Unassigned-first ordering happens in the database** (`:76-80`), correctly ordering on pairing count rather than only `status` — documented as the fix for dual-role admins who are ACTIVE with zero pairings (`:64-75`).
- **Four-column table, one chip**: Mentor (PersonCell + muted "Admin" text + one StatusChip) · Programs · Booking links ("x of y set") · Students holding time — matching §6.10, with rating folded into the mobile `RowFold` headline (mentors-table.tsx:131-144).
- Registration is a `Disclosure` rather than an always-open form (`:200-202`); title carries the unfiltered roster count (`:186-195`); `FilterBar` with Program select + Unassigned/No-booking-link presets (`:204-223`).

**Issues.**

- **`?link=missing` leaks across scope** — the preset adds `mentorAssignments.some({calendlyUrl: null})` *unconstrained by `programIds`* (filters.ts:848-850), while scope is a separate `some({programId: {in}})` clause (`:835-839`). Two `EXISTS` over the same relation can be satisfied by different pairings — exactly the class of bug the cohort filter's comment warns about (`:773-784`). A scoped admin sees a mentor under "No booking link" whose visible pairings all have links.
- **`?status=unassigned` and the chip disagree**: the filter matches only `USER_STATUS.UNASSIGNED` (filters.ts:845-847), but `MENTOR_UNASSIGNED` fires on "no programs OR unassigned account state" (mentors/page.tsx:70-75; status.ts:718-733). An ACTIVE dual-role admin with zero pairings displays "Not in any program" yet never appears under the filter that promises to find them.
- **Scoped admins can't see unassigned mentors at all** (documented at `:38-43` — correct per `canManageMentor`, but worth surfacing in the audit because it means "waiting to be placed" mentors are platform-admin-visible only; a program admin has no way to discover someone waiting).
- The booking-link column shows "1 of 2 set" but not *which* pairing lacks one — by design ("which is a fact about one mentor"), though the detail page does carry it in the subtitle (see below).

### 7b. Record — `/mentors/[id]` (`src/app/mentors/[id]/page.tsx`)

**What it does well.**

- **Gate runs before queries** (`:81-105`) with the comment documenting the Sep-3 leak — the ordering discipline is explicit.
- **Three views at one address**: record for self/admin, card for student/colleague (`:94-106`). The card correctly distinguishes "shared a program" from "holds your time": `bookableIn` only includes programs where `canBookOn(h)` (`:649-653`), and a link-less or unbookable pairing degrades to a `mailto:` — never a dashed placeholder (`:701-713`). Out-of-shared-program → `notFound()` (`:665`).
- **Scoped narrowing is honest**: `inReach` filters pairings, per-program rollups, students, sessions AND the feedback aggregate by the reader's grants (`:194-200`), and totals are summed from the displayed rows (`:201-206`) — figure and table can't disagree.
- **Windowed figures**: 30d/90d/All `TabLinks` with 90d default (`:119-125, 344-355`) — "a lifetime total only ever grows" is the right reasoning.
- Per-program table shows Students·Completed·Missed·Total·Remaining with `danger` on negative remaining (`:383-452`).
- Subtitle carries the one fact the roster can't: *which* pairing has no booking link (`:247-259`).

**Issues.**

- **"Students holding time" sorts by a field it never displays** (`:223-225`): `deadline` ascending with `?? 0` means null-deadline rows sort *first* — ahead of the soonest-expiring time the comment promises is at the top — and no column shows the date, so the ordering rationale is invisible to the reader.
- **Stale duplicated self-edit forms**: `isSelf` renders Avatar/Name/BookingLinks (`:297-337`) justified by a comment claiming they stay "until that page exists" — but `/settings` now hosts all three (settings/page.tsx:58-103) and `BOOKING_LINK_MISSING` attention rows point at `/settings` (attention.ts:434), not here. Two write surfaces for one field now exist with a comment asserting otherwise.
- **No "Needs attention" block** (§6.9 spec) — the subtitle's "(no booking link)" text is a good substitute for the link case, but "not in any program" has no visible state on the record for an admin who opens a scoped mentor's page (it's implied by an empty subtitle/programs list).
- No booking-link chip on the per-program table either — a scoped admin scanning "which of this mentor's pairings is missing a link" must read the subtitle text.
- Sessions capped at 10 with `sessionsCaption` — correct, and `moreHref` drops the period filter deliberately (`:539-563`).

## 16. Settings

### 8a. Personal — `/settings` (`src/app/settings/page.tsx`)

**What it does well.**

- **Truly role-conditional sections**: Telegram only for students (`profile &&`, `:81-87`), booking links only for mentors with pairings (`:89-103`), notification matrix for everyone (`:105-123`). A student never sees mentor chrome and vice versa.
- **Profile ownership is fixed**: picture + name for every role (the old `canActAsMentor` gate on the mentor page is gone — the comment at `:19-29` documents exactly this).
- **Per-row `SaveState`** via `useSaveState` throughout (settings-forms.tsx:11,33,39); sign-in email correctly read-only.
- Booking-link section is a visible `Section`, not hidden behind a fold — good discoverability for the "No booking link" attention destination (which attention.ts:434 correctly points here).

**Issues** — none significant; see Low-severity note re: missing "Email preferences →" back-link from `/notifications`.

### 8b. Platform — `/settings/platform` (`src/app/settings/platform/page.tsx`, `src/components/forms/grants-editor.tsx`, `src/lib/actions/grants.ts`)

**What it does well.**

- **`notFound()` for non-platform-admins** (`:35`) — the address's existence is itself hidden, matching the "unauthorized = not found" rule.
- **One write surface for grants** (§8.4 honored): `setProgramAccess` is platform-admin-only, replaces the whole grant set in one transaction (`grants.ts:38-91`), and `setPlatformAdmin` refuses to remove the last platform admin (`:100-136`). The program settings page shows the same rows read-only — correct two-surface design.
- **All-or-nothing honesty**: platform admin renders as "All" in every program column rather than pretending to be an editable per-program row (`:106-110`); the matrix lists people with no access too (`:63-67`).
- Deployment facts (`Organisation`) are read-only and useful (`:132-159`).

**Issues.**

- **CRITICAL — LEADER/SALES grants confer full admin power.** GrantsEditor offers "Leader — Reads the program and its feedback" and "Sales — Reads the program's students" (`grants-editor.tsx:24-32`), and `setProgramAccess` writes whichever level is chosen (`grants.ts:57-80`). But **`adminScope` counts every `ProgramStaff` row regardless of role** (`authz.ts:59-66`), and every enforcement point bottoms out on that scope: `requireAdminAccess` (dal.ts:62-66), `requireProgramScope` (dal.ts:100-103), `assertProgramScope` (authz.ts:211-222), `assertStudentScope` (`:233-243`), `canManageMentor` (`:155-167`), and the write actions in `students.ts`/`mentors.ts`/`sessions.ts`. `staffLevel` is consulted only to compose nav items (`nav.ts:94-120`) and one feedback-page read (`feedback/page.tsx:116`) — **never to refuse a write**. A platform admin who grants "Sales" believing the UI's promise of read-only has actually handed over mentor registration, hour allocation, student removal, and program archive/delete. The hints in the editor actively misdescribe the grant. This is the audit's most serious finding — a permission model the UI lies about.
- **No "Add person" path** (§6.19): the matrix lists only existing users (`:42-52`); a person who hasn't signed in can't be granted access at all.
- **No Programs section** (§6.19 row 3): no name/status/students/Archive list and no "New program ▸" — creation lives on `/admin` instead.
- The `level:` `<select>` for a ticked program defaults to `ADMIN` even for a person whose only grant is LEADER — `defaultValue={row.grants[p.id] ?? "ADMIN"}` (`grants-editor.tsx:82-94`) — so opening the editor on a Leader silently pre-selects Super admin for any *newly* ticked box, compounding finding #1.

### 8c. Program settings — `/programs/[id]/settings` (`src/app/programs/[id]/settings/page.tsx`)

**What it does well.**

- **`requireProgramScope(id)` before all queries** (`:56`) — out-of-scope reads 404.
- Sections match §6.14's intent: Mentors (PersonChip + cohort + Remove with `ConfirmInline`), Cohorts (with counts + "Not empty — move its people first" instead of a dead delete), read-only Admins list, Program (rename + payment toggle + archive/reopen with accurate copy), Delete (blocked with a plain reason, never a path).
- `blockedReason` composes a truthful sentence for both remaining-students and remaining-grants cases (`:75-80`).
- Mentor assignment offered here AND inline in the program page's rail (programs/[id]/page.tsx:308-316) — the right two places.

**Issues.**

- **`eyebrow="Danger zone"`** (`:232`) — "danger zone" is on REDESIGN §5.7.1's banned list, and `check-copy.mjs` doesn't catch it (its BANNED list omits the phrase — scripts/check-copy.mjs:28-67).
- **No booking-link chip on mentor rows** (§6.14 spec: "name · cohort · booking-link chip · Remove") — the page that manages pairings can't say which pairing is missing its link (`:96-115`).
- **"Granted on Platform settings" is a caption, not a link** (`:183`) — the spec wanted platform admins to see "Manage on Platform →"; the file's comment admits the link "lands with that page, in commit 49" (`:175-178`). Pending commit, currently a dead end for everyone.
- `AssignMentorForm`/`RemoveMentorButton`/`ArchiveProgramButton`/`DeleteProgramButton` all wire `ConfirmInline`/`useSaveState` correctly (program-settings-forms.tsx) — no issue, just noting the coverage is complete.

### Shared foundations observed across sections

- `Table` stacks under `sm` with per-cell labels; `RowFold` keeps one scannable figure per collapsed row — consistent and accessible.
- `FilterBar` carries hidden params so a GET submit doesn't drop other filters (filter-bar.tsx:139-146) and remounts controls when the URL disagrees (`:148-161`) — the two classic filter bugs, engineered out.
- `useSaveState`/`SaveState` is genuinely universal in the audited forms — every mutation shows pending/saved/failed.
- `deal-in` staggered animation on table rows is decorative but subtle.

### Issues found

| Severity | Location | Issue | Impact | Suggested fix |
|---|---|---|---|---|
| Critical | `grants-editor.tsx:24-32`, `authz.ts:59-66`, `dal.ts:62-103`, `nav.ts:94-120` | LEADER/SALES grant levels are offered with read-only copy ("Reads the program's students") but `adminScope` treats any `ProgramStaff` row as full admin scope; `staffLevel` is only used for nav composition, never to refuse a write. | A "Sales" grantee can register mentors, allocate hours, edit students, archive and delete the program — the UI's promise is false, and the nav pretends the levels work (hiding Mentors/Sessions links the pages themselves will still serve). | Until levels are enforced, remove the level select (or hard-code ADMIN). To keep them: gate writes on `staffLevel === "ADMIN"` and let `adminScope` carry level, so `scopeCovers` remains read-scope and a new `scopeAdministers` answers write-scope. |
| High | `admin/page.tsx:89-146` + `dal.ts:78-81` + `status.ts:800-806` | Zero-grant staff see "0 programs · 0 students · 0m remaining" with no explanation; the `STAFF_UNSCOPED` sentence the gate's contract promises renders only on `/notifications`. | A staff member whose grant was removed reads "the school is empty" instead of "you hold nothing"; silent misinformation on a reachable state. | Render the `STAFF_UNSCOPED` status line on `/admin` when `scopeIsEmpty` (it's already in the status model), per §6.1. |
| High | `students-table.tsx:117` + `students/page.tsx:62` + `queries.ts:88-104` | For mentor viewers the column is labeled "Remaining with you" but `remainingMinutes` sums every mentor's grants across every program — `programIds` is undefined for mentors and the query never narrows by viewer. | A mentor reads a figure that isn't theirs on the roster they scan daily; "with you" is a false claim on a number whose trustworthiness is the product. | Either sum the viewing mentor's own (student, program, mentor) tally when `audience === "mentor"`, or drop "with you" from the label. |
| Medium | `students/[id]/page.tsx` (no Interview fetch) | No scheduled-meetings surface — spec §6.7 section 4 absent; the page loads sessions/tasks/agenda but no interviews. | "Meeting passed, nothing logged" attention rows land on a page that cannot show the meeting; admins can't see when the student is next expected. | Add a compact Up-next list (or fold into LedgerBoard's Meetings pane) fed by the student's interviews. |
| Medium | `filters.ts:835-850` | `?link=missing` checks `mentorAssignments.some({calendlyUrl:null})` unscoped by `programIds`; combined with the separate scope `some()`, different pairings satisfy each clause. | Scoped admins see mentors under "No booking link" whose visible pairings are all linked — a filter that disagrees with the table it filters. | Fold the link check into the scoped clause: `mentorAssignments.some({ programId: {in: scope}, calendlyUrl: null })`. |
| Medium | `filters.ts:845-847` vs `status.ts:718-733` | `?status=unassigned` matches only `USER_STATUS.UNASSIGNED`; the row chip also fires on zero pairings (e.g. ACTIVE dual-role admins). | A mentor displaying "Not in any program" is absent from the filter that promises to find them. | Match the chip's rule: `OR: [{status: UNASSIGNED}, {mentorAssignments: {none: {}}}]`. |
| Medium | `students/page.tsx` (absent) + `programs/[id]/page.tsx:175-181` | No "Add students" affordance on `/students` (§6.8 spec); the create path lives only inside a program page, and the empty state says "Staff register them" without a pointer. | An admin's natural "register a student" destination has no create path. | Add the disclosure to the staff view (with a program picker when scope > 1) or a link to the program's roster. |
| Medium | `mentors/[id]/page.tsx:297-337` | Self-view embeds Avatar/Name/BookingLinks forms duplicating `/settings` (`settings/page.tsx:58-103`); the justifying comment is stale (attention rows now point at `/settings`, attention.ts:434). | Two write surfaces for one field; the stale comment will let them drift. | Replace the fold with the spec'd "Edit your profile and booking links → Settings" link — or update the comment and keep both deliberately. |
| Medium | `mentors/[id]/page.tsx:223-225` | "Holding time" rows sort by `deadline` asc but the date is never rendered, and `?? 0` sorts null-deadline rows first. | The promised "soonest use-by first" is invisible and wrong for undated rows. | Show the date in the row (DeadlineText) or sort `null` last. |
| Medium | `allocation-row.tsx:34-40, 402-411` | Staff allocation tables drop the use-by date entirely — visible only inside the ⋮ edit menu (student-facing cards keep it). | The date that forfeits a balance is never glanceable for the person who corrects it; combined with the roster's removed column, no staff list shows a deadline. | Re-add a compact "Use by" cell (or `DeadlineText` under Remaining) on staff allocation rows; keep the chip-removal elsewhere. |
| Medium | `nav.ts:90` + `admin/page.tsx:92` | The page is titled and nav'd "Inbox" but contains no inbox content — active issues live at `/notifications` behind the bell. | The one nav item that names "what's waiting" goes to a page that doesn't answer it; new staff will miss the bell. | Rename the item/page (e.g. "Programs"/"Home") or give the bell a permanent badge-backed label. |
| Medium | `settings/platform/page.tsx` | Missing §6.19's Programs section (status/students/Archive + "New program ▸") and the "Add person" affordance — only existing users can be granted (`:42-52`). | Program creation is only discoverable on `/admin`; a person who hasn't signed in can't be granted at all. | Add a Programs section and an invite-by-email row to the access table. |
| Medium | `students-table.tsx:140-155` | Pending signups render no marker on the roster — only `STUDENT_NOT_SIGNED_IN` is shown, and it excludes PENDING accounts. | Admins scanning the roster can't tell a signup awaits approval; only the bell says so. | Keep the chip ban but add a muted "Pending" text suffix in PersonCell, or surface pending in the roster's subtitle count. |
| Low | `attention.ts:387` | Attention roll-up "N more" links to bare `/students`, ignoring the still-functional `?time=expiring`/`?status=` params. | "5 more expiring students" lands on the unfiltered roster. | Give each rolled-up group a filtered `moreHref`. |
| Low | `students/page.tsx:164` | Mentor subtitle teaches the removed "Mine" preset ("Mine is the ones you hold time with."). | Copy references a control that no longer exists. | Rewrite to describe reach ("Everyone in your programs you may log time with") or drop it. |
| Low | `programs/[id]/settings/page.tsx:232` | `eyebrow="Danger zone"` — banned phrase per REDESIGN §5.7.1; `check-copy.mjs` doesn't enforce it. | Copy-rule violation the lint can't catch. | Rename (e.g. "Permanent") and add `danger zone` to `BANNED`. |
| Low | `programs/[id]/settings/page.tsx:96-115` | Mentor rows lack the booking-link chip spec'd in §6.14. | The page that manages pairings can't show which pairing lacks a link. | Add a muted "(no booking link)" suffix per pairing. |
| Low | `programs/[id]/settings/page.tsx:175-184` | "Granted on Platform settings" is a caption, not a link; the promised "Manage on Platform →" never landed (comment admits commit 49 pending). | Platform admins reading who administers a program must navigate by memory. | Render the `ArrowLink` for `user.platformAdmin`. |
| Low | `notifications/page.tsx` | Spec §6.17's "All · Unread" tabs and "Email preferences →" line are absent (the list does group unread first). | Minor spec drift; no path from the feed to notification prefs. | Add the muted "Email preferences → /settings" line; tabs optional given the grouping. |
| Low | `admin/page.tsx` | Spec'd `Updated HH:MM` freshness stamp absent (§5.8 reserves it for this page alone). | Admin home can't tell the reader when the figures were computed. | Render `formatTime(now)` muted in the title row. |
| Low | `students/[id]/page.tsx:426` | `aria-disabled` + `title` on a live `<a>` — the link still navigates and `title` is invisible to touch/keyboard. | Announced-disabled control that still activates; reason text below partially mitigates. | Render a real `disabled` button with the reason, or remove the control when `!canLog`. |
| Low | `sessions/new/page.tsx:124`, `receipt.tsx:78`, `mentor/page.tsx:303,342` | New code emits `/mentor/students/[id]` — a deprecated route alive only via the 308 map `next.config.ts` says will be deleted. | Links outlive-or-die with the redirect map; extra hop meanwhile. | Emit `/students/[id]` directly at these three sites. |
| Low | `students/page.tsx:84` | Default sort is name asc; §6.8 wanted attention-first ordering. | Spec drift; roster no longer surfaces expiring/overdrawn first. | Confirm the drop is part of the "no chips" instruction, or implement attention-first ordering. |
| Low | `students/[id]/page.tsx:709`, `programs/[id]/page.tsx:301` | "Admin only" eyebrow/marker is a provenance eyebrow; "Super admin" (grants-editor, program settings `LEVEL`) is vocabulary the spec doesn't define. | Minor copy-rule drift; two names for one role. | Rename "Super admin" → "Admin" per §5.7.1; drop or reword the eyebrow. |
| Low | `students/[id]/page.tsx:653-655` | `transferTo` excludes the acting admin — an admin-mentor can't transfer time to themself via the row. | Narrow workflow gap; they'd grant separately instead. | Include `me.id` when the admin is a mentor in that program. |
| Low | `students-table.tsx:272-276` | Remaining shows `/{total}` beneath while a separate Total column repeats the same figure. | Mild redundancy on the roster. | Keep the `/total` suffix and drop the Total column, or vice versa. |

### Deliberate redesign choices confirmed as intentional (not defects)

- No status chips on the students roster except "Not signed in"; no use-by column; no filter chips — owner's instruction, documented at `students-table.tsx:37-43` and `students/page.tsx:186-192`.
- Admin home without Active issues/Up next — owner moved them behind the bell (`admin/page.tsx:13-27`, `notifications/page.tsx:21-37`).
- Mentor "Mine" as a URL lens, not a permission (`students/page.tsx:30-36`, `filters.ts:730-732`).
- Canonical single pages: `/students`, `/students/[id]`, `/mentors`, `/mentors/[id]`, `/settings` — with 308s for every old role-scoped address (`next.config.ts:55-147`).
- Computed sorts loading the full matching set (`students/page.tsx:121-132`) — correct-first choice, sized for this school.
- Scope applied in `where` clauses, never JS `.filter()` — verified at every audited site.
- Mentor seeing a student's whole record on the workspace (unscoped by grants) — documented at `students/[id]/page.tsx:134-148`.
- `aria-disabled`+reason over inventing a permission the action wouldn't enforce — `students/[id]/page.tsx:215-238`.

### Actions the auditor could not perform

- Did not run `npm run lint`/`check-copy.mjs` or the test suite — read-only mode; run `npm run lint` to confirm the "Danger zone" and stale-copy findings surface (or don't).
- Did not verify runtime rendering of the zero-grant `/admin` state or the mentor-lens roster figures against a seeded database — the High findings are code-derived and worth a manual UI check before scheduling fixes.
- `LEADER`/`SALES` seeding state in production data is unknown; if any non-ADMIN `ProgramStaff` row exists in the live DB, finding #1 is live rather than latent — worth an immediate `SELECT role, COUNT(*) FROM ProgramStaff GROUP BY role`.

---

## 17. Programs

### Scope and role-aware access

Program scope is grant-based throughout, exactly as `AGENTS.md` requires. `adminScope()` builds its set from `ProgramStaff` rows only; `platformAdmin` gets the literal `"ALL"` sentinel, and a non-admin role returns an empty scope rather than a role-derived grant (`src/lib/authz.ts:11-35`, `src/lib/authz.ts:59-66`). `requireProgramScope()` translates an out-of-scope id into `notFound()`, so an unreachable program answers identically to a nonexistent one and cannot be enumerated (`src/lib/dal.ts:93-104`, `src/lib/authz.ts:423-439`).

Every page gates itself, per the AGENTS rule that a layout gate is not a gate: `/programs` calls `requireUser()` then branches (`src/app/programs/page.tsx:52-57`); the program layout calls `requireProgramScope(id)` (`src/app/programs/[id]/layout.tsx:55`) **and** both children call it again — roster at `src/app/programs/[id]/page.tsx:68`, settings at `src/app/programs/[id]/settings/page.tsx:56`, allocate at `src/app/programs/[id]/allocate/page.tsx:33`. Server actions gate on the row's own `programId`, never on form input: `setMentorAllocation`/`transferMentorAllocation`/`removeMentorAllocation` all scope against the existing allocation's program (`src/lib/actions/students.ts:1474`, `:1582`, `:1690`), session writes go through `assertTaskScope` on the task's program (`src/lib/authz.ts:301-319`), and exchange writes go through `assertExchangeSender`/`assertExchangeParty` (`src/lib/authz.ts:387-440`).

The profile/lens cookie changes presentation only. `profileOf()` reads it, `canSwitchProfile` restricts switching to users who are `ADMIN` *and* a mentor, and the cookie drives home path, nav, default filters and the primary action — never authority (`src/lib/profile.ts:19-31`, `:50-52`, `:68-73`). This keeps the "staff vs mentor" toggle honest: it cannot widen what the server will answer.

### Program index — `/programs`

The index is three pages in one, forked by access rather than by route (`src/app/programs/page.tsx:55-72`):

- **Mentor lens or empty scope** renders `MentorPrograms` — the mentor's own footprint, not the school's.
- **A scoped admin holding exactly one program** is redirected straight into it (`page.tsx:61-63`).
- **Otherwise** a table of Active/Archived tabs (`page.tsx:139-149`), each row a `ProgramDot` + name chip, Students, Mentors, and Remaining as an orientation figure (`formatRough`, danger-inked when negative) (`page.tsx:104-118`).

`MentorPrograms` renders the mentor's per-program figures — Students, Completed, Remaining — with forfeiture handled correctly at the aggregate (`expired` ⇒ remaining shown as `min(0, remaining)`, `src/app/programs/mentor-programs.tsx:82-84`), and links to `/sessions?program=<id>` rather than `/programs/<id>` because a mentor is entitled to their own session view, not the program's ledger (`mentor-programs.tsx:135-138`). That is a quietly correct distinction.

Microcopy is the redesign voice: "Programs", tabs "Active (n)" / "Archived (n)", empty states "No archived programs", "No programs", and the scope-empty line "Nobody has granted you a program to work in." (`page.tsx:139-161`). Platform admins alone get the create form — consistent with `createProgram` being `assertPlatformAdmin`-gated because a new program arrives with nobody administering it (`src/lib/actions/programs.ts:20-25`).

Audit note: `REDESIGN.md §6.11` specified an **attention count** column on this table; the shipped columns stop at Remaining (`page.tsx:113-118`). `programTotals` computes the missing figures — they're computed but not rendered (see Issues).

### Program shell — `/programs/[id]`

The layout is the masthead for every program page (`src/app/programs/[id]/layout.tsx:69-140`): `ProgramDot` (aria-hidden, name carries identity — `src/components/program-dot.tsx:8-18`), the name as `h1`, an "Archived" chip when closed, then metric chips "Students", "Mentors", "Completed", "Remaining", and "Paid" only when the program bills (`layout.tsx:91-114`). Two actions — "Allocate time" → `/programs/[id]/allocate`, "Log a session" → `/sessions/new?program=<id>` (`layout.tsx:116-131`). Tabs are "Students (n)" and a gear-labeled "Settings" (`layout.tsx:135-169`); the back link points to `/programs` only when the admin actually holds more than one program, otherwise to `/admin` labeled "Inbox" (`layout.tsx:73-79`).

Numbers here are `formatRough` ("212 hrs") — orientation figures by design, with the exact arithmetic living on the roster rows below. That's consistent with `format.ts`'s split between exact ledger numbers and rounded orientations.

### Roster — `/programs/[id]`

The roster *is* the overview: no duplicate stat cards, no second summary — the table itself is the answer to "who's in this program and where does their time stand" (`page.tsx:37-59`). Structure:

- **Students**: `AddStudentsForm` behind a full-width "Add students" disclosure ("New to the school" names the empty-track option), then `StudentsTable` with `showProgram={false}` — the Program column is dropped inside a program's own page, and exchange visitors get the textual "(on exchange)" marker where the column would have been (`page.tsx:76-80`, `src/components/students-table.tsx:181-185`).
- **Exchange section**: "Between programs"/"Exchange" with the caption "Hours one program promises, another delivers", listing both hosted and sent placements, read-only from here (`canReturn={() => false}`) because this page's admins may legitimately administer only one side (`page.tsx:223-242`).
- **Mentors rail**: pairings as "Mentor · Cohort", a crown icon on super admins (`title="Super admin"`), an "Admin only" marker for non-teaching staff, capped at 10 with an "All mentors (n)" link to `/mentors?program=<id>`, and `AssignMentorForm` at the rail foot with "No mentors assigned / Assign one below, or allocate a student time from any mentor and they join this program automatically." as the empty state (`page.tsx:208-317`).

Deliberate departures from `REDESIGN.md §6.12` worth noting in the audit: the spec's Overview tab — with a "Needs attention" `AttentionList` and an "Up next" timeline — was intentionally removed (the page comment calls it "the duplicate it stood for", `page.tsx:46-47`). In exchange, program-level attention now lives **only** in the global bell, where rows are capped (see Issues).

### Allocate — `/programs/[id]/allocate`

Student-first, matching `REDESIGN.md §4.1`: one `ParamSelect` for `?student=` whose options carry the live hint "Nh Nm remaining" computed against *this* program's figures only — `programStudents`/`studentsOf` scope everything by `programId` (`src/app/programs/[id]/allocate/page.tsx:33-59`, `src/app/programs/reads.ts:117-143`). `AssignTaskForm` receives `programs={[{ id }]}` so the program select collapses to a hidden field, mentors are limited to this program's pairings, and the payment field appears only when `program.tracksPayment` (`allocate/page.tsx:68-93`, `src/components/forms/assign-task-form.tsx:63-113`). Copy: "Allocate time", caption "In {program}", "Who is this for?"/"Search the roster…", "No one yet — decide later", "Minutes *", "Use by *" with `min={today}` in program-local time, "Paid for these hours ($)", "Allocating…" (`assign-task-form.tsx:117-199`).

### Settings — `/programs/[id]/settings`

Four sections, each answering one question (`src/app/programs/[id]/settings/page.tsx:85-243`):

- **Mentors** — one `SettingsRow` per pairing, `RemoveMentorButton` as the destructive control, `AssignMentorForm` at the foot (`:103-133`).
- **Cohorts** — "12 students · 3 mentors" rows; delete is offered only when empty, in-use rows render the disabled caption "Not empty — move its people first" (`:199-216`), which matches `deleteCohort`'s server-side refusals verbatim (`src/lib/actions/programs.ts:107-118`).
- **Admins** — read-only `ProgramStaff` list with role labels ("Super admin"), caption "Granted on Platform settings", empty state "Nobody is granted this program / Only platform admins can see it until somebody is." (`:175-196`) — correctly refusing to pretend a program admin can hand out access.
- **Program** — `RenameProgramForm`, `TrackPaymentToggle`, `ArchiveProgramForm` ("Archive this program", "For a program that has finished. It leaves the pickers and the lists; every ledger page stays reachable."), and `DeleteProgramButton` under "Delete this program / Only possible once nothing is left in it" with a computed `blockedReason` (`:70-80`, `:226-243`). Archive reversibility and delete finality are distinguished by copy, matching the actions (`programs.ts:149-188`, `:241-290`).

### Legacy redirect — `/programs/[id]/students`

A pure redirect preserving search params, so old bookmarks and links — including stored notification hrefs normalized through `neutralHref` — keep resolving (`src/app/programs/[id]/students/page.tsx:5-27`). It joins the `MOVED` map in `next.config.ts` (308s with a mandatory `why` per entry — `/admin/programs/:id`, `/admin/programs/:id/students`, `/mentor/sessions`, `/admin/students/:id`, `/leader/*`, `/sales/*`), which is exactly the address-consolidation discipline `REDESIGN.md` demanded (`next.config.ts:55-147`, `:197-206`).

## 18. Ledger & hours components

### Arithmetic

One source of truth, as required. `allocationSummary()` aggregates per `(program, mentor)` keys — never `(student, mentor)` — with `used`/`missed`/`extra` from session `groupBy` on `programId + mentorId + attendance + kind`, `forfeited` computed per allocation against *its own* deadline, `remaining` written down to zero on expiry, and derived rows synthesized for mentors who hold sessions but no grant (`src/lib/hours.ts:46-213`). `soonestExpiry()` pairs the soonest date with **only** the minutes attached to that date rather than summing all balances (`hours.ts:74-102`). `programTotals()` then rolls the same entries into program-level `allotted/completed/missed/remaining/forfeited/extra/paid/overdrawn` (`hours.ts:282-305`) — several of which never reach the masthead.

Deadlines are hard boundaries in Tashkent-local days: `programDayEnds` (`src/lib/when.ts:67-69`), `deadlinePassed` (`src/lib/deadlines.ts:12-14`), `LATE_LOG_GRACE_DAYS = 14` with `chargeableAgainst` allowing a pre-deadline session to be logged inside the grace window (`deadlines.ts:25-52`), and `expiredDate`/`expiry` helpers that mark a single allocation rather than a whole ledger (`deadlines.ts:74-102`).

### Balance presentation

- **`HoursRing`** — center figure is remaining (or overdrawn), the "gone" sweep is `used + forfeited`, with an `sr-only` "of X total" (`src/components/hours-ring.tsx:50-58`, `:107-115`). The student home leads with it under "Your time" (`src/app/student/page.tsx:218-263`).
- **`HoursBreakdown`** — one track scaled to total, segments for Completed, "Missed, charged" (striped), an overhang for Overdrawn, and Total — but **no forfeited/expired segment**, an explicit design decision noted in its header comment (`src/components/hours-breakdown.tsx:7-24`, `:71-170`).
- **`AllocationMeter`** (student/mentor surfaces) — `Meter` with `role="progressbar"` + `aria-valuenow/max/label`, "Xh of Yh completed · Zh missed", and "Use by `<DeadlineText>`" (`src/components/allocation-row.tsx:237-287`; `src/components/ui/meter.tsx:7-60`). `DeadlineText` renders "· expired" red, "· 3 days"/"· today"/"· tomorrow" amber inside the program's warning window (`src/components/status-chip.tsx:103-150`).
- **Staff `AllocationsTable`/`AllocationRow`** — columns Mentor [Program] Completed, Missed, Remaining, Assigned, [Paid], ⋮. Missed prints "—" at zero and warn-ink above it; Remaining red at 0; the **use-by date is deliberately not a column** — it lives in the ⋮ menu's "Use by" sub-row and in the bell (`allocation-row.tsx:34-40`, `:340-378`).

### Sessions and corrections

`/sessions` filters strictly by the viewer's reach — a mentor's rows are forced to their own via the `reach` object (`src/app/sessions/page.tsx:64-66`), a program select appears only when the admin holds more than one program (`:79-89`), and the summary line reads "Xh logged · Yh missed · Zh extra · {filterSummary}" (`:199-212`). `/sessions/new` is the dedicated form: `TimeKindPicker` radios "Plan"/"Extra", attendance segmented with "No-show, time charged"/"Rescheduled, no time charged", the student picklist grouped by program with `Heads up:` expired/extra coaching, and URL-backed draft fields (`src/app/sessions/new/page.tsx:43-167`, `src/components/forms/time-kind-picker.tsx:6-37`). Voiding returns the charge and says so — "Session voided; hours returned." — with receipts naming exactly what was given back (`src/lib/actions/sessions.ts:1105-1121`).

### Transfers and removals

`transferMentorAllocation` moves only *unused* minutes, re-checks the cap inside the transaction (`TransferExceedsBalance`), keeps the later deadline, splits recorded payment proportionally, writes paired `HourAllotmentChange` rows on both sides, optionally moves open tasks, and notifies all three parties with distinct sentences (`src/lib/actions/students.ts:1658-1901`). The UI reaches it through the ⋮ menu's "Move time to another mentor" group, shown only when there is something unused to move and someone to move it to, with the honest footnote "Logged time stays with the current mentor. The student's total doesn't change." (`src/components/hours-forms.tsx:161-170`, `:222-268`). `setMentorAllocation` writes its own `HourAllotmentChange` and notifies student + mentor (`students.ts:1237-1501`).

### Exchanges

`exchangeFigures()` computes cap/allocated/used/missed/remaining/extra purely from stamped rows (`src/lib/exchanges.ts:45-92`); `ExchangeList` renders "Sender → Host", chips "Called off" / "Xh to allocate" / "Ran out", the "Xh · use by October 7" line, "Sent by …", a figures line "Xh on A, B · Yh completed · Zh remaining · Wh extra", and sessions folded under "Sessions" (`src/components/exchange-panel.tsx:13-131`). `sendOnExchange` restricts senders to their own programs, refuses archived hosts, treats a repeat send as a top-up that raises the cap while keeping the *later* deadline, enrolls in a transaction, and notifies host staff, home staff, and the student (`src/lib/actions/exchanges.ts:75-272`). `returnExchange` is refused once sessions exist — "Time has already been logged in {host} under this exchange, so it's history rather than an arrangement. Void those sessions first if it truly must go." — and otherwise removes the placement and its unspent grants (`exchanges.ts:288-375`).

### Audit history and notifications

The student page's "History" disclosure renders "Aug 30 — Malika set Aziza: 0h → 7h" rows (`src/app/students/[id]/page.tsx:674-705`), but the query is capped at `take: 20` and `count` reports the fetched slice (`:163-169`). `/notifications` is the single combined destination — "Active issues" (`AttentionList`), "New for you" / "Earlier" feed, category chips only when more than one category exists, "Mark all read", 50-per-page "Load older" pagination (`src/app/notifications/page.tsx:78-197`). Rows are plain `<a>` to `/n/[id]` — deliberately not `<Link>` so prefetch can't mark a notice read; the route marks-read-then-302s with an open-redirect guard and `neutralHref` remapping stale role-scoped hrefs (`src/components/notification-list.tsx:25-103`, `src/app/n/[id]/route.ts:11-91`, `src/lib/notify.ts:133-153`). Recipients are deduplicated, the actor excluded, and program events go to that program's staff plus platform admins (`src/lib/notify.ts:43-130`). Deadline reminders are produced only by the `CRON_SECRET`-guarded `/api/cron/deadline-reminders` route (`src/app/api/cron/deadline-reminders/route.ts:15-29`).

### Accessibility and responsive behavior

The primitives back the "numbers are the interface" claim with real semantics: `Meter` exposes `progressbar`/`aria-valuenow` (`meter.tsx:36-60`); `Popover` distinguishes `role="dialog"` (fields) from `role="menu"` (actions), uses `aria-haspopup/expanded/controls`, capture-phase Escape layering, focus restore, and becomes a bottom sheet with swipe-down on mobile (`src/components/ui/popover.tsx:18-58`, `:337-405`); `ConfirmInline` steps through a two-stage confirm with `role="alert"` consequences, `aria-describedby` disabled reasons, and Escape that steps back rather than closing outright (`src/components/ui/confirm-inline.tsx`); `Field` wraps controls in `<label>` with `min-h-11` and `text-base` on mobile to stop iOS zoom (`src/components/ui/field.tsx:9-49`); `PageSkeleton` announces via `role="status" aria-live` (`src/components/page-skeleton.tsx:11-35`). Responsive: tables stack below `sm` with `data-label` pseudo-labels (`globals.css`), `RowFold`/`data-fold` hides secondary cells behind a 44px disclosure (`src/components/ui/row-fold.tsx:8-54`, `globals.css:670-673`), font compaction is ≥`sm` only (`globals.css:235-264`), and `prefers-reduced-motion` kills view-transitions and decorative animation (`globals.css:820-861`). `SegmentedRadio` is real radios, sr-only, so arrow keys work natively (`src/components/ui/segmented.tsx:64-304`).

### Issues found

**High**

1. **Audit rows are deleted, not appended to.** `removeMentorAllocation` deletes the grant's `HourAllotmentChange` rows alongside the allocation (`src/lib/actions/students.ts:1603-1627`), and `returnExchange` deletes **every** `HourAllotmentChange` the visitor has in the host program — scoped only to `{studentId, programId}`, not to the exchange's own grants (`src/lib/actions/exchanges.ts:334-350`). `rejectStudent`/`deleteStudent` also delete changes (`students.ts:1463-1501`, `:1819-1837` context). PRODUCT.md requires every hour change to remain auditable; after a removal the History disclosure silently claims completeness it no longer has. Fixes should write a terminal "removed" change row instead of erasing the trail.

2. **History is capped at 20 with a misleading count.** `take: 20` on the changes query, then `<Disclosure count={changes.length}>` reports the slice as the total, and there is no "showing latest 20" label, pagination, or dedicated history route (`src/app/students/[id]/page.tsx:163-169`, `:674-705`). For a ledger product, "the 21st change is unreachable" is a first-order gap, compounded by issue 1.

3. **Forfeited minutes are invisible where staff read balances.** `AllocationEntry` carries `forfeited`/`expired`, but `AllocationRow` renders neither a use-by column nor a forfeited figure — the date was deliberately moved into the ⋮ menu (`src/components/allocation-row.tsx:34-40`). An expired grant reads "Remaining 0", identical to a fully spent one; `HoursBreakdown` likewise omits forfeiture by design while `HoursRing` counts it in the "gone" sweep (`hours-breakdown.tsx:7-24`, `hours-ring.tsx:50-58`). The only places forfeiture is *named* are the capped, dismissible bell rows and per-card meters — the staff ledger table, where "deadlines decide," never says what was lost.

4. **Program surfaces under-report totals the system already computes.** `programTotals()` yields `missed`, `forfeited`, `extra`, `overdrawn` (`src/lib/hours.ts:282-305`); the masthead shows only Students/Mentors/Completed/Remaining(+Paid) (`layout.tsx:91-114`) and `/programs` shows Remaining alone (`page.tsx:104-118`). REDESIGN §6.11's attention column is absent, and with the §6.12 Overview tab removed, program-level "needs attention" exists only behind the global, capped bell — a program's own page cannot say what it owes.

5. **`deleteProgram` can pass its emptiness check and still fail at the database.** The guard blocks on `enrollments` and `staffGrants` only (`src/lib/actions/programs.ts:262-278`), but `Session`, `HourAllotmentChange`, `Assignment`, `StudentTask` and `HourAllocation` are all `ON DELETE RESTRICT` (see `prisma/migrations/20260906120000_students_in_many_programs/migration.sql:93`, `:127`, `:153`). A program whose students were *unenrolled but kept in other programs* retains Session rows → the tx throws an opaque FK error instead of the friendly "Move them first" copy the settings page promises. Either count sessions in `blockedReason` or refuse with the same vocabulary.

**Medium**

6. **Exchange "Ran out" fires ~19 hours early.** `ExchangeList` compares `e.deadline < viewer.now` (`src/components/exchange-panel.tsx:78-84`) while the domain rule is `deadlinePassed` = end of the Tashkent use-by day (`deadlines.ts:12-14`, `when.ts:60-69`). A deadline stored as UTC midnight is 05:00 Tashkent — the chip declares "Ran out" at breakfast on a day the hours remain usable.

7. **Exchange figures never report forfeiture or missed.** `exchangeFigures` computes `missed` and returns `remaining = allocated − used` with no deadline write-down (`src/lib/exchanges.ts:66-92`); a "Ran out" exchange still prints `remaining`/`unallocated` as if spendable, and the no-show subset is dropped from the UI entirely (`exchange-panel.tsx:97-105`) — asymmetric with the main ledger's explicit missed/forfeited treatment.

8. **Ledger scroll panes are unreachable by keyboard.** `LedgerBoard`'s Meetings/Progress/Agenda panes are `max-h-[40svh] overflow-y-auto` `<div>`s with no `tabindex`, so keyboard-only readers cannot scroll them (`src/components/ledger-board.tsx:70`, `:211`, `:269`, `:330`).

9. **Explanatory status lives only on `title`.** `StatusChip` carries forfeiture/no-show explanations in a `title` tooltip (`src/components/status-chip.tsx:67`); copy like "expired unused" reasoning never reaches touch or keyboard readers, who see the tone and glyph but not the why.

10. **Meter semantics disagree with the visual.** `AllocationMeter` paints `gone` (used + forfeited) but sets `ariaValueNow={used}` — assistive tech hears a smaller spend than the bar shows (`allocation-row.tsx:250-266`).

11. **`removeMentorAllocation` notifies only the student.** The mentor loses the pairing, the grant and their open tasks with no notification (`students.ts:1611-1619`), inconsistent with transfers and exchanges which tell every affected party.

12. **History rows omit the program.** `c.program` is fetched but never rendered — on a multi-program student, a platform admin sees one merged history with no way to tell which program each change belonged to (`students/[id]/page.tsx:166`, `:683-700`).

13. **`/sessions/new?program=` doesn't narrow the student picklist for admin-mentors.** The `programIds` filter applies only `onBehalf` (`src/app/sessions/new/page.tsx:82-92`, `:104-110`), so "Log a session" from a program header drafts the program chip but still lists the mentor's whole cross-program caseload.

**Low / verify**

14. `MentorPrograms` omits missed/forfeited entirely — the mentor sees "Completed" and "Remaining" only (`src/app/programs/mentor-programs.tsx:103-163`); likely intentional focus, but it leaves the mentor's own ledger less honest than the admin's.
15. `AssignTaskForm` uses bare `<span>` labels above `Select`s (covered by `ariaLabel` on the control, but the visible label isn't clickable/linked) and `*` markers are visual-only with no `aria-required` (`src/components/forms/assign-task-form.tsx:75-103`, `:140-167`).
16. Settings' Admins caption "Granted on Platform settings" lacks the §6.14 "Manage on Platform →" link for platform admins (`src/app/programs/[id]/settings/page.tsx:183-196`).
17. Attention rows cap at 20 (staff) / 10 (mentor) with rollup above 3 (`src/lib/attention.ts:63-80`); the "N more →" spillover exists, but verify every rolled-up status preserves student + program context on `/students`.
18. Popover focus containment/return and `ConfirmInline` focus management are implemented per source comments — verify in a real browser/keyboard pass before signing off on WCAG 2.4.3/4.1.3 behavior.
19. The `/programs/[id]/students` redirect preserves query and joins the documented `MOVED` map — correct; note only that the labeled "Students" tab resolves to the program root, so the tab name describes a section, not an address.

---

## 19. Mentor home

**Route & audience.** `/mentor`, the `ROLE_HOME` for mentors (`src/lib/constants.ts:475-483`). Gate: `requireMentor()` on the first line before any query (`src/app/mentor/page.tsx:81`), which also lets dual-role admins (`canActAsMentor`, `constants.ts:467-472`) use it.

**Primary questions.** The page is deliberately organized around three: *what needs my answer*, *who am I seeing this week*, *who is running out of time* — replacing the old homepage that mixed lifetime stats, program islands, diary, a notification feed, and an embedded logging form.

**Layout & hierarchy.** `PageTitle` ("Inbox", `page.tsx:180-183`) → `AttentionList` (shared with `/notifications`) → a `Section` titled "Your students" (`:230`) with program filter tabs (`:239-241`) and a caseload table. Logging lives on its own page; the homepage no longer embeds a form — the single largest anti-noise win in the audit scope.

**Copy (verbatim).** `"Inbox"`; tabs `"All"` / program names; row-cap toggle `"First 8"` / `"All {n}"` (`:256-268`); empty states `"No programs yet"`, `"Nobody holds time with you"`, `"An admin has to add you to a program."`, `"An admin allocates it. You can still log a meeting with anyone in your programs."` (`:278-281`). Remaining-time cells show an em dash when nothing was allocated rather than a misleading `0h`.

**States.** Empty: three distinct variants via `EmptyState` (blocked variant gets `text-warn-ink` only — no red panel, per `empty-state.tsx:60-63`). Loading: `PageSkeleton` inside the shell so chrome holds still (`sessions/loading.tsx:1-12`, same pattern). No pending/error surface of its own; errors arrive through `AttentionList`.

**Interactions & navigation.** Program tabs and the 8-row cap are URL-backed (`?all=` etc.). Rows link to student detail. **Finding:** links still point at the legacy `/mentor/students/${id}` (`page.tsx:303, 342`); `next.config.ts` redirects these to `/students/:id`, so they work but cost an extra hop and keep obsolete role-specific vocabulary in the source.

**Component design strengths.** `PersonCell` + `ProgramChip` deduplicate identity rendering; the program column appears only when the rows actually span programs (`:29` comment); a two-program student correctly becomes two rows — consistent with the multi-enrollment model.

**Responsive & a11y.** The shared `Table` collapses to labelled stacks below `sm`, with `Td label` re-stating each column name (`ui/table.tsx:103-131`) — no horizontal scroll, no hidden data. `DeadlineText` renders `Sep 30 · 6 days` / `· expired` so the one destructive date is never silent (`status-chip.tsx:119-148`).

**Risks / open questions.** (1) The title is "Inbox" but the page is now inbox + caseload; a mentor with no active issues and 30 students lands on a table under a heading that says neither. Worth deciding whether the page is "Inbox" or "Home/My students" — there is deliberately no Students item in the mentor rail, so this page carries both jobs. (2) 8-row default cap is good; verify the "All N" toggle state survives navigation back.

---

## 20. Sessions

**Route & audience.** `/sessions` — unified ledger for mentors and staff; `/mentor/sessions` redirects here. Gate: `requireUser()` first (`src/app/sessions/page.tsx:51`); mentors see only their own sessions, staff see granted-program scope.

**Primary question.** *What happened, and what did it cost?*

**Layout.** `PageTitle` ("Sessions" + "Log a session" action, `:243-244`) → `FilterBar` (`:92`) → summary line → `SessionsList` → `Pagination` (25/page, `:226-237`).

**Copy.** Summary reads `{n} logged · {n} missed · {n} extra` (`:201-205`); empty state `"Nothing logged yet"` + `"A mentor logs each meeting once it has happened."` (`:220`); filtered empty: `"No sessions match these filters"` with a reset link.

**Rows.** `SessionRow` is a two-line responsive item replacing the old six-column table: date, people, duration, task, note, program, status chips, and row actions. Statuses derive from one function (`sessionStatuses` + `ATTENDANCE_META`/`TIME_KIND_META`, `constants.ts:122-215`), so "No-show, time charged" / "Rescheduled, no time charged" / "Extra, no time charged" are the only vocabularies — no page invents its own.

**Corrections.** Staff and the originating mentor edit; admins delete; void/restore return time transactionally (`lib/actions/sessions.ts`). `RowActionMenu` consolidates what were four drifted copies into one popover with focus containment/restore, Escape, outside-click, 44px mobile trigger (`ui/row-action-menu.tsx:9-38, 84-97`). Inline autosave edits go through `PATCH /api/sessions/[id]` (`route.ts:5-21`) precisely so the open editor isn't clobbered by a fresh RSC tree — a thoughtful detail.

**Log-a-session flow** (`/sessions/new`). Dedicated page, reachable with prefilled `?student&program&assignment&minutes&date&note&attendance&timeKind`. Admins can log on behalf of a mentor; the caseload reloads on mentor change. Failed submits echo entered values back. Success renders a `Receipt` — headline + consequence notes + edit/"log another"/subject links (`actions/sessions.ts:629-702`), including genuinely good accounting explanations, e.g. overdraw with no allocation: `"no time is allocated… Ask an admin to allocate it, or correct this session to extra time."` (`:686-689`), and pool-carve explanations (`:668-671`). A double-submit guard identical `(mentor, student, minutes, date)` within 60s refuses a twin (`:416-431`).

**Form design.** Two segmented-radio pickers ask the two cost questions plainly: `AttendancePicker` ("How did it go?" — Attended/Came late/Absent/Rescheduled, forced 2×2 grid, `attendance-picker.tsx:33-47`) and `TimeKindPicker` ("Whose hours?" — `time-kind-picker.tsx`). Per-option explanatory sentences were deliberately cut as weekly-use noise (`constants.ts:127-132`) — consequences are stated on the logged row instead, where they're facts. This is a defensible tradeoff but a real one: a first-time mentor no longer learns *in the form* that Absent still charges time; they discover it on the row and in the student notification (`sessions.ts:567`). Voice dictation (`/api/notes/dictate`) is gated per-request with reach checks (`route.ts:31-65`) and sends spelling hints (student + program names) server-side only.

**Hours accounting.** Cleanly enforced by `chargesAllocation`/`CHARGED_SESSION` (`constants.ts:241-252`): ACTIVE+in-plan charges; extra charges nothing; rescheduled/voided don't count. Deadline refusals apply only when an allocation/pool exists (`sessions.ts:379-392`) — an expired allocation blocks in-plan logging; no allocation warns and overdraws rather than blocks.

**Privacy.** Corrections notify student + staff; on-behalf logging notifies the named mentor, who "cannot be left to discover" a session in their name (`:573-585`).

**Risks.** (1) **Density:** with student + mentor + long task + note + program + two chips + ⋮ menu, a row can still carry ~8 elements; the clamp/`ExpandableText` (1-line inline toggle, `expandable-text.tsx:21-24`) mitigates but doesn't eliminate. (2) "logged" headline excludes extra hours — semantically right, but a glance-reader may misread the total; consider a `title`/footnote explaining the split. (3) Cognitive load on `/sessions/new`: student, program, attendance, time kind, task, minutes, date, note, (admin: whose session) is a lot of simultaneous decisions even though each is individually well-designed. (4) Receipt plays a confirmation tone — verify it respects a user preference and that the receipt region announces to screen readers (the `SaveState` pattern of permanently-mounted `role="status"`/`role="alert"` regions, `save-state.tsx:145-199`, is the model to match). (5) Back links may still target `/mentor/students/:id`.

---

## 21. Feedback

**Route & audience.** `/feedback` unified for staff and mentors (sales excluded). Gate: `requireUser()` (`src/app/feedback/page.tsx:125`); mentors get `OwnRatings` (`:168`), staff get `AllRatings` (`:263`) — one page, two correctly different answers.

**Primary questions.** Mentor: *what are students saying about me?* Staff: *which mentor needs attention?* — the mentors table is ordered **worst average first** (`:294-295`), a good editorial choice.

**Layout (staff).** `PageTitle "Feedback"` with a standing subtitle (`:403`) → filter bar (mentor, program, rating threshold, date, search) → "Mentors" table (top `WORST_SHOWN`, `:398, :451`) → "Ratings" list (`:478`). Table and list share one `where` — "a filtered list beside an unfiltered average is two answers to one question" (`:260-262`).

**Copy.** `"Feedback"`; `"No ratings"` + `"A student rates a mentor from their own feedback page."`; filtered: `"Widen the window, or reset to read every rating."` Mentor view: `"No ratings yet"`. `Anonymous` replaces the student name when the reader is the rated mentor (`:514`).

**State handling.** Average + count + stars in the table; `AverageStars` is `aria-hidden` because the number beside it already says the fact — with the reason written down (`:584-600`). Comments clamp through `ExpandableText`. Low flags: `LOW_AVERAGE` average or `LOW_RATING` recent score mark a mentor row (`:354, :373`).

**Privacy.** Rated mentor sees `Anonymous`; scope derives through student enrollments, correct per the multi-enrollment rule. The anonymity promise, however, lives **only in a `title` attribute** (`<span title="A rating of you stays anonymous…">`, `:514-515`) — invisible to touch users and inconsistently announced by screen readers. On the student-facing `/student/feedback` side, mentors offered come from allocations/past sessions; `"Your program pairs you with one first."` covers the no-mentor case.

**Risks / follow-ups.** (1) The page *surfaces* a low score but defines no next step — no owner, no acknowledgement, no link into the attention queue. A red-flagged mentor row and "now what?" are one click apart in intent and nowhere in the UI. (2) Mixed-purpose density: performance table + individual comment stream on one screen is justified for staff but heavy for mentors, who mercifully get the simpler `OwnRatings`. (3) Is anonymity the right model if students can write identifying comments? Worth a content-moderation question.

---

## 22. Notifications

**Route & audience.** `/notifications`, everyone signed in. Gate: `requireUser()` (`src/app/notifications/page.tsx:74`). Scoped strictly `userId: user.id` (`:82`).

**Primary questions.** *What needs me?* then *what happened?* — in that order, deliberately (`:31` comment).

**Layout.** `PageTitle "Notifications"` (`:125-127`) → `AttentionList "Active issues"` (`:130-132`) → history `Section` titled `"New for you"` when unread else `"Earlier"` (`:154`) with `"Mark all read"` (`:159`) → category chips (`:178`, rendered only when more than one category exists) → `NotificationList` → `Pagination` (50/page).

**Copy.** `"Active issues"`, `"Mark all read"`, `"Nothing has happened yet"` (`:185`), `"No notices for you."` in the bell preview. Categories read human: "Time", "Sessions", "Tasks and agenda", "Deadlines", "Accounts" (`constants.ts:353-359`), each row labelled via `NOTIFICATION_META` (24 types → short label + one of five tones, `:428-460`).

**Row & read semantics.** `NotificationList` uses **plain `<a>`** to `/n/[id]` — deliberately avoiding `next/link` prefetch, because `GET /n/[id]` marks the notice read, revalidates the shell, normalizes legacy stored hrefs, and rejects external/protocol-relative targets (`app/n/[id]/route.ts`). Tradeoff is real and intentional: it makes middle-click/open-in-new-tab *also* mark read — the cost of correct prefetch behavior, worth surfacing in the audit rather than calling it a bug.

**Unread signal — finding.** Unread is conveyed by a dot + tint + weight, and the dot is `aria-hidden` with no text equivalent: screen-reader users can't distinguish read from unread rows. Needs `sr-only "Unread"` or an `aria-label`/`aria-current`-style marker.

**Active issues.** `AttentionList` centralizes what used to be duplicated homepage feeds: status chip, subject, one-clause explanation, program, inline actions (e.g., `ApproveStudentButtons`), optional dismiss. Whole row links only when there's no inline action — avoids nested-interactive anti-pattern. `ApproveStudentButtons` mounts persistent live regions so errors announce reliably.

**Chrome integration.** Two bells, one per breakpoint: a plain link in the mobile top bar (`app-shell.tsx:56-87`, with `aria-label="Notifications (N unread)"`) and a 6-item popover on desktop (`:344-346`). Brand-blue badge, not red — "unread mail is not a problem" (`nav-links.tsx:79-83`). `settlingIn` swaps PENDING/UNASSIGNED users to `PublicShell` so half-onboarded accounts never see full nav (`app-shell.tsx:432-448, 467-468`).

**Risks.** (1) Active issues + full history on one page is coherent but a long scroll for active admins; the cap is pagination only. (2) Rows carry type chip + actor badge + relative time + message + dot + chevron — still six competing elements per row; the chips help scanning but this is the densest list in the audited scope. (3) `"Mark all read"` applies only to the current user's notices — correct, though unlabeled as such.

---

## 23. Analytics

**Route & audience.** `/analytics` for admins, dept leaders, sales, **and mentors**; students denied. Gate: `requireRole(ADMIN, DEPT_LEADER, SALES, MENTOR)` at `src/app/analytics/page.tsx:28` — and duplicated in `layout.tsx` only as backup, with a comment explaining that the page gate is the real one.

**Primary questions.** *How many hours did we deliver — where, and by whom?*

**Data model.** `analyticsData(undefined)` loads active sessions once (`page.tsx:34`) as compact arrays — program index, mentor index, **opaque student index**, day key, minutes, kind (`lib/analytics.ts`). No student names or IDs reach the client; voided/rescheduled excluded; kinds = Completed / Extra / No-show (`analytics-math.ts:14-16`). All math is pure client-side (`analytics-math.ts`), including the honest `change()` that returns `null` rather than `+∞%` (`:170-176`).

**Drill model.** URL-backed state `?y=&m=&p=&u=` — shareable, back-button-correct. Hierarchy: school → year → month → day. Copy: `"Analytics · hours delivered"`, `"All programs"`, `"Month by month"`, `"Pick a month to open it day by day."`, `"Inside {Month}"`, `"Works in {program}"`, `"#1 of N mentors"`, heatmap legend `"Less"`/`"More"`.

**Accessibility done right.** Chart columns and heatmap cells are `<button>` with `aria-label`/`aria-pressed`; sparklines are `aria-hidden`; `prefers-reduced-motion` is handled in `dashboard.module.css`. This is well above the norm for internal dashboards.

**The two real concerns.** (1) **Privacy scope:** every mentor sees *every* mentor's hours school-wide — a documented, intentional decision (route comment), but it's a leaderboard of peers shown to the people ranked. Combined with `"#1 of N"` framing it invites comparison anxiety; worth re-confirming this is desired, or scoping mentors to their own programs/themselves. (2) **Density vs. the stated goal.** Year controls + 12 stacked columns + day drawer + 365-cell heatmap + rankings table + program chips + sparklines is a lot of simultaneous information for a platform whose explicit direction is "super clean, no noise." Program colors come from an 8-slot fixed palette (alphabetical slot → color); consistent, but beyond 8 programs colors recycle, and several saturated categorical colors on screen at once is exactly the "too many colors / clowny" complaint — encoded systematically but still present. Staged disclosure (summary first, drill on demand) and defaulting a mentor to their own row would cut both issues at once.

---

### Issues found

| Severity | Screen | Issue | Evidence | User impact | Recommended direction |
|---|---|---|---|---|---|
| High | Analytics | All mentors see all mentors' school-wide hours with rank framing (`#1 of N`) | `analytics/page.tsx:28-34`; `dashboard.tsx` rankings | Peer-surveillance feel; conflicts with calm/quiet positioning | Re-confirm intent; consider scoping mentors to self/own programs or de-emphasizing rank |
| High | Analytics | Dashboard density: year/month/day drill + heatmap + table + sparklines + chips on one page | `dashboard.tsx`; `dashboard.module.css` (8-color palette) | Cognitive overload; "clowny" color risk beyond 8 programs (slots recycle) | Staged disclosure; reduce simultaneous hues; default mentors to their own scope |
| Medium | Mentor home, Sessions | Legacy `/mentor/students/:id` hrefs remain in source | `mentor/page.tsx:303, 342`; `/sessions/new` back links | Extra redirect hop; stale role vocabulary | Point links at `/students/:id` directly |
| Medium | Notifications | Unread state is visual-only: dot is `aria-hidden`, no text equivalent | `components/notification-list.tsx` | Screen readers can't distinguish read/unread | Add `sr-only "Unread"` or aria-label semantics |
| Medium | Notifications | GET marks read — middle-click / open-in-new-tab clears unread | `app/n/[id]/route.ts`; plain anchors in `notification-list.tsx` | Accidental read state loss | Intentional tradeoff — document for users or add explicit "keep unread" |
| Medium | Feedback | Low ratings surfaced with no owner, acknowledgement, or next step | `feedback/page.tsx:354, 373, 451` | Flagged mentors languish; signal without workflow | Feed low ratings into `AttentionList` or add assignment/acknowledgement |
| Medium | Feedback | Anonymity promise communicated only via `title` attribute | `feedback/page.tsx:514-515` | Invisible on touch; inconsistently announced | Visible footnote or sr-only explanation |
| Medium | Log session | One form carries student, program, attendance, time-kind, task, mentor (admin), minutes, date, note | `sessions/new`; `attendance-picker.tsx`, `time-kind-picker.tsx` | First-use cognitive load; "Absent still charges" not explained in-form | Progressive disclosure; one-line consequence hint per picker |
| Low | Sessions | "logged" headline excludes extra hours; split unexplained at a glance | `sessions/page.tsx:201-205` | Misread totals | Footnote/tooltip clarifying the split |
| Low | Sessions/home rows | Rows can stack ~8 elements (people, task, note, program, 2 chips, menu) | `components/session-row.tsx` | Density undermines "no noise" goal | Prioritize primary line; demote chips/metadata at small widths |
| Low | Mentor home | Page titled "Inbox" but is inbox + caseload; no Students nav item | `mentor/page.tsx:182`; `lib/nav.ts` | Naming/IA ambiguity | Rename title or split caseload section |
| Low | ExpandableText | "Show more/less" toggle lacks `aria-expanded`/`aria-controls` | `components/expandable-text.tsx:62-73` | SR users don't hear collapsed state | Add aria-expanded wiring |
| Low | StatusChip | `explanation` only on `title` — hover-only detail | `ui/status-chip.tsx:67` | Touch users never see it | Fine for non-essential; render where consequential |

---

