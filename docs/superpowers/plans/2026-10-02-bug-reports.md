# Bug Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in users report bugs (title, description, optional screenshot), see their own reports and where each stands, and see a shared list of fixes; platform admins triage.

**Architecture:** Two new tables (`BugReport`, `BugReportImage` — the image in its own table so listing never loads bytes). Pure helpers in `src/lib/bugs.ts`; read queries in `src/lib/bug-queries.ts` that mask by viewer; two server actions (`reportBug`, `setBugStatus`); a gated image route; pages under `/bugs`; two rows in the account menu.

**Tech Stack:** Next.js (custom version — read `node_modules/next/dist/docs/` if an API surprises you), Prisma + SQLite, Vitest, Tailwind tokens.

**Spec:** `docs/superpowers/specs/2026-10-02-bug-reports-design.md`

## Global Constraints

- **Every page and route calls its own gate on its first line**, before any query (AGENTS.md, "Gate every page"). `requireUser()` for `/bugs`, `/bugs/new`, `/bugs/[id]` and the image route; `requirePlatformAdmin()` for `/bugs/triage`.
- A gate that must load a row **fetches first, then gates**, and answers "not yours" and "does not exist" identically (404).
- **The Fixed list selects only `resolution`, `resolvedAt`, `changelogDate`.** It must never read `title`, `description`, `reporterId`, `reporterRole`, `pagePath` or the image.
- A `CLOSED` note is private to the reporter and triagers; it never reaches the Fixed list.
- Triage actions re-check `platformAdmin` inside the action, not only on the page.
- Screenshot: PNG/JPEG/WebP only, ≤ 600 KB (`BUG_SHOT_MAX_BYTES`), format **sniffed from the bytes** with `sniffImageType`, never the client's `type`.
- Limits: title ≤ 120, description ≤ 2000, fix line / note ≤ 300, page path ≤ 300; 5 reports per person per rolling hour, counted in the database inside a transaction.
- Page capture keeps a path only: single leading `/`, no `//`, no `\`, no control characters, query string and fragment stripped; anything else is dropped and the report is still saved.
- `"use server"` files export only async functions — constants live in `src/lib/bugs.ts`.
- `npm run lint` runs `scripts/check-copy.mjs` (banned: "appears here", "shows up here", "lands here", "newest first", …), `check-colors.mjs` and `check-spacing.mjs` (page rhythm is `space-y-4`). Reword rather than disable.
- Test files are type-checked by the production build; keep them type-correct. Prisma `Bytes` fields have bitten this repo before — build the image payload as `Prisma.BugReportImageCreateWithoutReportInput`.
- **Never `git add -A` / `git add .`**: the working tree has unrelated, unstaged deletions under `docs/superpowers/`. Add files by name.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Only Task 9's commit makes this reachable from the UI, so only it adds a `CHANGELOG.md` entry.

## Review Focus

- A file labelled `image/png` whose bytes are HTML is refused and nothing is saved (Task 4).
- `from` values `//evil.com`, `/\evil.com`, `https://evil.com`, 301 characters: the report is saved with no page (Tasks 2 and 4).
- Seven concurrent submissions by one person save exactly five — the cap cannot be beaten by double-clicking (Task 4).
- Somebody other than the reporter asking for the report page or the screenshot gets the same 404 as an unknown id (Tasks 3, 6, 8).
- A reporter whose account is removed: the report survives, triage reads "Former user" (Task 3).
- A title containing HTML renders as text and a description keeps its line breaks (browser check, Task 9).

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/…_bug_reports/migration.sql` | the two tables |
| `src/test/db.ts` | reset order + `bugReport()` factory |
| `src/lib/bugs.ts` (+ test) | statuses, limits, `sanitizePagePath`, `readTriageFilter` — pure, client-safe |
| `src/lib/dal.ts` (+ `dal.test.ts`) | `requirePlatformAdmin` |
| `src/lib/bug-queries.ts` (+ test) | `myBugReports`, `fixedBugs`, `bugReportFor`, `triageList` |
| `src/lib/constants.ts` | `BUG_REPORTED` / `BUG_FIXED` / `BUG_CLOSED` notification types |
| `src/lib/actions/bugs.ts` (+ tests) | `reportBug`, `setBugStatus` |
| `src/app/api/bug-report/[id]/image/route.ts` (+ test) | gated screenshot |
| `src/app/bugs/…`, `src/components/forms/bug-report-form.tsx`, `bug-triage-form.tsx` | pages and forms |
| `src/components/report-bug-link.tsx`, `src/components/app-shell.tsx`, `src/app/changelog/page.tsx` | entry points |

---

### Task 1: Schema, migration, test fixtures

**Files:**
- Modify: `prisma/schema.prisma` (new models; two relation fields on `User`)
- Create: `prisma/migrations/20261002110000_bug_reports/migration.sql`
- Modify: `src/test/db.ts`

**Interfaces:**
- Produces: Prisma models `BugReport`, `BugReportImage`; test helpers `bugReport(opts?)` and `PNG_BYTES`.
  `bugReport` opts: `{ reporterId?: string | null; reporterRole?: string; title?: string; description?: string; status?: string; resolution?: string | null; resolvedAt?: Date | null; changelogDate?: string | null; pagePath?: string | null; createdAt?: Date; image?: boolean }`.

- [ ] **Step 1: Add the models**

Append to `prisma/schema.prisma`:

```prisma
// Something somebody reported as broken. See docs/superpowers/specs/2026-10-02-bug-reports-design.md.
//
// Each person reads their own; everyone reads only the FIX LINE of a Fixed one
// (`resolution`, `resolvedAt`, `changelogDate` — nothing else). A reporter's
// title and description can name a student, so they are never selected by the
// public list. `resolution` is the public fix line when FIXED and a note
// private to the reporter and triagers when CLOSED.
model BugReport {
  id            String    @id @default(cuid())
  // SetNull: removing an account never removes what they reported.
  reporterId    String?
  reporterRole  String // the role at the time, for triage
  title         String
  description   String
  // A path only, validated by sanitizePagePath — never a URL.
  pagePath      String?
  status        String    @default("PENDING") // PENDING | IN_PROGRESS | FIXED | CLOSED
  resolution    String?
  resolvedAt    DateTime?
  // YYYY-MM-DD, the changelog entry a fix shipped in.
  changelogDate String?
  triagedById   String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  reporter  User?           @relation("BugReporter", fields: [reporterId], references: [id], onDelete: SetNull)
  triagedBy User?           @relation("BugTriager", fields: [triagedById], references: [id], onDelete: SetNull)
  image     BugReportImage?

  @@index([reporterId, createdAt])
  @@index([status, createdAt])
}

// One screenshot per report, in its own table for the reason AvatarImage is:
// Prisma selects every scalar, and a list of reports must not drag image bytes
// into memory. Only /api/bug-report/[id]/image reads this table.
model BugReportImage {
  id       String @id @default(cuid())
  reportId String @unique
  bytes    Bytes
  mimeType String

  report BugReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
}
```

In `model User`, after the `exchangesReturned` line, add:

```prisma
  bugsReported        BugReport[]              @relation("BugReporter")
  bugsTriaged         BugReport[]              @relation("BugTriager")
```

- [ ] **Step 2: Generate the migration SQL**

Run: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
(If the flag name differs in this Prisma version, run `npx prisma migrate diff --help` and use the equivalent "from the current database" option.)
Expected: `CREATE TABLE "BugReport"`, `CREATE TABLE "BugReportImage"` and three `CREATE … INDEX` statements, and nothing about `User`.

Save that output to `prisma/migrations/20261002110000_bug_reports/migration.sql`. If the command cannot run, write this by hand instead:

```sql
-- Bug reports: what somebody reported, and one optional screenshot.

