# Design system

## Register

Product UI. A role-based mentoring ledger for staff, mentors and students. The
numbers are the product, so the design's job is to make them fast to read and
impossible to mistrust.

It gets there by subtraction, not by force. The page this system was written
against was `mentor/page.tsx` at 634 lines — a greeting banner, six lifetime
figures, program "islands", an empty diary, a nine-column table and two
complete forms — and none of it answered the question a mentor opened it with.
Hierarchy is what replaced all that: weight, size and space, one rule where a
container used to be. "Bolder" here means the lead figure is unmistakably the
lead, not that anything is louder.

`REDESIGN.md` is the contract this file describes the surface of. Where the two
disagree, `REDESIGN.md` wins and this file is out of date.

## The two rules

`REDESIGN.md` §1 lists nine rules the whole reorganisation obeys. Seven are
about routes, authority and copy. These two are about design, and every section
below is downstream of them.

**One `h1`, one lead figure, hairlines.** No banner wash, no ghost monogram, no
tinted panel header, no stat strip. A section is a title, an optional count, an
optional action, one rule. The habit this bans is the strip of four to seven
equally-weighted figures that opened nine pages: when every number is the same
size the eye has to read all of them to find the one that matters, which is the
same as having no lead at all.

**Status is a word with a glyph.** Four severities, two chromatic hues, a glyph
on every chromatic chip. Never colour alone. A caller cannot pick a colour — it
picks a severity, and severity picks the colour. That is what stopped "Booking
link set" being the same green as "Done", and a mentor's identity chip the same
amber as "No-show".

## Color

Colour identifies; it never decorates. The palette is **28 tokens**, down from
47, and **three** identity hues, down from eight. Every hue answers a question
the reader would otherwise work out by reading.

