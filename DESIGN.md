# Design rules

freshlog is used every day by the same few hundred people. Every word they read
and every pixel they cross costs them time, so the design is subtraction: a
feature explains itself through its label and its layout, and if it cannot, the
label or the layout is wrong — not the missing sentence.

These rules are binding. `npm run lint` enforces the ones marked **[lint]**
(`scripts/check-design.mjs`, plus the older `check-colors`, `check-copy`,
`check-spacing` and `check-type`). The audit that produced them is
`docs/design/audit-2026-10.md`; the reasoning behind the older rules is in
`docs/archive/DESIGN-2026-10.md`. Where a rule here and a comment in code
disagree, this file wins.

## 1. Words

- **C1 — No helper text. [lint]** No sentence explains a feature, a field, a
  section or a page. Three things may still be said, each in one short line with a
  `{/* design-allow: <reason> */}` marker on the line above:
  a **validation error**, a **consequence** that cannot be undone ("Deletes 3
  sessions"), and a **privacy promise** ("Your mentor never sees who wrote this").
- **C2 — No subtitles that explain. [lint]** A page title, section title, fold
  and create panel carry a name. `subtitle`, `caption` and `eyebrow` may carry
  **data** (an email, a count, a date range) — never a sentence. Gone for good:
  `SettingsRow description`, `Disclosure hint`, `CreatePanel hint`,
  `StatusChip explain`, `EmptyState` body text.
- **C3 — Short names. [lint]** A label is at most 3 words; a button is a verb and
  a noun, at most 3 words ("Log a session", "Save", "Remove"). No string a user
  can see runs past 6 words unless C1 allows it.
- **C4 — Empty means a title.** An empty state is its title (≤ 6 words, a noun
  phrase: "No sessions yet") and, if one exists, the one action that fills it.
  It never says why it is empty or where things will appear.
- **C5 — Placeholders are examples. [lint]** "e.g. 60", "username", or nothing.
  Never an instruction ("Optional — what you covered…", "Type to filter…"). A
  picker with nothing chosen says "Choose…".
- **C6 — Tooltips name, they don't explain.** `title=` only names an icon-only
  control. A visible label never gets a tooltip repeating it. The one exception
  is a status chip: its explanation (`lib/status.ts`) lives in the chip's hover
  title and its screen-reader text, never as a line on screen.
- **C7 — One word per thing.** mentor · student · **session** (logged, in the
  past) · **meeting** (booked, in the future) · **task** (a to-do) · **agenda
  item** (budgeted work) · program · **use by** (when hours expire) · **due** (when
  a task is) · **Admin / Leader / Sales** (program levels; "Platform admin" for
  the platform flag). "What needs you" is **Needs you** everywhere.
- **C8 — Sentence case**, no capitals, no letter-spacing — table headers
  included. `Hrs` is banned **[lint]**.

## 2. Width and layout

- **W1 — A field is as wide as its content. [lint]** Every field fills its box
  only up to its `measure`, and is full width on a phone:

  | measure | max width from `sm` | for |
  |---|---|---|
  | `xs` | 7rem | minutes, numbers, a score |
  | `sm` | 12rem | a date, a time, a short select |
  | `md` (default) | 20rem | a name, an email, a select, search |
  | `lg` | 36rem | a note, a URL, any textarea |
  | `full` | none | a bulk list only |

  `Input`, `NameInput`, `EmailInput`, `Textarea`, `GrowingField`, `Select` and
  `DateField` take `measure`. Never set a field's width with a class, and never
  use `inputClasses` or `fieldChrome` outside `src/components/ui/` and
  `select.tsx` **[lint]**.
- **W2 — Short forms are one row.** Up to three short fields and their submit
  button sit on one row from `sm` (`flex flex-wrap items-end gap-3`). Two short
  fields never stack.
- **W3 — Forms are narrow.** No form or create panel is wider than 36rem. A
  settings row is a label and its control on one line.
- **W4 — Buttons hug their label. [lint]** No button, link-button or row trigger
  is `w-full` above `sm`.
- **W5 — No card for one short thing.** A single line of data sits in the
  section it belongs to.
- **W6 — Search is 16rem.** The filter bar's search box is `md`, not the rest of
  the row.

## 3. One way to do each thing

Assemble every screen from these. Adding a primitive means adding a rule here.

| job | use | never |
|---|---|---|
| page heading | `PageTitle` | a hand-made `h1` |
| section | `Section` (title · count · one action) | a hand-made `h2` row |
| create something | the `+` in `PageTitle` → `CreatePanel` | a full-width "Add…" row, a separate page |
| a field with a label | `Field` around a measured control | a bare `<span>` label |
| a setting | `SettingsRow` (label + control) | a description under the label |
| confirm a destructive act | `ConfirmInline`, question ≤ 6 words | one-click delete, a paragraph |
| actions on a row | `RowActionMenu`, pencil trigger | a hand-rolled menu |
| filter a list | `FilterBar` | chips styled by hand |
| nothing to show | `EmptyState title` (+ `action`) | a sentence |
| a status | `StatusChip` (word + glyph, from `lib/status.ts`) | a coloured word |
| a number | `Figure` / `StatStrip` | a hand-made stat card |
| a fact list | `FactList` | a read-only `<input>` |
| save state | `SaveState` | "Changes save as you make them." |
| a blocking problem | `Callout`, title only, one per page | a paragraph in a box |

- **K1 — One primary button per screen**, always last in its cluster.
- **K2 — One save model per form.** A settings row autosaves or has Save; never
  both on one page section.
- **K3 — Grant, log and set happen in place.** Allocating hours, logging a
  session and setting a task open where the reader is; they do not navigate away.

## 4. Subtraction

- **S1 — Every section answers a question** the reader opened the page with.
  A section nobody acts on or reads daily is removed, not folded.
- **S2 — Show a fact once per screen.** No figure, name, email or status repeated
  in a subtitle, a chip and a row on the same page.
- **S3 — Six columns at most** in a table; a row stacks into labelled lines below
  `sm`; nothing scrolls sideways.
- **S4 — One search, one Settings, one bug link** in the shell.

## 5. Colour

- **Brand** `#124b84` is chrome, links, the primary action, focus and unread —
  never a status.
- **Accent** `#f18d05` means **hours and progress, and nothing else**: meter
  fills, the hours ring and figures ≥ 24px. Never a button, chip, border or
  wash. At 2.46:1 on white it is a brand trade-off the owner has decided twice;
  do not darken it.
- **Warn** (attention: someone must act, nothing is lost) and **danger**
  (problem: hours are gone or negative) are the only status hues. There is no
  green; "fine" is a `✓` on a neutral chip.
- **A chromatic status chip always carries its glyph**, so state is never colour
  alone.
- **Person tones** (teal, plum, moss) live only in an avatar. **Program colours**
  (eight slots, `Program.colorIndex`) are a dot beside the program's name.
- Text is `ink` or `muted-fg`; disabled is the `disabled` colour, never opacity.
- Raw Tailwind palette classes fail the build **[lint]**; use the tokens in
  `globals.css`. `lib/brand.ts` mirrors them for email and PDFs.
- **Kept on purpose (owner, October 2026):** the page glow, the primary button's
  sheen, the `hero-brand` panel (one per page) and the active-nav marker — the
  answer to "flat and boring". Nowhere else.

## 6. Type, space, shape

- **Type** — nine tokens, nothing else **[lint]**: `caption` 12 · `xs` 13 · `sm`
  14 · `body` 15 · `title` 17 · `figure-md` 20 · `figure-lg` 28 · `display` 32 ·
  `lead` 42. One `h1`, one lead figure per page. Weights 400/500/600, 700 for the
  `h1` only. Tabular figures in every table.
- **Space** — three steps **[lint]**: `space-y-4` between page blocks, `py-2.5`
  for a section header, `py-2` inside a section (`py-3` for a list row); `px-4
  sm:px-5` horizontally.
- **Corners** — `rounded-md` 8 (tags) · `rounded-lg` 12 (buttons, fields,
  rows) · `rounded-xl` 18 (cards) · `rounded-2xl` 24 (sheets) · `rounded-full`
  (chips, avatars).
- **Targets** — 44px minimum on every control at every width.
- **Durations** — "45 min" under the hour, "1h 30m" past it. "—" means nothing
  happened; "0 min" means a balance spent to zero. A record is exact; only a
  figure the reader orients by is rounded ("130+ hours").
- **Section counts** — the muted number after a section title stays (owner,
  September 2026).

## 7. Motion

- Feedback 150–180ms, easing out; four durations (`instant` 100, `fast` 160,
  `base` 240, `slow` 380). A data reveal may run to 600ms and animates
  `transform`, never `width`.
- Pages push and pop: a drill-in link carries `transitionTypes={["nav-forward"]}`,
  the back row `["nav-back"]`.
- **Kept on purpose (owner):** the `liquid-edge` thread on Log a session — mentors
  find the button by it; the confirmation tone when a session is logged; rows that
  deal in; meters that grow once on mount.
- Nothing else loops, idles or celebrates. Reduced motion zeroes delays too.

## 8. Behaviour a component owes

- Native controls unless a custom one gives a demonstrated benefit; a custom
  control owes the full keyboard contract (`Select` is a real combobox).
- A form is `noValidate` and checks itself on submit: each message under its
  field, one count above the button. A Save button is disabled until something
  changes.
- One focus ring: 2px brand outline, 2px offset, on the element's own corner.
- Free text is clamped and expandable (`ExpandableText`).
- `truncate` needs `min-w-0` or a `max-w-` **[lint]**.
- A list that can grow without bound is paged, and narrowing happens in the
  query, never in a `.filter()` over everything.
- Ratings stay anonymous to the mentor **on the server**, not just in the markup.
- One route error boundary (`app/error.tsx`), above the shell.

## 9. Before you ship a screen

1. `npm run lint` passes — no `design-allow` you cannot name a C1 reason for.
2. At 1440px, no field is wider than its measure and no button wider than its
   label.
3. Read every grey line on the page. If deleting it loses nothing the reader
   needs today, delete it.
4. Every name on the page uses the C7 word.
