# On-screen bug reports — design

Date: 2026-10-21. Builds on `2026-10-02-bug-reports-design.md`; everything that
spec decided still holds unless this one says otherwise.

## Why

Feedback still arrives as screenshots in Telegram and is copied into `TODO.md`
by hand ("Screenshot: Allocate time for Deniz Sattar, button showing a
spinner…"). Reporting in the app costs too many steps: open the account menu,
land on a separate page, take a screenshot yourself, find the file, upload it,
write a title and a description. The idea (from another team, who built it for
their own app) is to cut that to: press, draw on the screen you are looking at,
say what should change, send.

## Goal

From any page, anyone signed in can capture what they are looking at, draw on
it, write one caption, and send it — without leaving the page. The report lands
in the existing triage inbox with the page, the viewport, the theme, the browser
and the build attached, so the person fixing it does not have to ask.

## Decisions already made

| Question | Decision |
|---|---|
| A new system or the existing bug reports | **The existing one.** Same `BugReport` rows, same `/bugs/triage`, same statuses, same audience. |
| Where it reaches the developer | **In-app only**, as today: the bell notification to platform admins and the triage inbox. No Telegram, no email. |
| Where people start it | **The account menu's "Report a bug" row**, which now opens the overlay on the current page instead of navigating to `/bugs/new`. No floating button. |
| What they type | **One required caption.** Its first line becomes the title. |
| How the screen is captured | **Rendered in the browser** with `modern-screenshot`; if that fails, **choose a screenshot instead** and draw on that. |
| Who can use it | Everyone who can file a report today, students on phones included. |

## The flow

1. **Report a bug** in the account menu. The menu closes; once it is gone, the
   part of the page visible in the window is rendered to an image. The menu,
   toasts and the overlay itself are excluded (elements carrying
   `data-capture-skip`).
2. A full-screen overlay (a modal dialog: focus held inside, Esc or Cancel
   closes it, nothing sent) shows that frozen image, fitted to the screen. Three
   tools:
   - **Pen** — freehand marks in the danger colour, read from the theme's token
     at run time. The default tool.
   - **Hide** — drag a solid box over anything private.
   - **Undo** — removes the last mark or box.

   Pointer events throughout, so mouse, finger and stylus all draw; the drawing
   surface sets `touch-action: none` so drawing never scrolls. Marks are
   optional: a keyboard user can send a caption alone.
3. Under the image: one caption box, required, labelled **What should change?**,
   with the line *Only you and the people fixing it will see this.*
4. **Send** flattens the marks into the image — Hide boxes included, so the
   hidden pixels never leave the device — then shrinks it with the loop the
   upload form already uses (longest edge 1600px, WebP, at most 600 KB), and
   posts it with the caption, the page path and the diagnostics.
5. **Success:** the overlay closes and the person stays where they were, with a
   toast — *Report sent* · **View** (→ `/bugs/[id]`). **Failure:** the overlay
   stays open with the error under the caption; nothing drawn or typed is lost.
6. **The page could not be rendered:** the overlay opens without an image,
   says *This page couldn't be captured*, and offers **Choose a screenshot
   instead** (the same accepted formats as `/bugs/new`). The chosen image goes
   onto the same drawing surface.
7. `/bugs/new` stays exactly as it is, reachable from the **Report a bug**
   button on `/bugs`.

The page path follows the existing rule: sent from every page except `/bugs/*`,
where it would only name the bug pages.

## Capture

- `modern-screenshot`, **pinned to exactly 4.7.0** (MIT, no dependencies). It
  draws the page through SVG `foreignObject`, so the browser itself resolves
  Tailwind 4's `oklch()` colours and the self-hosted `next/font` files — the two
  things that break `html2canvas`.
- **Loaded only when the row is pressed** (`await import(...)`), so no page
  carries it in its bundle until somebody reports something.
- What is captured is what is visible in the window at the moment the menu has
  closed, at the device's pixel ratio, cropped to the viewport — including when
  the page is scrolled.
- The browser's screen-share API is not used: it prompts every time and does
  not exist in iOS Safari.

## Data

Five nullable columns on **`BugReport`**, one additive migration. Reports filed
before this, and reports filed through `/bugs/new`, leave them empty.

| Column | Example | Rule |
|---|---|---|
| `viewport` | `1061×1084 @2x` | Built on the server from two integers (1–10000) and a ratio (0.5–5). |
| `theme` | `dark` | `light` or `dark`, else dropped. |
| `userAgent` | `Mozilla/5.0 (Macintosh…` | Trimmed; dropped if it holds a control character; cut to 300 characters when longer. |
| `build` | `f249b1f` | **From the server's environment** (`RENDER_GIT_COMMIT`, first 7 characters), never from the browser. Null where the variable is unset. |
| `marks` | `2` | An integer 0–500, else dropped. |

Everything that comes from the browser is untrusted: a value that does not fit
its rule is **dropped, never stored**, and never refuses the report — a report
missing its theme is still a report.

The flattened image goes into the existing **`BugReportImage`**. No new storage.

## Server

**`reportOnScreen(prev, formData)`** — a new server action in
`src/lib/actions/bugs.ts`. It returns `ActionState` instead of redirecting,
because the person stays on their page.

- Re-checks the actor first; a signed-out call gets *Sign in to do that.*
- **Caption:** required, at most 2000 characters. **Title** is its first
  non-empty line, cut to 120 characters with "…" when longer. **Description** is
  the whole caption.
- **Image: required.** Same size cap and the same sniffed-format check as today
  (PNG, JPEG or WebP by its bytes, never by its claimed type).
- **Page path** through `sanitizePagePath`, as today.
- **Kind and source** take the same defaults as `/bugs/new` (`BUG`, `APP`); a
  triager corrects the kind on the board, as they already can.
- **Same hourly cap** (5 per person per rolling hour), counted and written in one
  transaction; **same `BUG_REPORTED` notice** to every platform admin.

**One shared core.** The image check, the count-then-create transaction and the
notice move out of `reportBug` into one helper that both actions call, so the
two ways of filing cannot drift apart. `reportBug` keeps its fields, its
messages and its redirect; its existing tests pass unchanged. (That code is
doston3333's from 2 October, not the owner's; and the move keeps its behaviour
whole.)

**Small pure helpers** in `src/lib/bugs.ts`, beside the rules they belong with:
the caption-to-title cut, the diagnostics reader that applies the table above,
and a user-agent summary (below).

## What triage sees

- **`/bugs/[id]`** gains one line under the screenshot, for the reporter and
  platform admins (the report's existing audience):
  *Chrome 141 on macOS · dark · 1061×1084 @2x · 2 marks · build f249b1f*.
  Parts that are empty are left out; the line is absent when all are.
- The browser and system come from a small summary of the user agent (Chrome,
  Edge, Firefox, Safari, Samsung Internet; iOS, Android, macOS, Windows, Linux),
  written here, no dependency. The raw string is in the line's `title`, for
  anything the summary does not know.
- **`/bugs/triage`** gains no columns.
- **The public Fixed list must not read the new columns**, under the same rule
  that already keeps it from reading `title`, `description`, `reporterId` and
  the image. Its query-shape test is extended to say so.

## Privacy

- Capture happens in the browser, of what the person can already see. Nothing
  leaves the device until they press Send, having seen the image.
- Hide boxes are burned into the pixels before upload.
- The report's audience does not change: its reporter and platform admins.
- `/bugs/new` keeps its *Avoid anything private* hint.

## Errors

| What happens | What the person sees |
|---|---|
| Rendering throws or times out (10 s) | The fallback in step 6. |
| The image will not shrink under 600 KB | *That image is too large to attach.* Send stays available after choosing another. |
| The hourly cap | Today's message, in the overlay. |
| Network failure or session expired | The error in the overlay; the drawing and caption stay. |
| The caption is empty | *Say what should change.* under the box. |

## Out of scope

Telegram or email delivery, a floating button, screen recordings, console or
network logs, more than one image, editing a report after it is sent, shapes
beyond the pen and the box, and any change to `/bugs/new`.

## Testing

Vitest, with the repo's SQLite test database for the action.

- **Helpers:** the title cut (first line, blank leading lines, exactly 120,
  over 120); the diagnostics reader (each column's accepted and dropped
  values, including control characters and an `@99x` ratio); the user-agent
  summary on real strings from each browser and system above.
- **`reportOnScreen`:** signed out; empty and overlong caption; image missing,
  too large, labelled PNG but really HTML; the hourly cap shared with
  `reportBug` (three of each make six, and the sixth is refused); diagnostics
  stored when good and dropped when not; `build` taken from the environment and
  never from the form; the platform admins notified.
- **`reportBug`:** its existing tests, unchanged, after the core moves.
- **Fixed list:** its query shape still excludes the new columns.
- **In the running app** (the `verify` skill): capture, draw, hide, undo, send
  and the fallback — as a student and a platform admin, at desktop and phone
  widths, in light and dark, on a scrolled page — then the report and its
  diagnostics line on `/bugs/[id]`.
- **Release checks:** `npm run lint`, `tsc`, the full suite, and the production
  build.

## Changelog

The commit that makes the overlay reachable from the account menu adds a
**New** entry to `CHANGELOG.md` under that day's heading (AGENTS.md). Earlier
commits — the columns, the helpers, the action — add none.

## Where the work happens

A worktree on `worktree-on-screen-bug-reports`, branched from `origin/main`
(`25e3c40`). The main checkout's branch, `meet-drafts`, holds someone's
uncommitted scheduled-classes work and is not touched.