- **Brand** (`brand` #124b84, `brand-dark` hover, `brand-soft` tint) is
  structural chrome, links, the primary action, focus rings, selection and
  unread. It is **never a status**. The bell's unread count is `brand`, not a
  red badge; sign-out hover is canvas and ink, not red.
- **Accent** (`accent` #f18d05, and `accent-ink` — the same hex, for text)
  means **hours and progress, and nothing else**: `Meter` fills, the
  `HoursRing` stroke, `HoursBreakdown`'s completed segment, and
  `Figure tone="hours"`. Never a button, chip, badge, tab, border, wash or role
  label. #f18d05 on white is **2.46:1** — an accepted brand trade-off at ≥24px
  readouts only, which is why the token is restricted to large figures and
  fills. The owner has decided twice not to darken it; do not re-derive that.
  `accent-dark` and `accent-soft` are still declared but have almost no job
  left — there is no orange button and no orange wash — and §5.6 lists both for
  retirement.
- **Warn** (`warn-soft` / `warn-line` / `warn-ink` #8a5a08) is *attention*:
  someone has to do something and nothing is lost yet. It is the old `log`
  panel tint promoted to its real job — as **text** (`warn-ink` on `warn-soft`
  is 5.37:1) rather than as a region's background. Amber writes; accent fills.
  They never appear in the same role.
- **Danger** (`danger` #c10007 for fills, `danger-soft` / `danger-line`,
  `danger-ink` #b42318 at 6.57:1 for text) is *problem*: hours are gone, or a
  balance is negative. Warn and danger are the only two chromatic status hues.
- **Person tones** — teal, plum, moss, each `soft` / `ink` / `dot`. One stable
  colour per person from `lib/person-tone.ts`, so a column of sessions can be
  read by who ran them without reading a name. Three and not eight because
  eight meant a mentor's chip could be the same amber as a "no-show" chip and
  the same violet as an "in progress" one: a hue that means four things
  identifies nothing. `ink` on `soft` clears 6:1 in all three. **Programs have
  no hue and no monogram** — a program is a place, not a face.
- **Neutrals** — `canvas` #f4f5f6 is the page ground, `surface` #ffffff a card,
  `line` #e5e6e8 every hairline. Text is two tiers and only two: `ink` primary,
  `muted-fg` secondary. No coloured eyebrows.
- **Elevation is three steps**, all tinted toward brand blue rather than flat
  black: `shadow-sm` for a card, a table or a button resting on the canvas;
  `shadow-lg` for a menu or popover floating above the page; `shadow-xl` for a
  modal with the page dimmed behind it. Each step is a distance, and nothing
  uses a step it has not travelled.

There is **no green**. "Nothing wrong" is a `✓` glyph in ink on a neutral chip,
so the two colours that remain are never spent on good news. There are no
gradients, tinted section headers or watermarks.

### The rule the build enforces

A raw Tailwind palette class — `text-red-700`, `bg-amber-50`, `border-slate-200`
— **fails `npm run lint`**. `scripts/check-colors.mjs` scans `src/` for
`(text|bg|border|ring|stroke|fill|divide|outline|from|to|via|shadow|accent|caret|decoration|placeholder)-(red|amber|green|…)-[0-9]`
and exits non-zero on a hit. One file is allowlisted: `login/page.tsx`, for
Google's four brand hexes on the sign-in button, which are not ours to re-tint.

It is an error and not a warning because of how the count moved: 106 raw
classes across 41 files (`text-red-700` alone 36 times in `.tsx`) went to **0**,
and twelve hue families collapsing to five is undone by one careless
`bg-green-50`. Use the semantic tokens in `src/app/globals.css`. Do not add a
hue without a question it answers.

`src/lib/brand.ts` holds the same hexes as values for the two consumers that
never see the stylesheet — the email layout and the PDF guide generator. The
two files are halves of one palette and are edited together.

## Brand assets

`public/brand/` is the whole of the identity, and the root layout names every
file so the tab and the home screen cannot drift from it.

- **`logo.svg`** — the wordmark, "freshlog", lowercase, `brand` blue, bold,
  tracking tight. The app itself never loads it: both shells render the word as
  HTML text, which stays selectable and scales with the reader's type size.
  This file is for the surfaces with no stylesheet — an email header, a PDF
  guide, a README.
- **`icon.svg`** — the mark: a lowercase `f`, drawn as one stroke, white on a
  brand-blue rounded square. A tab is too small for eight letters, so the mark
  is the first of them and nothing else. **No orange**: orange means hours, and
  an identity badge is exactly the chrome it is not allowed on. The `f` is a
  path rather than `<text>` so the two rasters below come out the same
  everywhere.
- **`favicon.ico`** (32px) and **`apple-touch-icon.png`** (180px) — rendered
  from `icon.svg`. The apple icon is flattened onto the same blue, because iOS
  applies its own corner mask and would otherwise round an already-rounded
  square.
- **`icon-{192,512}.png`** and **`icon-maskable-{192,512}.png`** — the manifest
  icons. The `any` pair keeps the rounded square; the `maskable` pair is
  full-bleed blue with the mark inside the 80% safe zone, so Android's crop
  can take any shape.
- **`splash/`** — the `apple-touch-startup-image` set: one white launch image
  with the centred mark per device class, matched by exact logical size and
  pixel ratio. A device that matches nothing launches on white.

  All of it is rendered by `scripts/generate-brand-assets.mjs` (`npm run
  brand:assets`), which also rewrites `src/lib/generated/startup-images.ts` —
  the `startupImage` list `layout.tsx` declares, so a size is never named for
  a file that does not exist. `sharp` is a Next.js transitive dep; there is
  nothing to install.

`theme-color` is `surface` white, not brand blue: the address bar sits directly
above a header that is `bg-surface` under a `line` hairline, so the chrome reads
as one continuous surface. Blue up there would be the wash the pages below it
no longer have.

## Type and numbers

The type is the platform's own: `-apple-system` gives SF on an iPhone or a Mac,
and Inter (with `cv11` and `ss01`, the two features that move it closest to SF)
is the face everywhere else — SF itself cannot be served as a web font. Geist
Mono appears once, on the error digest. Numbers use tabular figures, and every
`Table` sets them for the whole grid so a column of balances aligns by digit.
(Amended September 2026, from Geist, when the visual layer moved toward iOS.)

Durations are minutes until minutes stop being readable. One meeting or one
task budget is a plain minute count ("90 min"); a roll-up — a total, a
balance — splits past the hour ("18h 20m"), because nobody reads "1100 minutes
remaining" as an amount of time. A figure a reader only **orients** by is
rounded and takes a "+" ("130+ hours"); a figure that **is** the record — one
allocation, one logged session, a balance about to be spent against, anything
beside money — stays exact. `PRODUCT.md` promises these numbers are trusted;
that promise lives on the exact side of the line.

A figure always carries its own unit, so no label or suffix repeats it. `Hrs`
is a banned string (`scripts/check-copy.mjs`).

Space is a scale of three steps and there is no fourth, enforced by
`scripts/check-spacing.mjs`: `space-y-4` between top-level blocks of a page,
`py-2.5` for a section's header band, `py-2` for everything inside a section —
a body, a list row, a table cell. Horizontal is `px-4 sm:px-5` throughout. The
scale is written down in `components/ui/section.tsx`, which owns two of the
three. Before it, the page rhythm was 4, 5, 6 and 8 across seventeen pages and
the padding inside a card was six different values chosen per call site;
neither was a decision anybody made, and both cost rows off the bottom of the
phone this product is read on.

Push scale contrast: the `h1` and the one lead figure are unmistakably larger
than everything around them — `lead` is 42px, `normal` 30px, `inline` 16px, and
there is exactly one `lead` per page. Eyebrows are 13px sentence case, one
size everywhere (they were 11px small-caps until the September 2026 iOS pass,
and 10px in nine variants before that). Data stays dense enough for staff work without
turning every statistic into a card. Reach for a rule and whitespace before a
container.

## Components

75 component files are on their way to 51; `REDESIGN.md` §5.2 names every merge
and every retirement. A merge only lands in the commit that rewrites its call
sites — never as a standalone tidy-up — so the count trails the plan and then
catches up. What follows is the set as it is mounted today, and it is what a
new screen is assembled from. Read the header comment in each file: it carries
the reasoning and the incident, and this list is deliberately shorter than the
APIs.

**One renderer per kind of thing.** Each of the three row renderers replaced
four hand-written versions that disagreed about the same fact.

- **`session-row`** — a logged session wherever one appears, in three shapes
  (`log`, `timeline`, `line`). `log` is TWO LINES at every width — who and how
  long, then what it was about — and replaced a six-column table that a phone
  stacked into eight labelled lines per session. The four it replaces drew a voided session at
  45%, 50% and 55% opacity, put 90 minutes in bold ink here and orange there,
  and each re-derived its own chips from a different source. No variant picks a
  word or a colour; `lib/status.ts` supplies both, already in the reader's
  voice. A plain attended in-plan session gets **no chip at all**.
- **`task-row`** — one piece of planned work (`table`, `list`, `line`). Two
  rules it does not get to choose: over budget is **danger everywhere**,
  because overspend is a problem with the plan and not a nudge; and done is a
  `✓` chip with **no wash**, because a tinted row is a colour with no words and
  it spent a background on the one state nobody needs to find.
- **`allocation-row`** — one student's time with one mentor (`table` for staff,
  `card` for the student and the mentor). The bar is what is **gone**: spent
  plus forfeited. `allocationSummary` writes an expired grant's `remaining`
  down to zero, so `allocated - remaining` would draw a grant that simply ran
  out of time as fully used — a full bar telling a student they had their
  sessions when they had none.

**Lists and chrome.**

- **`attention-list`** — "Active issues", the section every home opens with. It
  replaces nine separate shapes: an approvals callout, an orange "N mentors
  awaiting assignment" pill, the flags panel, four red student callouts, the
  UNASSIGNED welcome card and the booking-link pill. Every row is the same
  three things — what state, what about, what to do. The header count is
  **actionable rows only**: a mentor waiting on a student's answer has
  something on screen but nothing to do.
- **`timeline`** — "Up next": everything with a date on it, in one list.
  Meetings, use-by dates and task due dates were three lists on three pages,
  and a mentor asking "what is happening this week" had to merge them
  mentally. Rows are heterogeneous on purpose, because what the reader wants
  is chronology. The 56px calendar leaf went with the three lists — it
  repeated the group header directly above it and took a third of a phone row.
- **`ui/status-chip`** — one chip for every state in the product. Callers pass
  a `Status` (or, on pages not yet reshaped, a severity plus a label); they
  cannot pass a colour. Grey carries no glyph, because a fact does not need to
  announce itself.
- **`person-chip`** — a person as their identity colour plus initials, or a
  profile picture once they set one. `PersonCell` is the table form,
  `PersonBadge` the bare avatar. `href` turns it into a link and the hover ring
  picks up the chip's own hue.
- **`ui/figure`** — one number with its label. It replaced **57**
  hand-assembled stat cards across ten files, whose real problem was the habit
  rather than the component. One `lead` per page; `hours` is the only coloured
  tone and only at 24px and up.

**Controls.**

- **`ui/filter-bar`** — one bar above every list: what you are looking for, and
  what the list is showing now. It replaces a 322-line filter component in
  which the URL contract, the date arithmetic and the markup were one
  untestable lump, plus three hand-rolled cards that each got a different piece
  wrong (one lost the program when you searched, one carried the page number
  into a new filter, one filtered in JavaScript over every row in the school).
  The rules live in `lib/filters.ts` and are tested; this file only draws.
  **Values** — search, selects, dates — compose inside one GET form with one
  Apply. **Chips** are single facts and act on one click. Both write the same
  URL, so a filtered list is a link you can send.
- **`ui/row-action-menu`** — the menu on one row: correct it, move it, call it
  off, remove it. Four files had copied the same seventy lines to the
  character; all four sized the trigger at 32px on pages students and mentors
  open on a phone, and none of the four had a keyboard contract at all. `dots`
  for a menu of several things, `pencil` for a row whose menu is one edit. The
  panel is portaled, which is also what keeps the forms inside it from being
  nested in the page's own form.
- **`ui/confirm-inline`** — a destructive action and the question it answers
  first. Eight of these were hand-written in three visual shapes; one asked no
  question at all — "Remove" straight to "Yes, remove", which is a two-step
  confirm with the step carrying the information left out — and none moved
  focus, so a keyboard user pressed Enter and the button under their finger
  became a different button. The second step is filled red because by then it
  **is** the primary action. Escape steps back and claims the key.
- **`ui/segmented`** — one segmented control for the six built by hand, which
  disagreed on three heights, two focus treatments, and whether the chosen
  option explained its consequence. Two shapes: `SegmentedRadio` is a form
  field, `TabLinks` is navigation. They look alike because it is the same
  gesture; conflating them is how a filter ends up submitted as form data.
  Segments are 44px even in the dense popover variant, which is where a mentor
  fixes a session they got wrong.
- **`ui/save-state`** — everything a form is allowed to say about itself, as
  one closed set: idle, editing, unsaved, saving, saved, failed. What it
  replaces knew two of the six and was shared by forty call sites, so every
  one that wanted to say more said it by hand. In flight beats everything, then
  a failure, then unsaved edits, then a success — a failure outranks unsaved
  edits because the error is why the reader is editing again.
- **`ui/settings-row`** — one labelled setting: what it is, what it is for, the
  control, and what that control last did. Five surfaces built this by hand;
  two put help text above the field and three below, two labelled the input and
  two left it to a placeholder. The description sits under the **label**, not
  under the control, because a sentence explaining a field is worth least once
  the field is filled in. Every row carries its own `SaveState`; the page never
  does.
- **`ui/fact-list`** — label/value facts about one thing: the enrollment, the
  sign-in address, the folder, the program. A GOV.UK summary list rather than a
  form, because that is what these are. Reading a student's email used to mean
  reading it out of an `<input>`. A fact is text until someone presses
  **Change**; a fact nobody can edit from here says so by having nothing to
  press, not by disabling something.

**The chrome under them.** `ui/section` (`PageTitle`, `Section`, `Eyebrow`) is
one treatment with no tones. `ui/table` (`Table` / `Tr` / `Td label`) is the
only table chrome — give every `Td` a `label` so its stacked form still says
what the value means. `ui/pagination` states the slice in words. `ui/callout`
is deliberately expensive: at most **one per page**, for a state that *blocks*
the reader, in three tones each carrying an icon (the fourth, `brand`, rendered
orange and is gone). `ui/meter` grows its fill from zero once, on mount.
`ui/button`, `ui/submit-button`, `ui/field`, `select`, `ui/popover`,
`ui/disclosure`, `ui/empty-state`, `error-state`, `ui/receipt`,
`expandable-text`, `avatar`, `hours-ring`, `hours-breakdown`.

`HoursBreakdown` is a total as one bar and its key — completed, missed but
charged, expired unused, still yours — so the proportions answer the question
the four figures made people subtract for. It has **three fills, not four**:
completed is `accent`, missed-but-charged is the *same* accent as a 135°
diagonal stripe, expired and overdrawn are `danger`, and the remainder is
`line`. The version before it put `bg-accent` (hue 35°) beside `bg-amber-400`
(hue 44°) — nine degrees apart and identical for deutan and protan readers.
The legend swatches therefore differ in **shape** as well as fill: filled dot,
striped square, hollow ring. Hours logged out of plan sit outside the bar; they
were never part of what was bought.

### Grouped lists (September 2026, second pass)

The owner's verdict on the first pass was "not polished, not consistent, not
calm". The answer was subtraction, in iOS's grouped-list grammar, applied by the
shared components so no page can opt out:

- **The ground is iOS grouped grey** (`canvas` #f2f2f7; in dark a blue-grey #121417, never pure black — see the dark block in globals.css) and a
  card is plain white (`surface`), `rounded-xl`, no border, a shadow you have to
  look for. A hairline goes *between rows*, never around a card.
- **A section's title sits on the page**, above its card — `Section` renders it
  so. There are no header bands inside cards and cards never nest.
- **Sentence case everywhere.** Eyebrows, table headers, fact labels,
  notification tags: no capitals, no letter-spacing. Labels are 13px muted,
  values are ink.
- **Colour is rare.** A person's hue lives in their avatar and nowhere else —
  `PersonChip` is a face and a name in ink. Brand blue is for things you press;
  orange is hours; amber and red are status. No gradients, no medals, no
  coloured card edges, analytics included.
- **Rows are iOS-height**: `py-3` list rows (the spacing lint allows it), 15px
  primary line, 13px secondary, a trailing value or chevron.
- **Type scale**: 32 large title · 20 section · 17 card headline · 15 body ·
  13 secondary · 12 caption.

### The surface: fills, corners, depth (September 2026)

The visual layer moved toward iOS's grouped style without changing a single
colour's meaning:

- **Fields are fills, not boxes.** `inputClasses`/`fieldChrome` in `ui/field.tsx`
  paint every input, textarea, `Select` trigger and `DateField` in `fill` — a
  translucent grey that reads on the card and on the canvas alike — with no
  border at rest. Focus is where the edge appears: brand border, a soft 4px
  halo, and the fill turns white. A secondary button wears the same fill, so a
  form's inputs and its secondary action read as one family under the one blue
  button.
- **Four corners.** `rounded-md` 8px (tags, small controls), `rounded-lg` 12px
  (buttons, inputs, rows), `rounded-xl` 18px (cards, tables, sections),
  `rounded-2xl` 24px (sheets, modals, the sign-in card), `rounded-full` for
  chips and avatars. Tailwind's names, re-stepped in `@theme`; nested corners
  follow outer minus padding.
- **Table headers stick** under the top bar (`--sticky-top`: the bar's height,
  or 0 where the rail replaced it), in sentence case on a frosted tint. Sticky
  needs no scroll container in between, which is why `Section` clips with
  `overflow-clip` rather than `overflow-hidden`, and why the table wrapper no
  longer scrolls sideways at all.
- **Density is the reader's.** Compact / Default / Comfortable, in the account
  menu and on Settings, stored per browser beside the theme and applied before
  first paint. It moves the root size (87.5 / 94 / 100%) and a table's row
  padding, from `sm` up only — a phone's 44px targets are not a preference.
- **Toasts** are a dark translucent capsule at the bottom centre: 4 seconds, 6
  when they carry an action, held while a pointer or focus is on them. The one
  action a toast offers is Undo, and only for an action with an exact inverse
  (REDESIGN §5.8).
- **Status explanations can be printed.** `StatusChip explain` puts the ≤12-word
  why on a sibling line, for the places a phone reader needs it — a student's
  session history, their home — where a `title` tooltip never appears.

### Rules a component has to keep

Use native controls unless a custom interaction offers a demonstrated benefit,
and a custom control owes the keyboard everything the native one gave:
`Select` is a full ARIA combobox (arrows, Home/End, typeahead, Escape restoring
focus) with one tab stop, and a required one is caught in the **browser** — its
value rides a validatable input, not a hidden one, so "pick a mentor" is
answered at the control instead of by a server error a second later.

Interactive controls need a visible keyboard focus ring and a **44px** minimum
target. Forms show an inline, announced result and submit through
`SubmitButton`, which reads its own form's pending state.

Free text is always clamped and always expandable: `ExpandableText` wraps every
note, purpose, comment and message — `lines={2}` in a row, `lines={3}` in
detail — and the toggle only appears when the clamp actually cut something.
Chips wrap; status labels are capped at four words and the ≤12-word explanation
is a sibling line, not chip content. `truncate` on a flex child without
`min-w-0` or a `max-w-` **fails the lint**, because it silently does nothing
and that is why names in table cells blew their column open.

Every table is capped at **six columns**, a row stacks into labelled lines below
`sm`, its header row sticks, and no table scrolls sideways at any width: nine columns do not fit a phone, and a
swipe nothing on screen suggests is not navigation. Any list that can grow
without bound is paged, and the narrowing — search, filter, date range —
belongs in the query, never in a `.filter()` over everything.

There is **one** route error boundary (`app/error.tsx`) and it sits *above* the
shell, with `global-error.tsx` below it for the root layout itself. The five
per-tree boundaries it replaces were in the wrong place: the shell reads the
database, so a boundary rendered inside the shell can only try to paint the
shell again and throw again.

One vocabulary throughout: mentor · student · **session** (logged) · **meeting**
(scheduled) · task · program.

## Motion

Motion is brief and eases out; interaction feedback is 150–180ms. Things that
move in space ride springs, sampled into CSS `linear()` so no library is needed:
`--ease-spring` (critically damped — menus, popovers, the press rebound) and
`--ease-spring-soft` (one ~2% overshoot — sheets and modals, the things with
mass). A pressed button drops to 97% instantly and springs back on release. Entrances are
choreographed rather than simultaneous: rows `deal-in` with a ~24ms stagger,
panels `lift-in`, `HoursRing` draws its arc once with `ring-draw`, and `Meter`
grows its fill from empty on mount, so spending hours is something you watch
happen once. The row a `#session-…` link lands on tints `brand-soft` and fades
out, because after a second the reader has found it and a permanently
highlighted row is a row that looks selected.

**Pages push and pop, they do not cut.** `PageTransition` wraps every page's
content in a `ViewTransition`, and the direction comes from the link that was
tapped: a link that drills in carries `transitionTypes={["nav-forward"]}`
(rows, chips, `ArrowLink`, `LinkButton`) and slides the new page in from the
right over a dimming old one; the shared back row on `PageTitle` carries
`["nav-back"]` and reverses it. Anything untyped — tab taps, filters,
pagination, a search keystroke's `router.replace` — crossfades or swaps in
place. A slide on a tab tap would lie about where you went. The top bar, tab
bar and rail are named view-transition captures (`vt-topbar` / `vt-tabbar` /
`vt-rail`) so they hold still while the page moves, and every section's
`loading.tsx` renders its skeleton *inside* that chrome. New link that goes
somewhere? Give it the type, or it fades.

**Gestures are part of the motion, not extras.** `NativeGestures` (mounted once
per shell) owns the touches a phone user makes without thinking: a drag from
the left edge arms a predictive-back bubble that pops the page past the line
or on a flick; a pull at scroll top rubber-bands `main` and runs
`router.refresh()` past 72px; a tap on the status-bar strip scrolls to the
top; and every pointer-down on an internal link fires `router.prefetch`, so
the ~200ms a finger spends on the glass is spent warming the route. The
client router cache is what makes "back" feel instant — `staleTimes.dynamic`
is 30s in `next.config.ts`, and a pull-refresh is how a reader asks for newer.

**On a phone, a popover is a sheet.** Below `sm`, `Popover` panels and
`Select` listboxes stop floating beside their trigger and become a rounded
bottom sheet over a dimmed page — grabber on top, `sheet-up` on the nav
curve, `--kb` lifting them clear of an open keyboard, and
`useSwipeDownToDismiss` for the drag-off gesture. Desktop keeps the anchored
dropdown untouched.

**On a phone, the nav bar is iOS's.** `PhoneChrome` lives in the top bar and
reads two marks the page already makes: `PageTitle`'s h1 carries
`data-large-title` so the title echoes into the bar once the big one scrolls
under (with the hairline arriving at the same moment), and its back row
carries `data-back-href` so the `‹ Section` chevron renders in the bar — the
page-level row itself is hidden below `sm`. A back label of "Back" resolves
to the nav item whose href the link points at, longest prefix wins. New page?
Use `PageTitle` and the bar works; keep the row descriptive or leave the
label off and let the nav name it. Chip rows that would wrap use the
`scroll-x` utility instead — horizontal scroll, hidden scrollbar, edge fade,
and an exclusion in the gesture layer so a chip fling can't arm swipe-back.

Nothing loops and nothing idles, and no motion celebrates. (`hint-bounce` is
the one keyframe left in `globals.css` with no call site.)

Reduced motion is respected including the **staggered delays**, which are zeroed
rather than shortened: a row with a 300ms delay and a 0.01ms animation
otherwise sits invisible for 300ms and then pops in.
