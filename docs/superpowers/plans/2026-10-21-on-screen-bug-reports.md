# On-screen Bug Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Report a bug" in the account menu captures the visible page, lets the person draw on it and hide what is private, takes one caption, and files it into the existing bug reports without leaving the page, with viewport, theme, browser and build attached.

**Architecture:** A client host mounted once in `AppShell` listens for a window event, renders the viewport with `modern-screenshot` (loaded on demand), and shows a native `<dialog>` with a canvas for marks. Send flattens the marks, shrinks the image with the loop the upload form already uses, and calls a new server action, `reportOnScreen`. That action and the existing `reportBug` share one filing core. Five nullable columns on `BugReport` hold the diagnostics; `/bugs/[id]` shows them as one line.

**Tech Stack:** Next 16.2 (App Router, server actions), React 19.2, Prisma 7 on SQLite, Tailwind 4, Vitest 5 (node environment), `modern-screenshot` 4.7.0.

**Spec:** `docs/superpowers/specs/2026-10-21-on-screen-bug-reports-design.md`. Read it first; this plan argues from it.

## Global Constraints

- Work in this worktree (`.claude/worktrees/on-screen-bug-reports`, branch `worktree-on-screen-bug-reports`, based on `origin/main` `25e3c40`). Never touch the main checkout or its `meet-drafts` branch.
- **Git has no author identity on this machine.** The person must set one (or name one) before the first commit; do not invent one.
- Before every commit that changes code (not docs or tests alone), run the `verify` skill. For Tasks 1–4, building and booting the app is enough; Task 5 drives the flow.
- `modern-screenshot` pinned to exactly `"4.7.0"`, with no caret. It is the only new dependency.
- Read `node_modules/next/dist/docs/` for anything about server actions or client components you are unsure of (AGENTS.md: this Next differs from your training data).
- `src/lib/actions/bugs.ts` is a `"use server"` file. **Every function exported from it becomes a public endpoint.** Shared helpers live in `src/lib/bug-filing.ts` (`import "server-only"`), never as exports of the action file.
- Copy is fixed by the spec: **What should change?**, *Only you and the people fixing it will see this.*, *This page couldn't be captured.*, **Choose a screenshot instead**, *Say what should change.*, *Report sent.* with the action **View**.
- `npm run lint` (eslint plus the colour, copy, spacing and type checks) must pass. No raw Tailwind palette classes; the pen and Hide colours come from `--color-danger` and `--color-ink` via `getComputedStyle` at run time.
- Limits come from `src/lib/bugs.ts`: `BUG_TITLE_MAX` 120, `BUG_DESCRIPTION_MAX` 2000 (the caption cap), `BUG_SHOT_MAX_BYTES` 600 KB, `BUG_SHOT_MAX_EDGE` 1600, `BUG_REPORTS_PER_HOUR` 5.
- `CHANGELOG.md` gets its entry only in the commit that makes the overlay reachable (Task 5).
- The pre-push hook (`scripts/owner-guard.mjs`) must pass without an `Owner-reviewed:` trailer. Nothing here deletes the owner's recent lines; if it fires, stop and ask.

## Review Focus

1. **Marks land under the finger when the image is scaled to fit.** On a phone the canvas is drawn smaller than its pixels; pointer coordinates must be mapped through the canvas's on-screen box. Pinned by the `toImagePoint` tests (Task 4).
2. **A capture too large for the device's canvas.** iOS Safari draws a blank canvas past about 16.7 million pixels, and a 4K screen at 2× is 33 million. The capture scale is capped. Pinned by the `captureScale` tests (Task 4).
3. **A page scrolled down, or scrolled inside a table.** The image must show what was on screen, not the top of the page. Pinned by the scrolled-roster checks in Task 5, Step 7.
4. **The account menu or its phone sheet in the picture.** The capture must wait until the menu is gone. Pinned by the desktop and phone checks in Task 5, Step 7.
5. **Send failing after a long drawing, or pressed twice.** Drawing and caption survive a failure, and one press makes one report. Pinned by the offline and double-press checks in Task 5, Step 7.

