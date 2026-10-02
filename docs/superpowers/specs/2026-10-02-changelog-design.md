# Changelog ("What's new") — design

Date: 2026-10-02. First of three requests from the Freshlog notes; the other two
(bug reports with pending/fixed status, custom date ranges for mentor-hours
estimates) get their own specs. Bug reports will link a fixed report to the
changelog entry that fixed it, which is why this one goes first.

## Goal

Users can see what was added and fixed, in plain language, like the "what's
new" pages of other apps. Whoever commits to `main` writes the paragraph in the
same commit.

## Decisions already made

- **Source of truth is `CHANGELOG.md` at the repo root**, shown at `/changelog`.
  It deploys with the code, so an entry is visible exactly when its change is
  live (Render deploys are manual, `autoDeploy: false`).
- **The writing rule is in `AGENTS.md`** ("Every commit writes its changelog
  entry") and in project memory. Commits with no user-visible effect (tests,
  refactors, dependency pins, tooling) add no entry.
- **Unseen entries show a dot**, tracked per user in the database so it follows
  them across devices.

## The file

```
## 2026-10-02

### New
- Programs can now grant standard hours to every new student.

### Fixed
- Voiding a session now lets you remove the mentor's hours straight away.
```

Dated `##` headings, newest first. `### New` and `### Fixed` under each; either
may be absent. Bullets are plain text (no inline markdown). The first entry is
backfilled from recent user-visible work (standard hours, hours carried across
program moves, void-then-remove, the allocation menu fix) and drafted in plain
language for review.

## Parser — `src/lib/changelog.ts` (server-only)

`parseChangelog(text: string): ChangelogEntry[]` is a pure function returning
`{ date: string; new: string[]; fixed: string[] }[]`, newest first.

- No markdown dependency: the format is this narrow and the repo has none.
- A block that does not fit (bad date, unknown `###` heading, a bullet outside a
  section) is skipped, not thrown. A typo in the changelog must never take the
  page down.
- `readChangelog()` reads `CHANGELOG.md` from `process.cwd()`, wrapped in React
  `cache()` so the shell and the page share one read per request. A missing
  file yields an empty list.

## The page — `/changelog`

- `src/app/changelog/{layout,loading,page}.tsx`, following `/notifications`:
  the layout wraps `AppShell`, `dynamic = "force-dynamic"`.
- **Every page function calls its own gate on its first line**: `requireUser()`
  in `page.tsx`, not only in the layout (see AGENTS.md, "Gate every page").
  Every role may read it; nothing on it is scoped, because nothing on it is
  about a student or a program.
- Entries newest first; each shows its date as a heading and its New / Fixed
  lists. An entry newer than the viewer's last-seen mark carries a "New" chip
  (`StatusChip`). Empty state when there are no entries.

## Unseen dot

- **Schema:** `User.changelogSeenAt DateTime?` plus a migration.
- **Rule** — `hasUnseenChangelog(entries, user)` in `changelog.ts`, pure: true
  when the newest entry's date is later than the UTC calendar day of
  `user.changelogSeenAt ?? user.createdAt`. A new user therefore does not get a
  dot for history that predates them.
- **Known edge:** the comparison is by day. Someone who opened the page today
  will not get a dot for a second entry added later today until tomorrow. This
  is accepted in exchange for not storing per-entry state.
- **Marking seen:** a small client component on the page calls a server action
  after mount (`useEffect`), so link prefetching never clears the dot and the
  database is not written during render. The action (`src/app/changelog/actions.ts`)
  calls `requireUser()`, sets `changelogSeenAt = now`, and revalidates the shell.
- **Where it shows:** the shell's `AccountMenu` (`app-shell.tsx`). A "What's
  new" row goes in the menu above the theme/density toggles, and a small brand-
  blue dot sits on the account button's trigger when unseen (the same row
  carries it inside the menu). Not on the left rail: `lib/nav.ts` allows a count
  on Home only, and the bell already owns the corner. Blue, not red — red is
  spent on hours gone and balances negative.
- `AppShell` already receives the full `User`, so the rule needs no extra query,
  only the cached file read.

## Out of scope

- Writing entries from the UI (no database-backed entries).
- Per-entry read state, email digests of changes, popups.
- Linking bug reports to entries (belongs to the bug-report spec).

## Testing

- `parseChangelog`: well-formed file, both sections, one section, multiple days,
  out-of-order input, malformed blocks skipped, empty string.
- `hasUnseenChangelog`: never seen with an entry older than `createdAt`, never
  seen with a newer one, seen before and after the newest entry, no entries.
- Action: requires a signed-in user, writes only the caller's own row.
- Page: the gate runs before any read (a request without a valid session never
  gets entries), every role can open it.
- Production build type-checks (the repo has had Render build failures from
  test-file types before).