CREATE TABLE "BugReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporterId" TEXT,
    "reporterRole" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pagePath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolution" TEXT,
    "resolvedAt" DATETIME,
    "changelogDate" TEXT,
    "triagedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BugReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BugReport_triagedById_fkey" FOREIGN KEY ("triagedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "BugReportImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "bytes" BLOB NOT NULL,
    "mimeType" TEXT NOT NULL,
    CONSTRAINT "BugReportImage_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "BugReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BugReportImage_reportId_key" ON "BugReportImage"("reportId");
CREATE INDEX "BugReport_reporterId_createdAt_idx" ON "BugReport"("reporterId", "createdAt");
CREATE INDEX "BugReport_status_createdAt_idx" ON "BugReport"("status", "createdAt");
```

- [ ] **Step 3: Apply, regenerate, and prove there is no drift**

Run: `npx prisma generate && npx prisma migrate deploy && npx prisma migrate status`
Expected: migration applied; "Database schema is up to date!".

Run: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
Expected: exit code 0 (empty diff). A non-empty diff means the SQL and the schema disagree — fix the SQL.

- [ ] **Step 4: Teach the test database about the new tables**

In `src/test/db.ts`, in `resetDb`, add before `await prisma.user.deleteMany();`:

```ts
  await prisma.bugReportImage.deleteMany();
  await prisma.bugReport.deleteMany();
```

Append to the file:

```ts
/** The eight-byte PNG signature plus padding: enough for `sniffImageType`. */
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

export async function bugReport(
  opts: {
    reporterId?: string | null;
    reporterRole?: string;
    title?: string;
    description?: string;
    status?: string;
    resolution?: string | null;
    resolvedAt?: Date | null;
    changelogDate?: string | null;
    pagePath?: string | null;
    createdAt?: Date;
    image?: boolean;
  } = {}
) {
  return prisma.bugReport.create({
    data: {
      reporterId: opts.reporterId ?? null,
      reporterRole: opts.reporterRole ?? ROLES.STUDENT,
      title: opts.title ?? "Hours look wrong",
      description: opts.description ?? "The total says 3h but I logged 4h.",
      pagePath: opts.pagePath ?? null,
      status: opts.status ?? "PENDING",
      resolution: opts.resolution ?? null,
      resolvedAt: opts.resolvedAt ?? null,
      changelogDate: opts.changelogDate ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      ...(opts.image
        ? { image: { create: { bytes: PNG_BYTES, mimeType: "image/png" } } }
        : {}),
    },
  });
}
```

- [ ] **Step 5: Type-check, run the suite, commit**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; the existing suite still passes (487 tests).

```bash
git add prisma/schema.prisma prisma/migrations/20261002110000_bug_reports src/test/db.ts
git commit -m "Add the tables for bug reports and a screenshot each

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure helpers and the platform-admin gate

**Files:**
- Create: `src/lib/bugs.ts`, `src/lib/bugs.test.ts`, `src/lib/dal.test.ts`
- Modify: `src/lib/dal.ts` (add `requirePlatformAdmin`)

**Interfaces:**
- Produces (`src/lib/bugs.ts`, no `server-only`):
  - `BUG_STATUS`, `type BugStatus`, `BUG_STATUSES: BugStatus[]`
  - `BUG_STATUS_LABELS: Record<BugStatus, string>`
  - `BUG_STATUS_SEVERITY: Record<BugStatus, "neutral" | "ok" | "attention" | "problem">`
  - `isBugStatus(value: unknown): value is BugStatus`
  - `BUG_TITLE_MAX = 120`, `BUG_DESCRIPTION_MAX = 2000`, `BUG_RESOLUTION_MAX = 300`, `BUG_PAGE_MAX = 300`, `BUG_SHOT_MAX_BYTES = 600 * 1024`, `BUG_SHOT_MAX_EDGE = 1600`, `BUG_REPORTS_PER_HOUR = 5`
  - `BUG_SHOT_MIME_TYPES = ["image/webp", "image/jpeg", "image/png"] as const`, `BUG_SHOT_ACCEPT: string`
  - `sanitizePagePath(raw: unknown): string | null`
  - `type TriageFilter = "open" | "all" | BugStatus`; `readTriageFilter(raw: string): TriageFilter`
- Produces (`dal.ts`): `requirePlatformAdmin(): Promise<User>` — redirects the signed-out to `/login`, `notFound()` for everyone who is not a platform admin.

- [ ] **Step 1: Write the failing tests**

`src/lib/bugs.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  BUG_STATUSES,
  isBugStatus,
  readTriageFilter,
  sanitizePagePath,
} from "@/lib/bugs";

describe("sanitizePagePath", () => {
  it("keeps a path and drops the query string and fragment", () => {
    expect(sanitizePagePath("/mentors/abc?period=30d#x")).toBe("/mentors/abc");
    expect(sanitizePagePath("/")).toBe("/");
    expect(sanitizePagePath("  /students/1  ")).toBe("/students/1");
  });

  it("drops everything that is not one of our own paths", () => {
    for (const bad of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/a//b",
      "evil.com/path",
      "?only=query",
      "",
      "/with\u0000nul",
      "/tab\there",
    ]) {
      expect(sanitizePagePath(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("drops what is not a string", () => {
    for (const bad of [undefined, null, 42, {}, ["/a"]]) {
      expect(sanitizePagePath(bad)).toBeNull();
    }
  });

  it("allows 300 characters and not 301", () => {
    expect(sanitizePagePath("/" + "a".repeat(299))).not.toBeNull();
    expect(sanitizePagePath("/" + "a".repeat(300))).toBeNull();
  });
});

describe("isBugStatus", () => {
  it("accepts the four statuses and nothing else", () => {
    for (const s of BUG_STATUSES) expect(isBugStatus(s)).toBe(true);
    for (const bad of ["fixed", "DONE", "", null, undefined, 1]) {
      expect(isBugStatus(bad)).toBe(false);
    }
  });
});

describe("readTriageFilter", () => {
  it("opens on Pending and In progress", () => {
    expect(readTriageFilter("")).toBe("open");
    expect(readTriageFilter("banana")).toBe("open");
  });

  it("reads a status or all", () => {
    expect(readTriageFilter("FIXED")).toBe("FIXED");
    expect(readTriageFilter("PENDING")).toBe("PENDING");
    expect(readTriageFilter("all")).toBe("all");
  });
});
```

`src/lib/dal.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentor, platformAdmin } from "@/test/db";

const session = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (session.id ? { user: { id: session.id } } : null),
}));

// `getCurrentUser` is wrapped in React's `cache`; a fresh module per test keeps
// one test's user from answering for the next.
beforeEach(() => {
  vi.resetModules();
  session.id = null;
});

const load = () => import("@/lib/dal");

const digestOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return String((error as { digest?: string }).digest ?? error);
  }
  return "no error";
};

describe("requirePlatformAdmin", () => {
  it("lets a platform admin through", async () => {
    const boss = await platformAdmin();
    session.id = boss.id;
    const { requirePlatformAdmin } = await load();
    expect((await requirePlatformAdmin()).id).toBe(boss.id);
  });

  it("answers anybody else with not-found, not a redirect", async () => {
    const m = await mentor();
    session.id = m.id;
    const { requirePlatformAdmin } = await load();
    expect(await digestOf(requirePlatformAdmin())).toContain("404");
  });

  it("sends a signed-out request to the login page", async () => {
    const { requirePlatformAdmin } = await load();
    expect(await digestOf(requirePlatformAdmin())).toContain("NEXT_REDIRECT");
  });

  it("refuses a removed account", async () => {
    const m = await mentor();
    session.id = m.id;
    await prisma.user.delete({ where: { id: m.id } });
    const { requirePlatformAdmin } = await load();
    expect(await digestOf(requirePlatformAdmin())).toContain("NEXT_REDIRECT");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/bugs.test.ts src/lib/dal.test.ts`
Expected: FAIL — `@/lib/bugs` cannot be resolved; `requirePlatformAdmin` is not a function.

- [ ] **Step 3: Write `src/lib/bugs.ts`**

```ts
/**
 * Bug reports: the rules both sides of the form agree on.
 *
 * No `server-only` import on purpose — the report form needs the limits, the
 * same reason `lib/avatar.ts` has none. Nothing here touches the database.
 */

export const BUG_STATUS = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  FIXED: "FIXED",
  CLOSED: "CLOSED",
} as const;

export type BugStatus = (typeof BUG_STATUS)[keyof typeof BUG_STATUS];

export const BUG_STATUSES = Object.values(BUG_STATUS) as BugStatus[];

export const BUG_STATUS_LABELS: Record<BugStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  FIXED: "Fixed",
  CLOSED: "Closed",
};

/** Which `StatusChip` severity each status wears. Amber means "being worked on". */
export const BUG_STATUS_SEVERITY: Record<
  BugStatus,
  "neutral" | "ok" | "attention" | "problem"
> = {
  PENDING: "neutral",
  IN_PROGRESS: "attention",
  FIXED: "ok",
  CLOSED: "neutral",
};

export function isBugStatus(value: unknown): value is BugStatus {
  return typeof value === "string" && (BUG_STATUSES as string[]).includes(value);
}

export const BUG_TITLE_MAX = 120;
export const BUG_DESCRIPTION_MAX = 2000;
/** The public fix line when Fixed; the private note to the reporter when Closed. */
export const BUG_RESOLUTION_MAX = 300;
export const BUG_PAGE_MAX = 300;

/** Server-side ceiling on stored screenshot bytes, after the browser's resize. */
export const BUG_SHOT_MAX_BYTES = 600 * 1024;
/** Longest edge the browser scales a screenshot to. */
export const BUG_SHOT_MAX_EDGE = 1600;
export const BUG_SHOT_MIME_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
/** What the file picker offers, including formats the browser re-encodes away. */
export const BUG_SHOT_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";

/** Per person, per rolling hour. Counted in the database, never in the browser. */
export const BUG_REPORTS_PER_HOUR = 5;

/**
 * The page somebody was on, as a path — or null.
 *
 * It arrives in a query string, so it is whatever anybody typed. Only our own
 * paths survive: one leading slash, no `//` (a scheme-relative URL), no
 * backslash (browsers read `/\host` as `//host`), no control characters. The
 * query string and fragment are cut: they can carry tokens and ids, and the
 * path is what a developer needs.
 */
export function sanitizePagePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim().split(/[?#]/)[0];
  if (!path.startsWith("/") || path.length > BUG_PAGE_MAX) return null;
  if (path.includes("//") || path.includes("\\")) return null;
  if (/\p{Cc}/u.test(path)) return null;
  return path;
}

export type TriageFilter = "open" | "all" | BugStatus;

/** `?status=` on the triage page. Anything unreadable opens on the work to do. */
export function readTriageFilter(raw: string): TriageFilter {
  if (raw === "all" || isBugStatus(raw)) return raw;
  return "open";
}
```

- [ ] **Step 4: Add the gate to `src/lib/dal.ts`**

Directly after `requireProgramScope`:

```ts
/**
 * Gate the pages that triage bug reports: platform admins, nobody else.
 *
 * `notFound()` rather than a redirect, like `/settings/platform`: a page a
 * reader may not use should read exactly like one that does not exist. Call it
 * in the PAGE, not only the layout (see `requireRole`).
 */
export async function requirePlatformAdmin(): Promise<User> {
  const user = await requireUser();
  if (!user.platformAdmin) notFound();
  return user;
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/lib/bugs.test.ts src/lib/dal.test.ts`
Expected: PASS. If the dal tests see a stale user across tests, the `vi.resetModules()` in `beforeEach` is the fix — do not weaken the assertions.

- [ ] **Step 6: Lint, type-check, commit**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

```bash
git add src/lib/bugs.ts src/lib/bugs.test.ts src/lib/dal.ts src/lib/dal.test.ts
git commit -m "Bug report rules, and a gate for the people who triage them

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Read queries

**Files:**
- Create: `src/lib/bug-queries.ts`, `src/lib/bug-queries.test.ts`

**Interfaces:**
- Consumes: `bugReport`, `platformAdmin`, `mentor`, `admin` fixtures (Task 1); `BUG_STATUS`, `type BugStatus`, `type TriageFilter` (Task 2).
- Produces:
  - `myBugReports(userId: string)` → `{ id, title, status, createdAt, resolution: string | null, resolvedAt: Date | null }[]`, newest first; `resolution` is `null` unless the status is `FIXED` or `CLOSED`.
  - `fixedBugs()` → `{ resolution: string; resolvedAt: Date | null; changelogDate: string | null }[]`, newest fix first, at most 100.
  - `bugReportFor(viewer: Pick<User, "id" | "platformAdmin">, id: string)` → `null` when absent **or** not the viewer's; otherwise `{ id, title, description, pagePath, reporterRole, status, resolution, resolvedAt, changelogDate, createdAt, hasImage: boolean, reporterName: string | null }`. `reporterName` is `null` for a non-admin viewer, `"Former user"` when the reporter is gone. A non-admin viewer's `resolution` is `null` unless `FIXED`/`CLOSED`.
  - `triageList(viewer: Pick<User, "platformAdmin">, filter: TriageFilter)` → `[]` for a non-admin; otherwise `{ id, title, status, reporterRole, createdAt, reporterName: string }[]`, newest first, at most 200.

- [ ] **Step 1: Write the failing tests**

`src/lib/bug-queries.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  bugReportFor,
  fixedBugs,
  myBugReports,
  triageList,
} from "@/lib/bug-queries";
import { admin, bugReport, mentor, platformAdmin } from "@/test/db";

const SECRET = "Aziza Karimova sees a wrong total on her page";

describe("fixedBugs", () => {
  it("lists only Fixed reports, newest fix first", async () => {
    const who = await mentor();
    await bugReport({ reporterId: who.id, status: "PENDING" });
    await bugReport({ reporterId: who.id, status: "CLOSED", resolution: "can't reproduce", resolvedAt: new Date() });
    await bugReport({ reporterId: who.id, status: "FIXED", resolution: "older fix", resolvedAt: new Date("2026-09-01T00:00:00Z"), changelogDate: "2026-09-01" });
    await bugReport({ reporterId: who.id, status: "FIXED", resolution: "newer fix", resolvedAt: new Date("2026-09-20T00:00:00Z") });

    const rows = await fixedBugs();
    expect(rows.map((r) => r.resolution)).toEqual(["newer fix", "older fix"]);
    expect(rows[1].changelogDate).toBe("2026-09-01");
  });

  it("reads nothing but the fix line, its date and its changelog link", async () => {
    const who = await mentor();
    await bugReport({
      reporterId: who.id,
      title: SECRET,
      description: SECRET,
      pagePath: "/students/secret",
      status: "FIXED",
      resolution: "Totals now add up.",
      resolvedAt: new Date(),
      image: true,
    });

    const rows = await fixedBugs();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["changelogDate", "resolution", "resolvedAt"]);
    expect(JSON.stringify(rows)).not.toContain("Aziza");
    expect(JSON.stringify(rows)).not.toContain(who.email);
  });

  it("drops a report from the list when it is reopened", async () => {
    const r = await bugReport({ status: "FIXED", resolution: "fix", resolvedAt: new Date() });
    expect(await fixedBugs()).toHaveLength(1);
    await prisma.bugReport.update({ where: { id: r.id }, data: { status: "PENDING", resolvedAt: null } });
    expect(await fixedBugs()).toHaveLength(0);
  });
});

describe("myBugReports", () => {
  it("returns only the caller's reports, every status, newest first", async () => {
    const me = await mentor("Me");
    const other = await mentor("Other");
    await bugReport({ reporterId: me.id, title: "first", createdAt: new Date("2026-09-01T00:00:00Z") });
    await bugReport({ reporterId: me.id, title: "second", status: "FIXED", resolution: "done", resolvedAt: new Date(), createdAt: new Date("2026-09-02T00:00:00Z") });
    await bugReport({ reporterId: other.id, title: "not mine" });

    const rows = await myBugReports(me.id);
    expect(rows.map((r) => r.title)).toEqual(["second", "first"]);
  });

  it("hides a leftover fix line on a report that was reopened", async () => {
    const me = await mentor();
    await bugReport({ reporterId: me.id, status: "IN_PROGRESS", resolution: "old fix line" });
    const [row] = await myBugReports(me.id);
    expect(row.resolution).toBeNull();
  });

  it("shows the reporter their Closed note", async () => {
    const me = await mentor();
    await bugReport({ reporterId: me.id, status: "CLOSED", resolution: "Works as designed.", resolvedAt: new Date() });
    const [row] = await myBugReports(me.id);
    expect(row.resolution).toBe("Works as designed.");
  });
});

describe("bugReportFor", () => {
  it("gives a reporter their own report, with no reporter name", async () => {
    const me = await mentor("Me");
    const r = await bugReport({ reporterId: me.id, title: SECRET, image: true });
    const found = await bugReportFor(me, r.id);
    expect(found?.title).toBe(SECRET);
    expect(found?.hasImage).toBe(true);
    expect(found?.reporterName).toBeNull();
  });

  it("answers somebody else's report and an unknown id the same way", async () => {
    const me = await mentor("Me");
    const other = await mentor("Other");
    const r = await bugReport({ reporterId: me.id });
    expect(await bugReportFor(other, r.id)).toBeNull();
    expect(await bugReportFor(other, "no-such-id")).toBeNull();
  });

  it("gives a platform admin any report, with the reporter's name", async () => {
    const me = await mentor("Dilnoza");
    const boss = await platformAdmin();
    const r = await bugReport({ reporterId: me.id, status: "IN_PROGRESS", resolution: "earlier note" });
    const found = await bugReportFor(boss, r.id);
    expect(found?.reporterName).toBe("Dilnoza");
    expect(found?.resolution).toBe("earlier note");
  });

  it("does not make a program admin a triager", async () => {
    const me = await mentor("Me");
    const programAdmin = await admin();
    const r = await bugReport({ reporterId: me.id });
    expect(await bugReportFor(programAdmin, r.id)).toBeNull();
  });

  it("survives a reporter whose account was removed", async () => {
    const gone = await mentor("Gone");
    const boss = await platformAdmin();
    const r = await bugReport({ reporterId: gone.id });
    await prisma.user.delete({ where: { id: gone.id } });

    const found = await bugReportFor(boss, r.id);
    expect(found).not.toBeNull();
    expect(found?.reporterName).toBe("Former user");
    const [row] = await triageList(boss, "all");
    expect(row.reporterName).toBe("Former user");
  });
});

describe("triageList", () => {
  it("is empty for anybody who is not a platform admin", async () => {
    await bugReport();
    expect(await triageList(await admin(), "all")).toEqual([]);
    expect(await triageList(await mentor(), "open")).toEqual([]);
  });

  it("opens on Pending and In progress, and filters by status", async () => {
    const boss = await platformAdmin();
    await bugReport({ title: "p", status: "PENDING" });
    await bugReport({ title: "w", status: "IN_PROGRESS" });
    await bugReport({ title: "f", status: "FIXED", resolution: "x", resolvedAt: new Date() });
    await bugReport({ title: "c", status: "CLOSED", resolution: "y", resolvedAt: new Date() });

    expect((await triageList(boss, "open")).map((r) => r.title).sort()).toEqual(["p", "w"]);
    expect((await triageList(boss, "FIXED")).map((r) => r.title)).toEqual(["f"]);
    expect(await triageList(boss, "all")).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/bug-queries.test.ts`
Expected: FAIL — cannot resolve `@/lib/bug-queries`.

- [ ] **Step 3: Write the queries**

`src/lib/bug-queries.ts`:

```ts
import "server-only";

import { BUG_STATUS, type BugStatus, type TriageFilter } from "@/lib/bugs";
import { prisma } from "@/lib/prisma";
import type { User } from "@/generated/prisma/client";

/**
 * Every read of a bug report, and the only place that decides who sees what.
 *
 *   - A person reads their OWN reports in full.
 *   - Everybody reads the FIX LINE of a Fixed one — `resolution`,
 *     `resolvedAt`, `changelogDate`, and nothing else. A reporter's title and
 *     description can name a student, so `fixedBugs` does not select them.
 *   - A platform admin reads everything, with the reporter's name.
 *
 * `resolution` means two things: the public fix line when FIXED, and a note
 * private to the reporter and triagers when CLOSED. A report that was reopened
 * keeps its old line on the record, so it is masked unless the status says it
 * is current.
 */

const isResolved = (status: string) =>
  status === BUG_STATUS.FIXED || status === BUG_STATUS.CLOSED;

const reporterLabel = (
  reporter: { name: string | null; email: string } | null
): string => (reporter ? (reporter.name ?? reporter.email) : "Former user");

export async function myBugReports(userId: string) {
  const rows = await prisma.bugReport.findMany({
    where: { reporterId: userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      resolution: true,
      resolvedAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    resolution: isResolved(r.status) ? r.resolution : null,
  }));
}

export async function fixedBugs() {
  const rows = await prisma.bugReport.findMany({
    where: { status: BUG_STATUS.FIXED, resolution: { not: null } },
    orderBy: [{ resolvedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: { resolution: true, resolvedAt: true, changelogDate: true },
  });
  return rows.map((r) => ({
    resolution: r.resolution!,
    resolvedAt: r.resolvedAt,
    changelogDate: r.changelogDate,
  }));
}

/**
 * One report for one viewer — or null. "Not yours" and "does not exist" are the
 * same answer, so an id cannot be probed for whether it is real.
 */
export async function bugReportFor(
  viewer: Pick<User, "id" | "platformAdmin">,
  id: string
) {
  const row = await prisma.bugReport.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      pagePath: true,
      reporterRole: true,
      reporterId: true,
      status: true,
      resolution: true,
      resolvedAt: true,
      changelogDate: true,
      createdAt: true,
      reporter: { select: { name: true, email: true } },
      image: { select: { id: true } },
    },
  });
  if (!row) return null;
  if (!viewer.platformAdmin && row.reporterId !== viewer.id) return null;

  const { reporter, reporterId: _reporterId, image, ...rest } = row;
  void _reporterId;
  return {
    ...rest,
    resolution:
      viewer.platformAdmin || isResolved(row.status) ? row.resolution : null,
    hasImage: image !== null,
    reporterName: viewer.platformAdmin ? reporterLabel(reporter) : null,
  };
}

export async function triageList(
  viewer: Pick<User, "platformAdmin">,
  filter: TriageFilter
) {
  if (!viewer.platformAdmin) return [];

  const status: BugStatus[] = [BUG_STATUS.PENDING, BUG_STATUS.IN_PROGRESS];
  const where =
    filter === "all"
      ? {}
      : filter === "open"
        ? { status: { in: status } }
        : { status: filter };

  const rows = await prisma.bugReport.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      status: true,
      reporterRole: true,
      createdAt: true,
      reporter: { select: { name: true, email: true } },
    },
  });
  return rows.map(({ reporter, ...r }) => ({
    ...r,
    reporterName: reporterLabel(reporter),
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/bug-queries.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Lint, type-check, commit**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean (if ESLint objects to the unused `_reporterId`, restructure the destructure rather than adding a disable).

```bash
git add src/lib/bug-queries.ts src/lib/bug-queries.test.ts
git commit -m "Read bug reports so each person sees only what is theirs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Notification types and the `reportBug` action

**Files:**
- Modify: `src/lib/constants.ts` (`NOTIFICATION_TYPES`, `CATEGORY_OF`, `NOTIFICATION_META`)
- Create: `src/lib/actions/bugs.ts`, `src/lib/actions/bugs.test.ts`

**Interfaces:**
- Consumes: `bugReport`, `platformAdmin`, `mentor` fixtures and `PNG_BYTES` (Task 1); `sanitizePagePath`, limits (Task 2); `notify` (`src/lib/notify.ts`); `sniffImageType` (`src/lib/avatar.ts`).
- Produces:
  - Notification types `BUG_REPORTED`, `BUG_FIXED`, `BUG_CLOSED` (category `ACCOUNTS`).
  - `reportBug(prev: ActionState, formData: FormData): Promise<ActionState>` — fields `title`, `description`, optional `screenshot` (File), optional `from`. Success: `{ ok: true, message, receipt: { id, headline, notes: [] } }`. Failure: `{ ok: false, error, field?, values? }`.

- [ ] **Step 1: Add the notification types**

In `src/lib/constants.ts`, inside `NOTIFICATION_TYPES` (after `PEER_INTERVIEW_BOOKED`, keeping the trailing-comment style):

```ts
  BUG_REPORTED: "BUG_REPORTED", // to platform admins: somebody reported a bug
  BUG_FIXED: "BUG_FIXED", // to the reporter: their report was fixed
  BUG_CLOSED: "BUG_CLOSED", // to the reporter: their report was closed, with a note
```

In `CATEGORY_OF`, add:

```ts
  BUG_REPORTED: "ACCOUNTS",
  BUG_FIXED: "ACCOUNTS",
  BUG_CLOSED: "ACCOUNTS",
```

In `NOTIFICATION_META`, add:

```ts
  BUG_REPORTED: { label: "Bug report", tone: "brand" },
  BUG_FIXED: { label: "Bug fixed", tone: "success" },
  BUG_CLOSED: { label: "Bug closed", tone: "warning" },
```

Run `npx tsc --noEmit` — `CATEGORY_OF` is an exhaustive `Record`, so a missing entry fails here.

- [ ] **Step 2: Write the failing tests**

`src/lib/actions/bugs.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { BUG_REPORTS_PER_HOUR, BUG_SHOT_MAX_BYTES } from "@/lib/bugs";
import { bugReport, mentor, PNG_BYTES, platformAdmin } from "@/test/db";

const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { reportBug } = await import("@/lib/actions/bugs");

function form(fields: Record<string, string | File>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const png = () => new File([PNG_BYTES], "shot.png", { type: "image/png" });
const valid = { title: "Totals are wrong", description: "I logged 4h and it says 3h." };

describe("reportBug", () => {
  it("saves the report, snapshots the role, and tells every platform admin", async () => {
    const me = await mentor("Dilnoza");
    const boss = await platformAdmin();
    const second = await platformAdmin("Second Boss");
    actor.value = me;

    const state = await reportBug(null, form({ ...valid, title: "  Totals are wrong  ", from: "/mentors/abc?x=1" }));

    if (!state?.ok) throw new Error("expected success");
    const row = await prisma.bugReport.findUniqueOrThrow({ where: { id: state.receipt!.id } });
    expect(row).toMatchObject({
      reporterId: me.id,
      reporterRole: "MENTOR",
      title: "Totals are wrong",
      description: valid.description,
      pagePath: "/mentors/abc",
      status: "PENDING",
    });

    const notes = await prisma.notification.findMany({ where: { type: "BUG_REPORTED" } });
    expect(notes.map((n) => n.userId).sort()).toEqual([boss.id, second.id].sort());
    expect(notes[0].href).toBe(`/bugs/${row.id}`);
    expect(notes.some((n) => n.userId === me.id)).toBe(false);
  });

  it("does not notify a platform admin about their own report", async () => {
    const boss = await platformAdmin();
    actor.value = boss;
    await reportBug(null, form(valid));
    expect(await prisma.notification.count()).toBe(0);
  });

  it("refuses a missing or overlong title and description, saving nothing", async () => {
    actor.value = await mentor();
    const cases: [Record<string, string>, string][] = [
      [{ title: "  ", description: "x" }, "title"],
      [{ title: "t".repeat(121), description: "x" }, "title"],
      [{ title: "t", description: "" }, "description"],
      [{ title: "t", description: "d".repeat(2001) }, "description"],
    ];
    for (const [fields, field] of cases) {
      const state = await reportBug(null, form(fields));
      expect(state).toMatchObject({ ok: false, field });
    }
    expect(await prisma.bugReport.count()).toBe(0);
  });

  it("hands back what was typed so a failed form can refill", async () => {
    actor.value = await mentor();
    const state = await reportBug(null, form({ title: "kept", description: "" }));
    expect(state).toMatchObject({ ok: false, values: { title: "kept" } });
  });

  it("refuses when signed out", async () => {
    actor.value = null;
    expect(await reportBug(null, form(valid))).toMatchObject({ ok: false });
    expect(await prisma.bugReport.count()).toBe(0);
  });

  it("drops a page that is not one of our own paths and still saves the report", async () => {
    actor.value = await mentor();
    for (const from of ["https://evil.com", "//evil.com", "/\\evil.com", "/" + "a".repeat(300)]) {
      const state = await reportBug(null, form({ ...valid, from }));
      expect(state?.ok, from).toBe(true);
    }
    const rows = await prisma.bugReport.findMany();
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.pagePath === null)).toBe(true);
  });

  describe("screenshot", () => {
    it("stores a real image", async () => {
      actor.value = await mentor();
      const state = await reportBug(null, form({ ...valid, screenshot: png() }));
      if (!state?.ok) throw new Error("expected success");
      const image = await prisma.bugReportImage.findUniqueOrThrow({ where: { reportId: state.receipt!.id } });
      expect(image.mimeType).toBe("image/png");
    });

    it("stores no image row when none was attached", async () => {
      actor.value = await mentor();
      await reportBug(null, form(valid));
      expect(await prisma.bugReportImage.count()).toBe(0);
    });

    it("refuses a file labelled image/png whose bytes are HTML, saving nothing", async () => {
      actor.value = await mentor();
      const fake = new File(["<script>alert(1)</script>"], "x.png", { type: "image/png" });
      const state = await reportBug(null, form({ ...valid, screenshot: fake }));
      expect(state).toMatchObject({ ok: false });
      expect(await prisma.bugReport.count()).toBe(0);
      expect(await prisma.bugReportImage.count()).toBe(0);
    });

    it("refuses a screenshot over the size cap", async () => {
      actor.value = await mentor();
      const big = new Uint8Array(BUG_SHOT_MAX_BYTES + 1);
      big.set(PNG_BYTES);
      const state = await reportBug(null, form({ ...valid, screenshot: new File([big], "big.png", { type: "image/png" }) }));
      expect(state).toMatchObject({ ok: false });
      expect(await prisma.bugReport.count()).toBe(0);
    });
  });

  describe("the hourly cap", () => {
    it("refuses the sixth report in an hour", async () => {
      actor.value = await mentor();
      for (let i = 0; i < BUG_REPORTS_PER_HOUR; i++) {
        expect((await reportBug(null, form(valid)))?.ok).toBe(true);
      }
      const sixth = await reportBug(null, form({ title: "one more", description: "x" }));
      expect(sixth).toMatchObject({ ok: false });
      expect(await prisma.bugReport.count()).toBe(BUG_REPORTS_PER_HOUR);
    });

    it("does not count reports older than an hour, or anybody else's", async () => {
      const me = await mentor("Me");
      const other = await mentor("Other");
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      for (let i = 0; i < BUG_REPORTS_PER_HOUR; i++) {
        await bugReport({ reporterId: me.id, createdAt: twoHoursAgo });
        await bugReport({ reporterId: other.id });
      }
      actor.value = me;
      expect((await reportBug(null, form(valid)))?.ok).toBe(true);
    });

    it("cannot be beaten by sending them all at once", async () => {
      actor.value = await mentor();
      const results = await Promise.all(
        Array.from({ length: BUG_REPORTS_PER_HOUR + 2 }, () => reportBug(null, form(valid)))
      );
      expect(results.filter((r) => r?.ok)).toHaveLength(BUG_REPORTS_PER_HOUR);
      expect(await prisma.bugReport.count()).toBe(BUG_REPORTS_PER_HOUR);
    });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/lib/actions/bugs.test.ts`
Expected: FAIL — cannot resolve `@/lib/actions/bugs`.

- [ ] **Step 4: Write the action**

`src/lib/actions/bugs.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/lib/actions/shared";
import { sniffImageType } from "@/lib/avatar";
import {
  BUG_DESCRIPTION_MAX,
  BUG_REPORTS_PER_HOUR,
  BUG_SHOT_MAX_BYTES,
  BUG_SHOT_MIME_TYPES,
  BUG_TITLE_MAX,
  sanitizePagePath,
} from "@/lib/bugs";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

const HOUR = 60 * 60 * 1000;

/**
 * Report a bug.
 *
 * Reachable directly, so everything is re-derived here: the lengths, the
 * screenshot's real format (never the upload's claimed type — these bytes are
 * served back to browsers), and the page, which is whatever a query string said.
 * A rejected screenshot saves nothing: a report that lost its picture silently
 * is worse than one that asks again.
 */
export async function reportBug(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const values = {
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
  };
  const title = values.title.trim();
  const description = values.description.trim();

  if (!title) {
    return { ok: false, field: "title", values, error: "Give the report a short title." };
  }
  if (title.length > BUG_TITLE_MAX) {
    return { ok: false, field: "title", values, error: `Keep the title under ${BUG_TITLE_MAX} characters.` };
  }
  if (!description) {
    return { ok: false, field: "description", values, error: "Say what went wrong." };
  }
  if (description.length > BUG_DESCRIPTION_MAX) {
    return { ok: false, field: "description", values, error: `Keep the description under ${BUG_DESCRIPTION_MAX} characters.` };
  }

  let screenshot: Prisma.BugReportImageCreateWithoutReportInput | null = null;
  const file = formData.get("screenshot");
  if (file instanceof File && file.size > 0) {
    if (file.size > BUG_SHOT_MAX_BYTES) {
      return { ok: false, values, error: `That screenshot is too large (${Math.round(BUG_SHOT_MAX_BYTES / 1024)}KB max).` };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = sniffImageType(bytes);
    if (!mimeType || !BUG_SHOT_MIME_TYPES.includes(mimeType as (typeof BUG_SHOT_MIME_TYPES)[number])) {
      return { ok: false, values, error: "That file isn't a PNG, JPEG, or WebP image." };
    }
    screenshot = { bytes, mimeType };
  }

  const pagePath = sanitizePagePath(formData.get("from"));
  const since = new Date(Date.now() - HOUR);

  // Counted and written in one transaction, so seven clicks at once cannot all
  // read "four so far".
  const created = await prisma.$transaction(async (tx) => {
    const recent = await tx.bugReport.count({
      where: { reporterId: actor.id, createdAt: { gte: since } },
    });
    if (recent >= BUG_REPORTS_PER_HOUR) return null;
    return tx.bugReport.create({
      data: {
        reporterId: actor.id,
        reporterRole: actor.role,
        title,
        description,
        pagePath,
        ...(screenshot ? { image: { create: screenshot } } : {}),
      },
      select: { id: true },
    });
  });

  if (!created) {
    return {
      ok: false,
      values,
      error: `You have sent ${BUG_REPORTS_PER_HOUR} reports in the last hour. Please try again a little later.`,
    };
  }

  const admins = await prisma.user.findMany({
    where: { platformAdmin: true },
    select: { id: true },
  });
  await notify(prisma, {
    to: admins.map((a) => a.id),
    type: NOTIFICATION_TYPES.BUG_REPORTED,
    message: `Bug report: ${title}`,
    href: `/bugs/${created.id}`,
    actorId: actor.id,
  });

  revalidatePath("/bugs", "layout");
  return {
    ok: true,
    message: "Thanks — we have it.",
    receipt: { id: created.id, headline: "Report sent.", notes: [] },
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/actions/bugs.test.ts`
Expected: PASS. If the concurrent test is flaky (the database lets two transactions both read "four"), the cap is not safe: fix the action (for example, create the row first and delete it when the count is over the cap, inside the same transaction) — do not loosen the test.

- [ ] **Step 6: Lint, type-check, full suite, commit**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: clean; suite green.

```bash
git add src/lib/constants.ts src/lib/actions/bugs.ts src/lib/actions/bugs.test.ts
git commit -m "Let people report a bug, with a screenshot, and tell the people who triage

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The `setBugStatus` action

**Files:**
- Modify: `src/lib/changelog.ts` (export `isRealDay`)
- Modify: `src/lib/actions/bugs.ts` (add `setBugStatus`)
- Create: `src/lib/actions/bug-status.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4. `isRealDay(day: string): boolean` from `src/lib/changelog.ts`; `toDateInputValue` from `src/lib/format.ts`.
- Produces: `setBugStatus(prev: ActionState, formData: FormData): Promise<ActionState>` — fields `id`, `status`, `resolution`, `changelogDate`. Platform admins only; re-checked inside.

- [ ] **Step 1: Write the failing tests**

`src/lib/actions/bug-status.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { fixedBugs } from "@/lib/bug-queries";
import { admin, bugReport, mentor, platformAdmin } from "@/test/db";

const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { setBugStatus } = await import("@/lib/actions/bugs");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const reload = (id: string) => prisma.bugReport.findUniqueOrThrow({ where: { id } });

describe("setBugStatus", () => {
  it("refuses everybody who is not a platform admin, even the reporter", async () => {
    const me = await mentor("Reporter");
    const r = await bugReport({ reporterId: me.id });
    for (const who of [me, await admin(), null]) {
      actor.value = who;
      const state = await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "x" }));
      expect(state).toMatchObject({ ok: false });
    }
    expect((await reload(r.id)).status).toBe("PENDING");
  });

  it("refuses a status that is not one of the four", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport();
    expect(await setBugStatus(null, form({ id: r.id, status: "DONE" }))).toMatchObject({ ok: false });
    expect((await reload(r.id)).status).toBe("PENDING");
  });

  it("refuses an unknown report", async () => {
    actor.value = await platformAdmin();
    expect(await setBugStatus(null, form({ id: "nope", status: "IN_PROGRESS" }))).toMatchObject({ ok: false });
  });

  it("moves a report to In progress without asking for words", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport();
    expect(await setBugStatus(null, form({ id: r.id, status: "IN_PROGRESS" }))).toMatchObject({ ok: true });
    const row = await reload(r.id);
    expect(row.status).toBe("IN_PROGRESS");
    expect(row.resolvedAt).toBeNull();
  });

  it("will not mark a report Fixed without a fix line, and leaves it as it was", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport();
    for (const resolution of ["", "   "]) {
      expect(await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution }))).toMatchObject({ ok: false, field: "resolution" });
    }
    expect((await reload(r.id)).status).toBe("PENDING");
  });

  it("will not take a fix line over 300 characters", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport();
    expect(await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "x".repeat(301) }))).toMatchObject({ ok: false });
    expect((await reload(r.id)).status).toBe("PENDING");
  });

  it("marks a report Fixed, stamps it, and puts the line on the public list", async () => {
    const boss = await platformAdmin();
    actor.value = boss;
    const r = await bugReport();

    const state = await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "  Totals now add up.  ", changelogDate: "2026-10-01" }));
    expect(state).toMatchObject({ ok: true });

    const row = await reload(r.id);
    expect(row).toMatchObject({ status: "FIXED", resolution: "Totals now add up.", changelogDate: "2026-10-01", triagedById: boss.id });
    expect(row.resolvedAt).not.toBeNull();
    expect((await fixedBugs()).map((f) => f.resolution)).toEqual(["Totals now add up."]);
  });

  it("dates a fix today when no day is given, and refuses a day that is not one", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport();
    expect(await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "x", changelogDate: "2026-02-31" }))).toMatchObject({ ok: false, field: "changelogDate" });
    expect(await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "x", changelogDate: "tomorrow" }))).toMatchObject({ ok: false });
    expect((await reload(r.id)).status).toBe("PENDING");

    expect(await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "x" }))).toMatchObject({ ok: true });
    expect((await reload(r.id)).changelogDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("closes only with a note, keeps it off the public list, and sets no changelog day", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport();
    expect(await setBugStatus(null, form({ id: r.id, status: "CLOSED", resolution: "" }))).toMatchObject({ ok: false, field: "resolution" });

    expect(await setBugStatus(null, form({ id: r.id, status: "CLOSED", resolution: "Works as designed.", changelogDate: "2026-10-01" }))).toMatchObject({ ok: true });
    const row = await reload(r.id);
    expect(row).toMatchObject({ status: "CLOSED", resolution: "Works as designed.", changelogDate: null });
    expect(await fixedBugs()).toEqual([]);
  });

  it("reopens a report: off the public list, dates cleared, the old line kept", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport({ status: "FIXED", resolution: "old fix", resolvedAt: new Date(), changelogDate: "2026-10-01" });

    expect(await setBugStatus(null, form({ id: r.id, status: "PENDING" }))).toMatchObject({ ok: true });
    const row = await reload(r.id);
    expect(row).toMatchObject({ status: "PENDING", resolvedAt: null, changelogDate: null, resolution: "old fix" });
    expect(await fixedBugs()).toEqual([]);
  });

  describe("notifications", () => {
    it("tells the reporter when it is fixed, with a link", async () => {
      const me = await mentor("Reporter");
      actor.value = await platformAdmin();
      const r = await bugReport({ reporterId: me.id });
      await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "Totals now add up." }));

      const notes = await prisma.notification.findMany({ where: { userId: me.id } });
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ type: "BUG_FIXED", href: `/bugs/${r.id}` });
      expect(notes[0].message).toContain("Totals now add up.");
    });

    it("tells the reporter when it is closed, with the note", async () => {
      const me = await mentor("Reporter");
      actor.value = await platformAdmin();
      const r = await bugReport({ reporterId: me.id, title: "Odd total" });
      await setBugStatus(null, form({ id: r.id, status: "CLOSED", resolution: "Works as designed." }));

      const [note] = await prisma.notification.findMany({ where: { userId: me.id } });
      expect(note.type).toBe("BUG_CLOSED");
      expect(note.message).toContain("Odd total");
      expect(note.message).toContain("Works as designed.");
    });

    it("stays quiet for In progress, for a reopen, for an edit to the same status, and for a removed reporter", async () => {
      const me = await mentor("Reporter");
      actor.value = await platformAdmin();
      const r = await bugReport({ reporterId: me.id });
      await setBugStatus(null, form({ id: r.id, status: "IN_PROGRESS" }));
      await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "first line" }));
      expect(await prisma.notification.count({ where: { userId: me.id } })).toBe(1);

      await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "reworded line" }));
      await setBugStatus(null, form({ id: r.id, status: "PENDING" }));
      expect(await prisma.notification.count({ where: { userId: me.id } })).toBe(1);

      const orphan = await bugReport({ reporterId: null });
      await setBugStatus(null, form({ id: orphan.id, status: "FIXED", resolution: "x" }));
      expect(await prisma.notification.count()).toBe(1);
    });

    it("does not notify a platform admin about their own report", async () => {
      const boss = await platformAdmin();
      actor.value = boss;
      const r = await bugReport({ reporterId: boss.id });
      await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "x" }));
      expect(await prisma.notification.count()).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/actions/bug-status.test.ts`
Expected: FAIL — `setBugStatus` is not a function.

- [ ] **Step 3: Export `isRealDay`**

In `src/lib/changelog.ts`, change `function isRealDay(day: string): boolean {` to `export function isRealDay(day: string): boolean {`.

- [ ] **Step 4: Add the action**

In `src/lib/actions/bugs.ts`, extend the imports:

```ts
import { isRealDay } from "@/lib/changelog";
import { toDateInputValue } from "@/lib/format";
```

and add `BUG_RESOLUTION_MAX`, `BUG_STATUS`, `isBugStatus` to the existing `@/lib/bugs` import. Then append:

```ts
/**
 * Triage: set a report's status, and say what happened.
 *
 * Platform admins only, and checked HERE — the page that renders the form
 * hides it from everybody else, but a server action is a public endpoint.
 *
 * Fixed and Closed both need words, because both end up in front of somebody:
 * the fix line is read by every user, the note by the person who reported it.
 * A report that was reopened keeps its old line on the record and loses its
 * dates, so it leaves the public list without anything being deleted.
 */
export async function setBugStatus(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };
  if (!actor.platformAdmin) {
    return { ok: false, error: "Only platform admins can change a report's status." };
  }

  const id = String(formData.get("id") ?? "");
  const status = formData.get("status");
  if (!isBugStatus(status)) return { ok: false, error: "Choose a status." };

  const resolution = String(formData.get("resolution") ?? "").trim();
  if (resolution.length > BUG_RESOLUTION_MAX) {
    return { ok: false, field: "resolution", error: `Keep it under ${BUG_RESOLUTION_MAX} characters.` };
  }

  const closing = status === BUG_STATUS.FIXED || status === BUG_STATUS.CLOSED;
  if (closing && !resolution) {
    return {
      ok: false,
      field: "resolution",
      error:
        status === BUG_STATUS.FIXED
          ? "Write the fix line everyone will read."
          : "Write a note to the person who reported it.",
    };
  }

  let changelogDate: string | null = null;
  if (status === BUG_STATUS.FIXED) {
    changelogDate = String(formData.get("changelogDate") ?? "").trim() || toDateInputValue(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(changelogDate) || !isRealDay(changelogDate)) {
      return { ok: false, field: "changelogDate", error: "Choose a real date." };
    }
  }

  const before = await prisma.bugReport.findUnique({
    where: { id },
    select: { status: true, title: true, reporterId: true },
  });
  if (!before) return { ok: false, error: "That report doesn't exist." };

  await prisma.bugReport.update({
    where: { id },
    data: {
      status,
      triagedById: actor.id,
      ...(closing
        ? { resolution, resolvedAt: new Date(), changelogDate }
        : { resolvedAt: null, changelogDate: null }),
    },
  });

  // On the way INTO Fixed or Closed only: rewording a fix line is not news.
  if (closing && before.status !== status && before.reporterId) {
    await notify(prisma, {
      to: [before.reporterId],
      type:
        status === BUG_STATUS.FIXED
          ? NOTIFICATION_TYPES.BUG_FIXED
          : NOTIFICATION_TYPES.BUG_CLOSED,
      message:
        status === BUG_STATUS.FIXED
          ? `Fixed: ${resolution}`
          : `Your report "${before.title}" was closed: ${resolution}`,
      href: `/bugs/${id}`,
      actorId: actor.id,
    });
  }

  revalidatePath("/bugs", "layout");
  return { ok: true, message: "Saved." };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/actions/bug-status.test.ts src/lib/actions/bugs.test.ts src/lib/changelog.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint, type-check, full suite, commit**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: clean; suite green.

```bash
git add src/lib/changelog.ts src/lib/actions/bugs.ts src/lib/actions/bug-status.test.ts
git commit -m "Let platform admins move a bug report along and write the fix line

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The screenshot route

**Files:**
- Create: `src/app/api/bug-report/[id]/image/route.ts`, `src/app/api/bug-report/[id]/image/route.test.ts`

**Interfaces:**
- Consumes: Task 1 fixtures; `getCurrentUser` from `@/lib/dal`.
- Produces: `GET /api/bug-report/:id/image` — 401 signed out; 404 for an unknown report, a report with no image, **or somebody else's report**; 200 with the stored bytes for the reporter or a platform admin.

- [ ] **Step 1: Write the failing tests**

`src/app/api/bug-report/[id]/image/route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { bugReport, mentor, platformAdmin } from "@/test/db";

const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/bug-report/[id]/image/route");

const get = (id: string) =>
  GET(new Request(`http://localhost/api/bug-report/${id}/image`), {
    params: Promise.resolve({ id }),
  });

describe("GET /api/bug-report/[id]/image", () => {
  it("is 401 when signed out", async () => {
    const r = await bugReport({ image: true });
    actor.value = null;
    expect((await get(r.id)).status).toBe(401);
  });

  it("serves the reporter their own screenshot, with safe headers", async () => {
    const me = await mentor();
    const r = await bugReport({ reporterId: me.id, image: true });
    actor.value = me;

    const res = await get(r.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toContain("private");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("serves a platform admin any screenshot", async () => {
    const me = await mentor();
    const r = await bugReport({ reporterId: me.id, image: true });
    actor.value = await platformAdmin();
    expect((await get(r.id)).status).toBe(200);
  });

  it("answers somebody else, an unknown id, and a report with no image identically", async () => {
    const me = await mentor("Me");
    const other = await mentor("Other");
    const withImage = await bugReport({ reporterId: me.id, image: true });
    const without = await bugReport({ reporterId: me.id });

    actor.value = other;
    const stranger = await get(withImage.id);
    actor.value = me;
    const noImage = await get(without.id);
    const unknown = await get("no-such-id");

    for (const res of [stranger, noImage, unknown]) {
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run "src/app/api/bug-report"`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the route**

`src/app/api/bug-report/[id]/image/route.ts`:

```ts
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the session and the database on every request; never prerender.
export const dynamic = "force-dynamic";

/**
 * Serve one report's screenshot — to the person who reported it and to platform
 * admins, and to nobody else.
 *
 * Unlike an avatar, a screenshot can show anything on somebody's screen, so
 * "signed in" is not enough. Somebody else's report, a report with no picture
 * and an id that does not exist all answer 404 with the same body, so the route
 * cannot be used to find out which reports exist.
 *
 * The stored type was sniffed from the bytes on upload; `nosniff` and a
 * locked-down CSP keep a browser from second-guessing it into something that
 * runs.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const viewer = await getCurrentUser();
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const image = await prisma.bugReportImage.findUnique({
    where: { reportId: id },
    select: {
      bytes: true,
      mimeType: true,
      report: { select: { reporterId: true } },
    },
  });
  if (!image || (!viewer.platformAdmin && image.report.reporterId !== viewer.id)) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(image.bytes, {
    headers: {
      "Content-Type": image.mimeType,
      "Content-Length": String(image.bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run "src/app/api/bug-report"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Lint, type-check, commit**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

```bash
git add "src/app/api/bug-report"
git commit -m "Serve a bug report's screenshot to the people allowed to see it

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `/bugs` and the report form

**Files:**
- Create: `src/app/bugs/layout.tsx`, `src/app/bugs/loading.tsx`, `src/app/bugs/page.tsx`, `src/app/bugs/page.test.ts`
- Create: `src/app/bugs/new/page.tsx`, `src/app/bugs/new/page.test.ts`
- Create: `src/components/forms/bug-report-form.tsx`

**Interfaces:**
- Consumes: `requireUser`; `myBugReports`, `fixedBugs` (Task 3); `reportBug` (Task 4); `sanitizePagePath`, `BUG_*` (Task 2); `readParam`, `type SearchParams` from `@/lib/filters`.
- Produces: routes `/bugs`, `/bugs/new` (accepts `?from=<path>`); component `ReportBugForm({ from }: { from: string | null })`.

- [ ] **Step 1: Write the failing page tests**

`src/app/bugs/page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const session = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@/lib/dal", () => ({
  requireUser: async () => {
    calls.push("gate");
    if (!session.signedIn) throw new Error("redirect:/login");
    return { id: "u1", platformAdmin: false };
  },
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/bug-queries", () => ({
  myBugReports: async () => {
    calls.push("mine");
    return [];
  },
  fixedBugs: async () => {
    calls.push("fixed");
    return [];
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { default: BugsPage } = await import("@/app/bugs/page");

beforeEach(() => {
  calls.length = 0;
  session.signedIn = true;
});

describe("/bugs", () => {
  it("gates before it reads anything", async () => {
    await BugsPage();
    expect(calls[0]).toBe("gate");
    expect(calls.slice(1).sort()).toEqual(["fixed", "mine"]);
  });

  it("reads nothing for a signed-out request", async () => {
    session.signedIn = false;
    await expect(BugsPage()).rejects.toThrow("redirect:/login");
    expect(calls).toEqual(["gate"]);
  });
});
```

`src/app/bugs/new/page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const session = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@/lib/dal", () => ({
  requireUser: async () => {
    calls.push("gate");
    if (!session.signedIn) throw new Error("redirect:/login");
    return { id: "u1" };
  },
  getCurrentUser: async () => null,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { default: NewBugPage } = await import("@/app/bugs/new/page");

beforeEach(() => {
  calls.length = 0;
  session.signedIn = true;
});

describe("/bugs/new", () => {
  it("gates first, then reads the page it was opened from", async () => {
    const element = await NewBugPage({ searchParams: Promise.resolve({ from: "/mentors/abc?x=1" }) });
    expect(calls).toEqual(["gate"]);
    expect(JSON.stringify(element)).toContain("/mentors/abc");
    expect(JSON.stringify(element)).not.toContain("x=1");
  });

  it("drops a page that is not one of ours", async () => {
    const element = await NewBugPage({ searchParams: Promise.resolve({ from: "https://evil.com" }) });
    expect(JSON.stringify(element)).not.toContain("evil.com");
  });

  it("is closed to a signed-out request", async () => {
    session.signedIn = false;
    await expect(NewBugPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/bugs`
Expected: FAIL — the pages do not exist.

- [ ] **Step 3: Layout and loading**

`src/app/bugs/layout.tsx`:

```tsx
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/dal";

// Authenticated, per-user, and reads the database on every request.
export const dynamic = "force-dynamic";

export default async function BugsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
```

`src/app/bugs/loading.tsx`:

```tsx
import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton />;
}
```

- [ ] **Step 4: The report form**

`src/components/forms/bug-report-form.tsx`:

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { reportBug } from "@/lib/actions/bugs";
import {
  BUG_DESCRIPTION_MAX,
  BUG_SHOT_ACCEPT,
  BUG_SHOT_MAX_BYTES,
  BUG_SHOT_MAX_EDGE,
  BUG_TITLE_MAX,
} from "@/lib/bugs";

/**
 * Scale a screenshot down and re-encode it as WebP in the browser, as avatars
 * are, so a retina capture becomes a few hundred KB before it touches the
 * network — under the 1MB server-action body limit — and no native image
 * dependency is needed on the server. Each failed attempt shrinks it further.
 *
 * The server re-checks size and format; this is a convenience, not a guarantee.
 */
async function toScreenshot(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    let scale = Math.min(1, BUG_SHOT_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 4; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser can't process images.");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const encode = (type: string) =>
        new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.8));
      const blob = (await encode("image/webp")) ?? (await encode("image/jpeg"));
      if (blob && blob.size <= BUG_SHOT_MAX_BYTES) return blob;
      scale *= 0.7;
    }
    throw new Error("That image is too large to attach.");
  } finally {
    bitmap.close();
  }
}

/**
 * Report a bug: what went wrong, and optionally a picture of it. The page the
 * reader came from rides along as a hidden field — the server decides whether
 * it is one of ours.
 */
export function ReportBugForm({ from }: { from: string | null }) {
  const router = useRouter();
  const [state, action] = useActionState(reportBug, null);
  const [shot, setShot] = useState<Blob | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok && state.receipt) router.push(`/bugs/${state.receipt.id}`);
  }, [state, router]);

  async function pick(file: File | undefined) {
    setShotError(null);
    setShot(null);
    if (!file) return;
    try {
      setShot(await toScreenshot(file));
    } catch (error) {
      setShotError(error instanceof Error ? error.message : "That image couldn't be attached.");
    }
  }

  // The resized blob goes in here, not the picker's raw file: the picker has no
  // `name`, so nothing it holds is submitted.
  function submit(data: FormData) {
    data.delete("screenshot");
    if (shot) data.set("screenshot", shot, "screenshot.webp");
    return action(data);
  }

  const failed = state && !state.ok ? state : null;
  const fieldError = (name: string) => (failed?.field === name ? failed.error : undefined);

  return (
    <form action={submit} className="space-y-4 rounded-xl bg-surface p-4 shadow-sm sm:p-5">
      <input type="hidden" name="from" value={from ?? ""} />

      <Field label="What went wrong?" required error={fieldError("title")} hint="A few words.">
        <Input
          name="title"
          required
          maxLength={BUG_TITLE_MAX}
          defaultValue={failed?.values?.title ?? ""}
        />
      </Field>

      <Field
        label="Tell us more"
        required
        error={fieldError("description")}
        hint="What you did, what you expected, and what happened instead."
      >
        <Textarea
          name="description"
          required
          rows={6}
          maxLength={BUG_DESCRIPTION_MAX}
          defaultValue={failed?.values?.description ?? ""}
        />
      </Field>

      <Field label="Screenshot" error={shotError ?? undefined} hint="Optional. Avoid anything private.">
        <input
          type="file"
          accept={BUG_SHOT_ACCEPT}
          onChange={(event) => void pick(event.target.files?.[0])}
          className="block w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-fill file:px-4 file:text-sm file:font-medium file:text-ink"
        />
      </Field>

      {failed && !failed.field && (
        <p role="alert" className="text-sm text-danger-ink">
          {failed.error}
        </p>
      )}

      <SubmitButton pendingText="Sending…">Send report</SubmitButton>
    </form>
  );
}
```

- [ ] **Step 5: `/bugs/new`**

`src/app/bugs/new/page.tsx`:

```tsx
import { ReportBugForm } from "@/components/forms/bug-report-form";
import { PageTitle } from "@/components/ui/section";
import { sanitizePagePath } from "@/lib/bugs";
import { requireUser } from "@/lib/dal";
import { readParam, type SearchParams } from "@/lib/filters";

export default async function NewBugPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const from = sanitizePagePath(readParam(await searchParams, "from"));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle
        backHref="/bugs"
        backLabel="Bug reports"
        title="Report a bug"
        subtitle="Only you and the people fixing it can read your report."
      />
      <ReportBugForm from={from} />
    </div>
  );
}
```

- [ ] **Step 6: `/bugs`**

`src/app/bugs/page.tsx`:

```tsx
import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLink } from "@/components/ui/link";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { fixedBugs, myBugReports } from "@/lib/bug-queries";
import {
  BUG_STATUS_LABELS,
  BUG_STATUS_SEVERITY,
  isBugStatus,
} from "@/lib/bugs";
import { requireUser } from "@/lib/dal";
import { formatDate } from "@/lib/format";