---

### Task 1: Diagnostics columns and the pure rules

**Files:**
- Modify: `prisma/schema.prisma` (model `BugReport`)
- Create: `prisma/migrations/20261021090000_bug_report_diagnostics/migration.sql`
- Modify: `src/lib/bugs.ts`
- Test: `src/lib/bugs.test.ts`

**Interfaces:**
- Produces, in `src/lib/bugs.ts`:
  - `type BugDiagnostics = { viewport: string | null; theme: "light" | "dark" | null; userAgent: string | null; marks: number | null }`
  - `readDiagnostics(form: { get(name: string): FormDataEntryValue | null }): BugDiagnostics`. Reads the fields `width`, `height`, `ratio`, `theme`, `userAgent` and `marks`.
  - `captionTitle(caption: string): string`
  - `shortBuild(raw: string | undefined): string | null`
  - `summarizeUserAgent(ua: string): string | null`
  - `diagnosticsLine(d: BugDiagnostics & { build: string | null }): string | null`
  - `reportPagePath(pathname: string): string | null`
  - `type ScreenReportState = { ok: true; id: string } | { ok: false; error: string; field?: "caption" } | null`
  - `BUG_UA_MAX = 300`, `BUG_MARKS_MAX = 500`
- Produces, on `BugReport`: `viewport String?`, `theme String?`, `userAgent String?`, `build String?`, `marks Int?`

- [ ] **Step 1: Set up the worktree**

Run: `npm ci` (its postinstall runs `prisma generate`), then `cp ../../../.env .env`.
Expected: `node_modules/` exists, and `npx vitest run src/lib/bugs.test.ts` passes on the untouched code.

- [ ] **Step 2: Write the failing tests** in `src/lib/bugs.test.ts`, one `describe` per helper:

