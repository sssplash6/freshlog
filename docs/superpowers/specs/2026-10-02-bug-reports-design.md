# Bug reports — design

Date: 2026-10-02. Second of three requests from the Freshlog notes (first: the
in-app changelog, built; third: custom date ranges for mentor hours, built).

## Goal

Anyone signed in can report a bug, with an optional screenshot. They can see
their own reports and where each stands. Everyone can see what has been fixed,
in plain language, and which changelog entry it shipped in. Platform admins
triage.

## Decisions already made

| Question | Decision |
|---|---|
| Who sees which reports | **Each person sees their own reports, plus everything that is Fixed.** Nobody sees another person's pending report. |
| What others see of a Fixed report | **Only a plain-language fix line** written by the triager, its date, and a link to the changelog. Never the reporter's title, description, screenshot or name. |
| Who triages | **Platform admins only** (`User.platformAdmin`). Program admins, mentors and students report and see their own. |
| What a report holds | Title, description, **optional screenshot**, and the page and role captured automatically. |
| Where reports live | **The app's own database** (not GitHub Issues, not email). |

## Data

**`BugReport`**

- `id`, `createdAt`, `updatedAt`
- `reporterId` → `User`, **nullable, `onDelete: SetNull`**. Removing an account
  never removes the report; triage shows "former user".
- `reporterRole` — the role at the time of filing.
- `title` (≤ 120 chars), `description` (≤ 2000 chars)
- `pagePath` — nullable, a path only, ≤ 300 chars (see "Page capture").
- `status` — `PENDING | IN_PROGRESS | FIXED | CLOSED`, default `PENDING`.
- `resolution` — nullable text, ≤ 300 chars. For `FIXED` it is the **public fix
  line**; for `CLOSED` it is a note **private to the reporter and triagers**.
- `resolvedAt` — nullable; set when the status becomes `FIXED` or `CLOSED`.
- `changelogDate` — nullable `YYYY-MM-DD`, the changelog entry a fix shipped in.
- `triagedById` → `User`, nullable, `SetNull` — who last changed the status.

**`BugReportImage`** — one screenshot per report: `reportId` (unique),
`bytes`, `mimeType`. Its own table so listing reports never loads image bytes
(the reason `AvatarImage` is separate). Browser-side resize and re-encode as for
avatars; the server re-checks size (cap about 600 KB) and **sniffs the real
format** (PNG, JPEG, WebP only) with `sniffImageType`, never trusting the
client's `mimeType`.

A reopened report (Fixed/Closed → Pending/In progress) keeps its earlier
`resolution` on the record but is no longer public.

## Access

| | Report | Own reports (full) | Fixed list | Others' reports | Change status |
|---|---|---|---|---|---|
| Signed-in user | yes | yes | yes | no | no |
| Platform admin | yes | yes | yes | yes, with reporter | yes |

- The Fixed list selects **only** `resolution`, `resolvedAt`, `changelogDate`.
  Its query must not read `title`, `description`, `reporterId` or the image.
- A report's detail and its screenshot are readable by its reporter and by
  platform admins. For anyone else, "not yours" and "does not exist" return the
  same 404, so ids cannot be probed.
- A gate that has to load a row first fetches the row, then gates (AGENTS.md).
- **Every page and route calls its own gate on its first line**, before any
  query: `requireUser()` for `/bugs`, `/bugs/new`, `/bugs/[id]` and the image
  route; `requirePlatformAdmin()` — new, in `src/lib/dal.ts` — for
  `/bugs/triage`. Layout gates alone are not gates.

## Pages and routes

- **`/bugs`** — "Your reports" (all statuses, newest first) with a **Report a
  bug** button; then "Fixed" (fix line, date, changelog link).
- **`/bugs/new`** — the form: title, description, optional screenshot.
- **`/bugs/[id]`** — one report. Reporter/platform admin see the full record;
  a platform admin also sees the triage controls.
- **`/bugs/triage`** — platform admins only. All reports with reporter name;
  status filter; opens on Pending + In progress, newest first.
- **`/api/bug-report/[id]/image`** — serves a screenshot to its reporter or a
  platform admin only; sniffed type, `X-Content-Type-Options: nosniff`,
  `Cache-Control: private`.

## Triage rules (server actions, platform admin only)

- Any status may be set; the action re-checks the actor inside the action, not
  just on the page.
- `FIXED` **requires** a non-empty `resolution` (≤ 300 chars) and takes an
  optional `changelogDate` (default today, validated as a real day).
- `CLOSED` **requires** a non-empty `resolution` note.
- Reopening to `PENDING`/`IN_PROGRESS` clears `resolvedAt` and `changelogDate`
  and removes the report from the public list; `resolution` is kept.
- A refused change leaves the status untouched.

## Reporting

- **Rate cap:** 5 reports per person per rolling hour; the refusal says so
  plainly. Counted in the database, not in the browser.
- **Page capture:** the account menu's "Report a bug" row passes the current
  path as `from`. The server keeps it only if it starts with a single `/`, is
  ≤ 300 chars, and contains no scheme or `//`; the query string and fragment are
  stripped (no tokens or ids from the address bar beyond the path itself).
  Anything else is dropped and the report is saved without a page.
- Validation errors return as `ActionState` (`src/lib/actions/shared.ts`) like
  the other forms; a rejected screenshot saves nothing.

## Notifications

Through `notify()` in `src/lib/notify.ts`, with new types in
`NOTIFICATION_TYPES` / `NOTIFICATION_META`:

- `BUG_REPORTED` → every platform admin, linking to `/bugs/[id]`.
- `BUG_FIXED` and `BUG_CLOSED` → the reporter, linking to `/bugs/[id]`.

No email beyond whatever the existing notification preferences already do for
the chosen category.

## Entry points

- Account menu (`app-shell.tsx`), next to "What's new": **Report a bug**
  (→ `/bugs/new?from=<current path>`, via a small client component reading the
  pathname) and **Bug reports** (→ `/bugs`).
- `/changelog` gets a link to `/bugs`.
- Each entry on `/changelog` gets an anchor (`id="2026-10-02"`) so a fixed
  report can link to `/changelog#<changelogDate>`.

## Out of scope

Comments or replies on a report, voting / "me too", GitHub sync, email beyond
existing preferences, attachments other than one screenshot, public reporter
names.

## Testing

Vitest, with the repo's SQLite test database for action tests.

- **Access:** a user cannot read another user's report, its detail, its
  screenshot, or the reporter; the Fixed list returns only fix line, date and
  changelog link (the query shape is asserted); a non-platform-admin cannot
  change a status, and the action refuses even when called directly.
- **Triage rules:** Fixed needs a fix line; Closed needs a note; a refused
  change leaves status untouched; reopening hides the report from the public
  list and keeps `resolution`.
- **Reporting:** the hourly cap; `from` sanitising (full URL, `//host`, overlong,
  query string); screenshot too large, wrong type, and a file labelled
  `image/png` that is really HTML.
- **Notifications:** right recipients on report and on Fixed/Closed, no one else.
- **Deleted reporter:** the report survives; triage shows "former user".
- **Gates:** each page's gate runs before any read — a signed-out or
  garbage-cookie request gets no data (same shape as `changelog/page.test.ts`).
- **Release checks:** lint, `tsc`, full suite, production build (which
  type-checks the tests), and the whole flow driven in the running app as a
  student, a mentor and a platform admin.

## Changelog

The commit that makes this reachable from the account menu adds a "New" entry to
`CHANGELOG.md` (AGENTS.md rule); earlier commits that only add tables, actions
and pages nothing links to add none.