/**
 * Two lists with different readers' rights.
 *
 * "Your reports" is yours alone, in your own words. "Fixed" is everybody's, and
 * is the fix line only — the reporter's wording can name a student, so it is not
 * on this page and the query behind it does not select it.
 */
export default async function BugsPage() {
  const user = await requireUser();
  const [mine, fixed] = await Promise.all([myBugReports(user.id), fixedBugs()]);

  return (
    <div className="space-y-4">
      <PageTitle
        title="Bug reports"
        subtitle="What you have reported, and what we have fixed."
        actions={
          <div className="flex items-center gap-3">
            {user.platformAdmin && <ArrowLink href="/bugs/triage">Triage</ArrowLink>}
            <Link href="/bugs/new" className={buttonClasses()}>
              Report a bug
            </Link>
          </div>
        }
      />

      <Section title="Your reports" count={mine.length}>
        {mine.length === 0 ? (
          <EmptyState framed={false} title="No reports yet">
            Use Report a bug when something looks wrong.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <Link href={`/bugs/${r.id}`} className="font-medium text-ink hover:underline">
                    {r.title}
                  </Link>
                  <p className="text-[0.8125rem] text-muted-fg">Sent {formatDate(r.createdAt)}</p>
                </div>
                {isBugStatus(r.status) && (
                  <StatusChip severity={BUG_STATUS_SEVERITY[r.status]}>
                    {BUG_STATUS_LABELS[r.status]}
                  </StatusChip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Fixed" count={fixed.length}>
        {fixed.length === 0 ? (
          <EmptyState framed={false} title="Nothing fixed yet">
            Fixes are posted as they ship.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {fixed.map((f, i) => (
              <li key={i} className="space-y-1 px-4 py-3 sm:px-5">
                <p className="text-[0.9375rem] text-ink">{f.resolution}</p>
                <p className="text-[0.8125rem] text-muted-fg">
                  {f.resolvedAt ? formatDate(f.resolvedAt) : null}
                  {f.changelogDate && (
                    <>
                      {f.resolvedAt ? " · " : null}
                      <Link href={`/changelog#${f.changelogDate}`} className="text-brand hover:underline">
                        In the changelog
                      </Link>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
```

- [ ] **Step 7: Run to verify the page tests pass, then lint and type-check**

Run: `npx vitest run src/app/bugs && npm run lint && npx tsc --noEmit`
Expected: PASS and clean. If `buttonClasses()` needs arguments, pass `("primary", "md")`. If a component import fails under node in a page test, mock that component in the test rather than changing it. Fix any colour, spacing or copy-lint complaint using tokens already used elsewhere.

- [ ] **Step 8: Commit**

```bash
git add src/app/bugs src/components/forms/bug-report-form.tsx
git commit -m "Add the bug reports page and the form to file one

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: One report, and the triage page

**Files:**
- Create: `src/app/bugs/[id]/page.tsx`, `src/app/bugs/[id]/page.test.ts`
- Create: `src/app/bugs/triage/page.tsx`, `src/app/bugs/triage/page.test.ts`
- Create: `src/components/forms/bug-triage-form.tsx`

**Interfaces:**
- Consumes: `requireUser`, `requirePlatformAdmin` (Task 2); `bugReportFor`, `triageList` (Task 3); `setBugStatus` (Task 5); `readTriageFilter`, `BUG_*` (Task 2).
- Produces: routes `/bugs/[id]` and `/bugs/triage`; component `BugTriageForm({ id, status, resolution, changelogDate })`.

- [ ] **Step 1: Write the failing page tests**

`src/app/bugs/[id]/page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({ signedIn: true, report: null as null | Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@/lib/dal", () => ({
  requireUser: async () => {
    calls.push("gate");
    if (!state.signedIn) throw new Error("redirect:/login");
    return { id: "u1", platformAdmin: false };
  },
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/bug-queries", () => ({
  bugReportFor: async () => {
    calls.push("read");
    return state.report;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { default: BugPage } = await import("@/app/bugs/[id]/page");
const props = { params: Promise.resolve({ id: "r1" }) };

beforeEach(() => {
  calls.length = 0;
  state.signedIn = true;
  state.report = null;
});

describe("/bugs/[id]", () => {
  it("gates before it reads the report", async () => {
    state.report = {
      id: "r1", title: "t", description: "d", pagePath: null, reporterRole: "STUDENT",
      status: "PENDING", resolution: null, resolvedAt: null, changelogDate: null,
      createdAt: new Date(), hasImage: false, reporterName: null,
    };
    await BugPage(props);
    expect(calls).toEqual(["gate", "read"]);
  });

  it("reads nothing for a signed-out request", async () => {
    state.signedIn = false;
    await expect(BugPage(props)).rejects.toThrow("redirect:/login");
    expect(calls).toEqual(["gate"]);
  });

  it("is not-found when the viewer may not have it, whatever the reason", async () => {
    state.report = null;
    await expect(BugPage(props)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
```

`src/app/bugs/triage/page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const session = vi.hoisted(() => ({ admin: true }));

vi.mock("@/lib/dal", () => ({
  requirePlatformAdmin: async () => {
    calls.push("gate");
    if (!session.admin) throw new Error("NEXT_NOT_FOUND");
    return { id: "boss", platformAdmin: true };
  },
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/bug-queries", () => ({
  triageList: async () => {
    calls.push("read");
    return [];
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { default: TriagePage } = await import("@/app/bugs/triage/page");

beforeEach(() => {
  calls.length = 0;
  session.admin = true;
});

describe("/bugs/triage", () => {
  it("gates before it reads the list", async () => {
    await TriagePage({ searchParams: Promise.resolve({}) });
    expect(calls).toEqual(["gate", "read"]);
  });

  it("reads nothing for anybody who is not a platform admin", async () => {
    session.admin = false;
    await expect(TriagePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(calls).toEqual(["gate"]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run "src/app/bugs/[id]" src/app/bugs/triage`
Expected: FAIL — the pages do not exist.

- [ ] **Step 3: The triage form**

`src/components/forms/bug-triage-form.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";

import { Field, Input, Textarea, inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { setBugStatus } from "@/lib/actions/bugs";
import {
  BUG_RESOLUTION_MAX,
  BUG_STATUS,
  BUG_STATUSES,
  BUG_STATUS_LABELS,
  type BugStatus,
} from "@/lib/bugs";

/**
 * Move a report along. Fixed and Closed ask for words — the fix line is read by
 * every user, the closing note by the person who reported it — and Fixed also
 * takes the changelog day it shipped in, which defaults to today.
 */
export function BugTriageForm({
  id,
  status,
  resolution,
  changelogDate,
}: {
  id: string;
  status: BugStatus;
  resolution: string | null;
  changelogDate: string | null;
}) {
  const [state, action] = useActionState(setBugStatus, null);
  const [next, setNext] = useState<BugStatus>(status);
  const failed = state && !state.ok ? state : null;
  const fieldError = (name: string) => (failed?.field === name ? failed.error : undefined);
  const closing = next === BUG_STATUS.FIXED || next === BUG_STATUS.CLOSED;

  return (
    <form action={action} className="space-y-4 rounded-xl bg-surface p-4 shadow-sm sm:p-5">
      <input type="hidden" name="id" value={id} />

      <Field label="Status">
        <select
          name="status"
          value={next}
          onChange={(event) => setNext(event.target.value as BugStatus)}
          className={inputClasses}
        >
          {BUG_STATUSES.map((s) => (
            <option key={s} value={s}>
              {BUG_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>

      {closing && (
        <Field
          label={next === BUG_STATUS.FIXED ? "Fix line" : "Note to the reporter"}
          required
          error={fieldError("resolution")}
          hint={
            next === BUG_STATUS.FIXED
              ? "Everybody reads this. Write it like a changelog line, with no names."
              : "Only the reporter reads this."
          }
        >
          <Textarea
            name="resolution"
            rows={3}
            maxLength={BUG_RESOLUTION_MAX}
            defaultValue={resolution ?? ""}
          />
        </Field>
      )}

      {next === BUG_STATUS.FIXED && (
        <Field label="Shipped in the changelog on" error={fieldError("changelogDate")} hint="Defaults to today.">
          <Input type="date" name="changelogDate" defaultValue={changelogDate ?? ""} />
        </Field>
      )}

      {failed && !failed.field && (
        <p role="alert" className="text-sm text-danger-ink">
          {failed.error}
        </p>
      )}
      {state?.ok && <p className="text-sm text-muted-fg">{state.message}</p>}

      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}
```

- [ ] **Step 4: `/bugs/[id]`**

`src/app/bugs/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";

import { BugTriageForm } from "@/components/forms/bug-triage-form";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { bugReportFor } from "@/lib/bug-queries";
import {
  BUG_STATUS,
  BUG_STATUS_LABELS,
  BUG_STATUS_SEVERITY,
  isBugStatus,
} from "@/lib/bugs";
import { requireUser } from "@/lib/dal";
import { formatDate } from "@/lib/format";

/**
 * One report. The reporter and platform admins may read it; for anybody else it
 * does not exist. The row is fetched first and the viewer checked inside the
 * query, so "not yours" and "no such id" are the same 404.
 */
export default async function BugPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const report = await bugReportFor(user, id);
  if (!report || !isBugStatus(report.status)) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle
        backHref={user.platformAdmin ? "/bugs/triage" : "/bugs"}
        backLabel={user.platformAdmin ? "Triage" : "Bug reports"}
        title={report.title}
        subtitle={
          <>
            Sent {formatDate(report.createdAt)}
            {report.reporterName && ` by ${report.reporterName}`}
          </>
        }
        actions={
          <StatusChip severity={BUG_STATUS_SEVERITY[report.status]}>
            {BUG_STATUS_LABELS[report.status]}
          </StatusChip>
        }
      />

      {report.resolution &&
        (report.status === BUG_STATUS.FIXED || report.status === BUG_STATUS.CLOSED) && (
          <Section title={report.status === BUG_STATUS.FIXED ? "Fixed" : "From the team"}>
            <p className="px-4 py-3 text-[0.9375rem] text-ink sm:px-5">{report.resolution}</p>
          </Section>
        )}

      <Section title="What happened">
        <div className="space-y-3 px-4 py-3 sm:px-5">
          {/* Plain text children, and `whitespace-pre-wrap` so line breaks
              survive: nothing here is ever rendered as HTML. */}
          <p className="whitespace-pre-wrap text-[0.9375rem] text-ink">{report.description}</p>
          {report.pagePath && (
            <p className="text-[0.8125rem] text-muted-fg">
              On <span className="font-medium text-ink">{report.pagePath}</span>
            </p>
          )}
          {report.hasImage && (
            // eslint-disable-next-line @next/next/no-img-element -- a gated, private route; the image optimiser would fetch it without the session
            <img
              src={`/api/bug-report/${report.id}/image`}
              alt="Screenshot attached to this report"
              className="max-h-[32rem] max-w-full rounded-lg border border-line"
            />
          )}
        </div>
      </Section>

      {user.platformAdmin && (
        <Section title="Triage">
          <BugTriageForm
            id={report.id}
            status={report.status}
            resolution={report.resolution}
            changelogDate={report.changelogDate}
          />
        </Section>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `/bugs/triage`**

`src/app/bugs/triage/page.tsx`:

```tsx
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { TabLinks } from "@/components/ui/segmented";
import { StatusChip } from "@/components/ui/status-chip";
import { triageList } from "@/lib/bug-queries";
import {
  BUG_STATUS_LABELS,
  BUG_STATUS_SEVERITY,
  isBugStatus,
  readTriageFilter,
} from "@/lib/bugs";
import { requirePlatformAdmin } from "@/lib/dal";
import { readParam, type SearchParams } from "@/lib/filters";
import { formatDate } from "@/lib/format";

/**
 * Every report, with who sent it. Platform admins only — the gate is the first
 * line, and `triageList` refuses anybody else too.
 */
export default async function TriagePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requirePlatformAdmin();
  const filter = readTriageFilter(readParam(await searchParams, "status"));
  const rows = await triageList(viewer, filter);

  return (
    <div className="space-y-4">
      <PageTitle
        backHref="/bugs"
        backLabel="Bug reports"
        title="Triage"
        subtitle="Every report, with who sent it."
      />

      <Section
        title="Reports"
        count={rows.length}
        action={
          <TabLinks
            label="Status"
            items={[
              { href: "/bugs/triage", label: "Open" },
              { href: "/bugs/triage?status=PENDING", label: "Pending" },
              { href: "/bugs/triage?status=IN_PROGRESS", label: "In progress" },
              { href: "/bugs/triage?status=FIXED", label: "Fixed" },
              { href: "/bugs/triage?status=CLOSED", label: "Closed" },
              { href: "/bugs/triage?status=all", label: "All" },
            ]}
          />
        }
      >
        {rows.length === 0 ? (
          <EmptyState framed={false} title="No reports here">
            Nothing matches this status.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <Link href={`/bugs/${r.id}`} className="font-medium text-ink hover:underline">
                    {r.title}
                  </Link>
                  <p className="text-[0.8125rem] text-muted-fg">
                    {r.reporterName} · {r.reporterRole.toLowerCase()} · {formatDate(r.createdAt)}
                  </p>
                </div>
                {isBugStatus(r.status) && (
                  <StatusChip severity={BUG_STATUS_SEVERITY[r.status]}>
                    {BUG_STATUS_LABELS[r.status]}
                  </StatusChip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
```

- [ ] **Step 6: Run to verify the page tests pass, then lint and type-check**

Run: `npx vitest run src/app/bugs && npm run lint && npx tsc --noEmit`
Expected: PASS and clean. If `PageTitle`'s `subtitle`/`actions` do not accept these shapes, adapt to its props (`src/components/ui/section.tsx`); if the ESLint `no-img-element` disable comment is flagged as unused, remove it.

- [ ] **Step 7: Commit**

```bash
git add "src/app/bugs/[id]" src/app/bugs/triage src/components/forms/bug-triage-form.tsx
git commit -m "Add the page for one bug report and the triage list for platform admins

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Entry points, changelog link, and the whole flow in the app

**Files:**
- Create: `src/components/report-bug-link.tsx`
- Modify: `src/components/app-shell.tsx` (two rows in `AccountMenu`)
- Modify: `src/app/changelog/page.tsx` (anchor on each entry; link to `/bugs`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: routes from Tasks 7–8.
- Produces: account-menu rows **Report a bug** and **Bug reports**; `id="<date>"` on each changelog entry.

- [ ] **Step 1: The link that knows where you are**

`src/components/report-bug-link.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * "Report a bug", carrying the page it was pressed on. The server decides
 * whether the path is one of ours (`sanitizePagePath`); this only supplies it.
 * From inside /bugs the page would just be the bug pages, so it sends nothing.
 */
export function ReportBugLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const href = pathname.startsWith("/bugs")
    ? "/bugs/new"
    : `/bugs/new?from=${encodeURIComponent(pathname)}`;
  return (
    <Link href={href} transitionTypes={["nav-forward"]} className={className}>
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Two rows in the account menu**

In `src/components/app-shell.tsx`, import `ReportBugLink` from `@/components/report-bug-link`. Directly after the "What's new" `<Link>` in `AccountMenu`, add:

```tsx
      <ReportBugLink className="flex min-h-11 items-center rounded-lg px-3 text-[0.9375rem] text-ink transition-colors hover:bg-fill">
        Report a bug
      </ReportBugLink>

      <Link
        href="/bugs"
        transitionTypes={["nav-forward"]}
        className="flex min-h-11 items-center rounded-lg px-3 text-[0.9375rem] text-ink transition-colors hover:bg-fill"
      >
        Bug reports
      </Link>
```

- [ ] **Step 3: Anchors and a link on `/changelog`**

In `src/app/changelog/page.tsx`: on each entry's `<Section …>` add `id={entry.date}` (Section forwards props to its `<section>`), and add a `Link` to the page title's `subtitle` or below it:

```tsx
<PageTitle
  title="What's new"
  subtitle={
    <>
      What we have added and fixed.{" "}
      <Link href="/bugs" className="text-brand hover:underline">
        Bug reports
      </Link>
    </>
  }
/>
```

(import `Link` from `next/link`). The existing page test must still pass: `npx vitest run src/app/changelog`.

- [ ] **Step 4: The changelog entry**

In `CHANGELOG.md`, under today's heading (`## 2026-10-02`, create it above the previous day if absent), in `### New`:

```markdown
- You can now report a bug from the account menu, with a screenshot if it helps. Bug reports shows what you have reported and where each one stands, and a list of what has been fixed.
```

- [ ] **Step 5: Lint, type-check, test, build**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build`
Expected: all clean; full suite green (`changelog.test.ts` parses the new entry).

- [ ] **Step 6: Drive the whole flow in the running app**

Use the `verify` skill (build, `PORT=3001 npm run start`, session-cookie login). Clean up any rows you create afterwards (`BugReportImage`, `BugReport`, `Notification`).

As a **mentor** (e.g. `dilnoza@freshman.academy`) on `/mentors/<id>`:
1. Open the account menu: "Report a bug" and "Bug reports" are there. "Report a bug" opens `/bugs/new?from=%2Fmentors%2F…`.
2. Submit with no title: the form refuses and keeps what was typed. Submit a title of `<b>bold</b> & <script>alert(1)</script>` and a three-line description with a real screenshot. You land on the report: the title shows as literal text, the line breaks are kept, the page reads `/mentors/<id>` (no query string), the screenshot loads.
3. `/bugs` lists it under Your reports as **Pending**, and "Fixed" shows only fix lines.
4. Submit five more quickly: the sixth is refused with the hourly-cap message.

As a **student**: `/bugs` shows none of the mentor's reports; `/bugs/<mentor's report id>` and `/api/bug-report/<id>/image` both 404; `/bugs/triage` 404s.

As the **platform admin** (`tech@freshman.academy`): a notification "Bug report: …" is in the bell and links to the report; `/bugs/triage` lists it with the reporter's name; set **In progress**, then **Fixed** with a fix line and today's date; try **Fixed** with an empty fix line (refused).

Back as the mentor: a "Bug fixed" notification links to the report, which shows the fix line; `/bugs` lists the fix line under Fixed with an "In the changelog" link that jumps to the right entry on `/changelog`. As the student, `/bugs` shows the same fix line and nothing of the mentor's wording.

At 390px wide, the form and `/bugs` do not scroll sideways.

- [ ] **Step 7: Commit**

```bash
git add src/components/report-bug-link.tsx src/components/app-shell.tsx src/app/changelog/page.tsx CHANGELOG.md
git commit -m "Put bug reports in the account menu and link fixes to the changelog

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