```ts
describe("captionTitle", () => {
  it("is the first non-empty line, trimmed", () =>
    expect(captionTitle("\n\n  Make this card bigger  \nit is tiny")).toBe("Make this card bigger"));
  it("keeps a 120-character line whole", () =>
    expect(captionTitle("a".repeat(120))).toBe("a".repeat(120)));
  it("cuts a longer line to 120 with an ellipsis", () =>
    expect(captionTitle("a".repeat(121))).toBe("a".repeat(119) + "…"));
});

describe("readDiagnostics", () => {
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  it("builds the viewport from two integers and a ratio", () =>
    expect(readDiagnostics(fd({ width: "1061", height: "1084", ratio: "2" })).viewport).toBe("1061×1084 @2x"));
  it("rounds an odd ratio to two places", () =>
    expect(readDiagnostics(fd({ width: "412", height: "915", ratio: "1.3333333" })).viewport).toBe("412×915 @1.33x"));
  it.each([["0", "900", "1"], ["1440", "10001", "1"], ["1440", "900", "99"], ["14.5", "900", "1"], ["1440", "900", "0.4"]])(
    "drops a viewport outside its rule: %s×%s @%s", (width, height, ratio) =>
      expect(readDiagnostics(fd({ width, height, ratio })).viewport).toBeNull());
  it("keeps light and dark and nothing else", () => {
    expect(readDiagnostics(fd({ theme: "dark" })).theme).toBe("dark");
    expect(readDiagnostics(fd({ theme: "sepia" })).theme).toBeNull();
  });
  it("cuts a long user agent to 300 and drops one with a control character", () => {
    expect(readDiagnostics(fd({ userAgent: "x".repeat(400) })).userAgent).toHaveLength(300);
    expect(readDiagnostics(fd({ userAgent: "Mozilla\u0000" })).userAgent).toBeNull();
  });
  it("keeps marks 0–500 as an integer", () => {
    expect(readDiagnostics(fd({ marks: "0" })).marks).toBe(0);
    expect(readDiagnostics(fd({ marks: "500" })).marks).toBe(500);
    expect(readDiagnostics(fd({ marks: "501" })).marks).toBeNull();
    expect(readDiagnostics(fd({ marks: "2.5" })).marks).toBeNull();
  });
  it("is all null for an empty form", () =>
    expect(readDiagnostics(new FormData())).toEqual({ viewport: null, theme: null, userAgent: null, marks: null }));
});

describe("shortBuild", () => {
  it("is the first seven characters of a commit hash", () =>
    expect(shortBuild("F249B1F0c2d4e")).toBe("f249b1f"));
  it.each([undefined, "", "main", "f249b1"])("is null for %s", (raw) => expect(shortBuild(raw)).toBeNull());
});

describe("summarizeUserAgent", () => {
  // One real string per row: Chrome/macOS, Safari/iOS, Firefox/Windows, Edge/Windows,
  // Samsung Internet/Android, Chrome on iOS (CriOS), Chrome/Android, Firefox/Linux.
  it.each(UA_CASES)("reads %s", (_name, ua, expected) => expect(summarizeUserAgent(ua)).toBe(expected));
  it("is null for a string it knows nothing about", () => expect(summarizeUserAgent("curl/8.4.0")).toBeNull());
});

describe("diagnosticsLine", () => {
  it("joins what is there, in order", () =>
    expect(diagnosticsLine({ userAgent: MAC_CHROME_141, theme: "dark", viewport: "1061×1084 @2x", marks: 2, build: "f249b1f" }))
      .toBe("Chrome 141 on macOS · dark · 1061×1084 @2x · 2 marks · build f249b1f"));
  it("says 1 mark, and leaves out 0 marks", () => {
    expect(diagnosticsLine({ userAgent: null, theme: null, viewport: null, marks: 1, build: null })).toBe("1 mark");
    expect(diagnosticsLine({ userAgent: null, theme: "light", viewport: null, marks: 0, build: null })).toBe("light");
  });
  it("is null when nothing is there", () =>
    expect(diagnosticsLine({ userAgent: null, theme: null, viewport: null, marks: null, build: null })).toBeNull());
});

describe("reportPagePath", () => {
  it("sends the page", () => expect(reportPagePath("/students/abc")).toBe("/students/abc"));
  it.each(["/bugs", "/bugs/new", "/bugs/triage"])("sends nothing from %s", (p) => expect(reportPagePath(p)).toBeNull());
});
```

`UA_CASES` and `MAC_CHROME_141` are real user-agent strings, written at the top of the file. Expected values follow the form `"Chrome 141 on macOS"`, `"Safari 18 on iOS"`, `"Samsung Internet 28 on Android"`, `"Chrome 141 on iOS"`.

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/lib/bugs.test.ts`
Expected: FAIL, with `captionTitle` (and the others) not exported.

- [ ] **Step 4: Add the columns and the migration**

In `BugReport`, after `pagePath`, add the five nullable fields with a comment: they are filled only by the on-screen report, and everything from the browser is untrusted and checked by `readDiagnostics` (except `build`, which the server reads from its own environment). `migration.sql` is five `ALTER TABLE "BugReport" ADD COLUMN …` statements (`TEXT` four times, `INTEGER` for `marks`). Run `npx prisma generate`.

- [ ] **Step 5: Implement the helpers in `src/lib/bugs.ts`**

- **`readDiagnostics`:** width and height must match `/^\d{1,5}$/` and lie in 1–10000. The ratio is a finite number in 0.5–5, printed with at most two decimals and no trailing zeros. All three must be valid, or `viewport` is null.
- **`summarizeUserAgent`:** test patterns in this order. Browser: `Edg`, then `SamsungBrowser`, then `Firefox|FxiOS`, then `Chrome|CriOS`, then `Version/N … Safari/`. System: `iPhone|iPad|iPod`, then `Android`, then `Mac OS X`, then `Windows`, then `Linux`. Return `"<browser> on <system>"`, or whichever half matched, or null.
- **`reportPagePath`:** null for `/bugs` and anything under `/bugs/`, the rule `ReportBugLink` applies today.

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run src/lib/bugs.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit** (after the `verify` build-and-boot check)

```bash
git add prisma/schema.prisma prisma/migrations/20261021090000_bug_report_diagnostics src/lib/bugs.ts src/lib/bugs.test.ts
git commit -m "Hold a bug report's viewport, theme, browser, build and marks, and the rules that check them"
```

---

### Task 2: One filing core, and the `reportOnScreen` action

**Files:**
- Create: `src/lib/bug-filing.ts`
- Modify: `src/lib/actions/bugs.ts` (`reportBug`, plus the new `reportOnScreen`)
- Test: `src/lib/actions/bugs.test.ts`

**Interfaces:**
- Consumes: from Task 1, `readDiagnostics`, `captionTitle`, `shortBuild`, `BugDiagnostics` and `ScreenReportState`.
- Produces, in `src/lib/bug-filing.ts` (server-only, **not** a `"use server"` file):
  - `type ReportImage = { bytes: Uint8Array; mimeType: string }`
  - `readScreenshot(entry: FormDataEntryValue | null): Promise<{ ok: true; image: ReportImage | null } | { ok: false; error: string }>`. This is today's size check and sniff, with today's two messages.
  - `fileBugReport(actor: Pick<User, "id" | "role">, report: { title: string; description: string; pagePath: string | null; image: ReportImage | null; diagnostics?: BugDiagnostics & { build: string | null } }): Promise<{ id: string } | null>`. It returns null when over the hourly cap. It counts and creates in one transaction and notifies every platform admin with `BUG_REPORTED`, as `reportBug` does today.
  - `HOURLY_CAP_MESSAGE`: today's cap sentence, moved verbatim.
- Produces, in `src/lib/actions/bugs.ts`: `reportOnScreen(_prev: ScreenReportState, formData: FormData): Promise<ScreenReportState>`. It reads the fields `caption`, `screenshot`, `from`, and the six diagnostics fields.

- [ ] **Step 1: Write the failing tests**, a new `describe("reportOnScreen")` in `src/lib/actions/bugs.test.ts`, using its existing `actor`, `form`, `png` and `submit` helpers:

```ts
const onScreen = (fields: Record<string, string | File>) => reportOnScreen(null, form(fields));
const shot = { caption: "Make this card bigger\nit is tiny", screenshot: png(), from: "/students/abc?x=1" };

it("files the caption as title and description, with the image and page, and tells the platform admins", async () => {
  // a mentor files; two platform admins exist
  // state is { ok: true, id }; the row has title "Make this card bigger", description = the whole caption,
  // pagePath "/students/abc", kind "BUG", source "APP", a BugReportImage; each admin has one BUG_REPORTED notification
});
it("stores good diagnostics", async () => {
  // width 1061, height 1084, ratio 2, theme dark, userAgent a Chrome-on-macOS string, marks 2
  // → viewport "1061×1084 @2x", theme "dark", userAgent stored, marks 2
});
it("drops bad diagnostics and still files the report", async () => {
  // theme "sepia", marks "9999", width "abc" → ok: true; theme, marks, viewport all null
});
it("takes the build from the environment, never from the form", async () => {
  vi.stubEnv("RENDER_GIT_COMMIT", "f249b1f0c2d4e5");
  // form also sends build: "deadbee" → row.build === "f249b1f"; vi.unstubAllEnvs() after
});
it("refuses a signed-out call", async () => { /* actor null → { ok: false, error: "Sign in to do that." }, no row */ });
it.each(["", "  \n \n"])("refuses an empty caption: %j", async (caption) => {
  // → { ok: false, field: "caption", error: "Say what should change." }, no row
});
it("refuses a caption over 2000 characters", async () => { /* field "caption", no row */ });
it("refuses a report with no image", async () => { /* no screenshot field → ok: false, no row */ });
it("refuses a file labelled PNG whose bytes are HTML", async () => { /* ok: false, no row, no image row */ });
it("shares the hourly cap with the form", async () => {
  // 3 × submit(form(valid)) then 3 × onScreen(shot): the sixth (an on-screen one) is { ok: false }, count stays 5
});
```

Add one assertion to the existing `"reads nothing but the fix line…"` test in `src/lib/bug-queries.test.ts`: its fixture also sets the five new columns, and its key list stays `["changelogDate", "resolution", "resolvedAt"]`. Extend the `bugReport` factory in `src/test/db.ts` with the five optional fields.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/actions/bugs.test.ts src/lib/bug-queries.test.ts`
Expected: FAIL, with `reportOnScreen` not exported. The existing `reportBug` tests still pass.

- [ ] **Step 3: Move the core into `src/lib/bug-filing.ts` and make `reportBug` call it**

`reportBug` keeps its field checks, its messages and its redirect. Only the screenshot read, the transaction and the notice move. The comments that explain them move with them.

- [ ] **Step 4: Implement `reportOnScreen` in `src/lib/actions/bugs.ts`**

Checks run in this order: actor, caption (trimmed; empty gives *Say what should change.*; over `BUG_DESCRIPTION_MAX` gives ``Keep it under ${BUG_DESCRIPTION_MAX} characters.``), image (missing gives *Attach a picture of the screen.*; otherwise `readScreenshot`'s verdict), then `fileBugReport`. Pass `pagePath: sanitizePagePath(formData.get("from"))` and `diagnostics: { ...readDiagnostics(formData), build: shortBuild(process.env.RENDER_GIT_COMMIT) }`. A null result returns `HOURLY_CAP_MESSAGE`. On success, call `revalidatePath("/bugs", "layout")` and return `{ ok: true, id }` with **no redirect**. The doc comment says why: the person stays on their page.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/lib/actions/bugs.test.ts src/lib/bug-queries.test.ts`
Expected: PASS, the old `reportBug` tests included.

- [ ] **Step 6: Commit** (after the `verify` build-and-boot check)

```bash
git add src/lib/bug-filing.ts src/lib/actions/bugs.ts src/lib/actions/bugs.test.ts src/lib/bug-queries.test.ts src/test/db.ts
git commit -m "File a report from the screen through the same checks, cap and notice as the form"
```

---

### Task 3: The diagnostics line on a report

**Files:**
- Modify: `src/lib/bug-queries.ts` (`bugReportFor`)
- Modify: `src/app/bugs/[id]/page.tsx`
- Test: `src/lib/bug-queries.test.ts`

**Interfaces:**
- Consumes: `diagnosticsLine` (Task 1).
- Produces: `bugReportFor(...)` also returns `diagnostics: string | null` and `userAgent: string | null`.

- [ ] **Step 1: Write the failing tests**, in the `bugReportFor` describe:

```ts
it("gives the reporter and a platform admin the diagnostics line", async () => {
  // report with userAgent MAC_CHROME_141, theme "dark", viewport "1061×1084 @2x", marks 2, build "f249b1f"
  // → for both viewers: diagnostics === "Chrome 141 on macOS · dark · 1061×1084 @2x · 2 marks · build f249b1f"
});
it("has no line for a report filed through the form", async () => { /* diagnostics null, userAgent null */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/bug-queries.test.ts`
Expected: FAIL, with `diagnostics` undefined.

- [ ] **Step 3: Select the five columns in `bugReportFor` and return `diagnostics` and `userAgent`**

- [ ] **Step 4: Render it on `/bugs/[id]`.** Put the line directly under the image, or where the image would be. Use the same `text-xs text-muted-fg` as the "On /path" line, with `title={report.userAgent ?? undefined}`. Render nothing when `diagnostics` is null.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/lib/bug-queries.test.ts "src/app/bugs/[id]/page.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit** (after the `verify` build-and-boot check)

```bash
git add src/lib/bug-queries.ts src/lib/bug-queries.test.ts "src/app/bugs/[id]/page.tsx"
git commit -m "Show a report's browser, theme, viewport, marks and build under its picture"
```

---

### Task 4: Marks, scaling and shrinking

**Files:**
- Create: `src/lib/screen-marks.ts`
- Create: `src/lib/shrink-image.ts`
- Modify: `src/components/forms/bug-report-form.tsx` (import the moved shrink loop)
- Test: `src/lib/screen-marks.test.ts`

**Interfaces:**
- Produces, in `src/lib/screen-marks.ts` (no DOM globals at import time):
  - `type Point = { x: number; y: number }`
  - `type Mark = { kind: "pen"; points: Point[] } | { kind: "hide"; x: number; y: number; w: number; h: number }`. All values are in image pixels.
  - `toImagePoint(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }, image: { width: number; height: number }): Point`
  - `boxFrom(a: Point, b: Point): Extract<Mark, { kind: "hide" }>`
  - `MIN_HIDE = 4`. A box narrower or shorter than this is discarded on release.
  - `penWidth(imageWidth: number): number`, equal to `Math.max(3, Math.round(imageWidth / 300))`
  - `captureScale(width: number, height: number, dpr: number): number`, equal to `Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)))`, with `MAX_CANVAS_PIXELS = 16_000_000`
  - `drawMarks(ctx: Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "lineTo" | "stroke" | "fillRect" | "save" | "restore"> & { strokeStyle: unknown; fillStyle: unknown; lineWidth: number; lineCap: CanvasLineCap; lineJoin: CanvasLineJoin; globalAlpha: number }, marks: Mark[], colors: { pen: string; hide: string }, imageWidth: number): void`. It draws in the order the marks were made: hide boxes as opaque fills at `globalAlpha` 1, pen strokes round-capped.
- Produces, in `src/lib/shrink-image.ts`:
  - `shrinkToBlob(source: ImageBitmap | HTMLCanvasElement): Promise<Blob>`. This is today's `toScreenshot` loop (scale to `BUG_SHOT_MAX_EDGE`, WebP then JPEG, up to 4 tries at ×0.7, and the same "too large" error).
  - `toScreenshot(file: File): Promise<Blob>`, which is `createImageBitmap` followed by `shrinkToBlob`, closing the bitmap.

- [ ] **Step 1: Write the failing tests** in `src/lib/screen-marks.test.ts`:

```ts
it("maps a pointer on a half-size canvas to full-size pixels", () =>
  expect(toImagePoint(160, 90, { left: 10, top: 40, width: 400, height: 250 }, { width: 800, height: 500 })).toEqual({ x: 300, y: 100 }));
it("clamps a pointer dragged off the canvas to its edge", () =>
  expect(toImagePoint(-50, 999, { left: 0, top: 0, width: 400, height: 250 }, { width: 800, height: 500 })).toEqual({ x: 0, y: 500 }));
it("makes a box from any two corners", () =>
  expect(boxFrom({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ kind: "hide", x: 10, y: 20, w: 40, h: 60 }));
it("keeps the device ratio while the canvas fits", () => expect(captureScale(1440, 900, 2)).toBe(2));
it("caps a 4K screen at 2x under the canvas limit", () => {
  const s = captureScale(3840, 2160, 2);
  expect(3840 * 2160 * s * s).toBeLessThanOrEqual(16_000_000);
});
it("draws a pen line at least 3px wide, wider on a wide image", () => {
  expect(penWidth(600)).toBe(3);
  expect(penWidth(3000)).toBe(10);
});
it("fills a hide box opaquely, in the order the marks were made", () => {
  // a recording fake ctx: pen then hide → calls are [stroke…, fillRect(10,20,40,60)], globalAlpha 1 at fillRect, fillStyle "hide-colour"
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/screen-marks.test.ts`
Expected: FAIL, with the module not found.

- [ ] **Step 3: Implement `src/lib/screen-marks.ts`.** Then move `toScreenshot` from `bug-report-form.tsx` into `src/lib/shrink-image.ts`, split as above, and import it back into the form. The form must behave the same.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/screen-marks.test.ts && npx tsc --noEmit`
Expected: PASS, with no type errors.

- [ ] **Step 5: Commit** (after the `verify` build-and-boot check, uploading one screenshot on `/bugs/new` to prove the move)

```bash
git add src/lib/screen-marks.ts src/lib/screen-marks.test.ts src/lib/shrink-image.ts src/components/forms/bug-report-form.tsx
git commit -m "Map, scale and draw marks on a captured screen, and share the image shrink loop"
```

---

### Task 5: The overlay, the menu row, and shipping it

**Files:**
- Modify: `package.json`, `package-lock.json` (`modern-screenshot` `4.7.0`)
- Create: `src/lib/capture-screen.ts`
- Create: `src/components/screen-report/screen-report-host.tsx`
- Create: `src/components/screen-report/screen-report-overlay.tsx`
- Create: `src/components/report-bug-button.tsx`
- Delete: `src/components/report-bug-link.tsx` (its only caller is the menu row)
- Modify: `src/components/ui/popover.tsx` (the close context)
- Modify: `src/components/app-shell.tsx` (the row, and mounting the host)
- Modify: `src/components/toaster.tsx` (`data-capture-skip` on its outermost element)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `reportOnScreen` and `ScreenReportState` (Task 2); `reportPagePath` (Task 1); everything in `screen-marks.ts` and `shrinkToBlob` (Task 4); `toast` from `src/components/toaster.tsx`; `Field` and `Textarea` from `ui/field.tsx`; `SegmentedRadio` from `ui/segmented.tsx`; `Button` from `ui/button.tsx`.
- Produces:
  - `usePopoverClose(): (() => void) | null` in `ui/popover.tsx`. The panel's children are wrapped in a context whose value is `() => close(false)`. The context is needed because `AccountMenu` is a server component and cannot hand its children the `close` function.
  - `captureViewport(): Promise<HTMLCanvasElement>` in `src/lib/capture-screen.ts`. It does `await import("modern-screenshot")`, crops to `innerWidth × innerHeight` at the current scroll position, uses scale `captureScale(innerWidth, innerHeight, devicePixelRatio)`, and filters out any node inside `[data-capture-skip]`. It rejects after 10 s.
  - `openScreenReport(): void` in `screen-report-host.tsx`. It dispatches the window event `"app-screen-report"`, the same pattern `toast()` uses.
  - `<ScreenReportHost />` (client), mounted once in `AppShell` beside the shell's children, so both the staff and student shells have it.

- [ ] **Step 1: Add the dependency**

Run: `npm install --save-exact modern-screenshot@4.7.0`
Expected: `package.json` has `"modern-screenshot": "4.7.0"`.

- [ ] **Step 2: Build the capture and the host.** The host ignores the event while a capture is running. It waits two `requestAnimationFrame`s, so the closed menu is painted away, then calls `captureViewport`. It opens the overlay with the canvas, or with `null` if the capture threw or timed out.

- [ ] **Step 3: Build the overlay** as a native `<dialog>` opened with `showModal()`, carrying `data-capture-skip`. That gives focus containment, an inert page, the top layer and Esc. Behaviour comes from the spec's flow, steps 2–6:
  - The canvas holds the image's pixels and is CSS-fitted. It is redrawn as image plus `drawMarks` on every change. Pointer events with pointer capture, `touch-action: none`, and coordinates through `toImagePoint`. The tools are **Pen** and **Hide** (`SegmentedRadio`, Pen by default) and **Undo** (disabled with no marks).
  - The pen colour is `--color-danger` and the Hide colour is `--color-ink`, both read by `getComputedStyle(document.documentElement)` when the overlay opens.
  - Fallback: with no image, show *This page couldn't be captured.* and a file input labelled **Choose a screenshot instead** (accepting `BUG_SHOT_ACCEPT`). The chosen file goes through `createImageBitmap` onto the same canvas.
  - **Cancel** and Esc close the overlay without sending. Both are ignored while sending.
  - **Send** stays disabled while sending. It builds `FormData` with `caption`, `screenshot` (`shrinkToBlob(canvas)` as `screenshot.webp`), `from` (`reportPagePath(pathname)`, empty when null), `width` (`innerWidth`), `height` (`innerHeight`), `ratio` (`devicePixelRatio`), `theme` (`document.documentElement.dataset.theme`), `userAgent` (`navigator.userAgent`) and `marks` (`marks.length`). It then calls `reportOnScreen(null, data)` inside a transition.
  - On `{ ok: true }`: close the overlay, then `toast({ message: "Report sent.", action: { label: "View", run: () => router.push(`/bugs/${id}`) } })`. On `{ ok: false }`: show the error under the caption when `field === "caption"`, otherwise above Send, and keep the canvas and caption. Errors that are thrown rather than returned also show above Send, with the canvas and caption kept: `shrinkToBlob`'s *That image is too large to attach.*, and a call that never reached the server (*Couldn't send the report. Check your connection and try again.*).
  - At phone widths the dialog fills the screen and the caption stays reachable above the keyboard.

- [ ] **Step 4: Swap the menu row.** `ReportBugButton` keeps the row's look (`MENU_ROW`, plus `w-full cursor-pointer text-left` like Sign out), the alert icon and the words **Report a bug**. On click it calls `usePopoverClose()?.()` and then `openScreenReport()`. Delete `report-bug-link.tsx`. Mount `<ScreenReportHost />` in `AppShell`. Add `data-capture-skip` to the Toaster's outer element.

- [ ] **Step 5: Write the changelog entry** under today's heading (create `## 2026-10-21` above `## 2026-10-20` if it isn't there), under `### New`:

```markdown
- **Report a bug by drawing on the screen.** Report a bug in your account menu now takes a picture of the page you're on, so you can circle what's wrong, cover anything private, write one line and send it without leaving the page.
```

- [ ] **Step 6: Release checks**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 7: Drive it with the `verify` skill.** Check each of these and record what you saw:
  1. As a platform admin on desktop, light theme, on `/students` scrolled halfway down with a table scrolled sideways: the image shows exactly what was on screen, with no account menu.
  2. Draw two pen marks and one Hide box, then Undo once. Send with a two-line caption. The toast's **View** opens the report: the title is line one, the image shows the remaining mark, and the diagnostics line reads `<browser> on <system> · light · <w>×<h> @<r>x · 2 marks`. There is no build part locally, because `RENDER_GIT_COMMIT` is unset.
  3. As a student at phone width (375×812), dark theme: the menu opens as a sheet. The image shows neither the sheet nor the dimmed backdrop. A pen stroke lands under the pointer at both ends of the canvas.
  4. Go offline in the browser, then press Send. The error shows, and the marks and caption are still there. Go back online and Send once. Press Send twice quickly: only one report is filed.
  5. Make the capture fail (for example, block the dynamic import's chunk in the network panel). The fallback shows. Choose a PNG, draw on it, and send.
  6. On `/bugs/new` the upload form still files a report with a screenshot, and on `/bugs` the **Report a bug** button still opens that form.

Expected: every check holds. Any that doesn't goes back to Step 3 or 4.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/capture-screen.ts src/components/screen-report src/components/report-bug-button.tsx src/components/report-bug-link.tsx src/components/ui/popover.tsx src/components/app-shell.tsx src/components/toaster.tsx CHANGELOG.md
git commit -m "Report a bug by drawing on the page you are on, without leaving it"
```
