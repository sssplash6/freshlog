# Partner Feedback Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Students of a partner school (Khana first) open `/f/<slug>`, pass an email allow-list, and rate a mentor or a session; platform admins read, filter and configure it under `/partners`.

**Architecture:** Four new Prisma tables (`FeedbackPartner`, `PartnerStudent`, `PartnerMentor`, `PartnerFeedback`) with no tie to the ledger or `StudentProfile`. A pure module holds the signed-pass cookie and field parsing; server actions sit on top; public pages under `/f` carry no `AppShell`; admin pages under `/partners` use `AppShell` and `requirePlatformAdmin` on every page and action.

**Tech Stack:** Next.js (repo version — read `node_modules/next/dist/docs/` before touching routing or `cookies()`), Prisma on SQLite, Vitest with `src/test/db.ts`, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-22-partner-feedback-design.md`

## Global Constraints

- Every page under `/partners` calls `await requirePlatformAdmin()` on its first line; every admin action re-checks `user.platformAdmin` and returns `{ ok: false, error: "Not allowed." }` otherwise (AGENTS.md "Gate every page").
- Unknown slug and inactive partner answer identically: `notFound()` on pages, `"This form isn't open."` from actions.
- Emails are stored `normalizeEmail()`-ed (trim + lowercase, `src/lib/actions/shared.ts:116`) and validated with `EMAIL_RE`.
- Slug: `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, 2–40 chars, stored lowercased.
- Rating integer 1–5; comment trimmed, 1–2000 chars; session number integer 1–999; name trimmed, 1–100 chars.
- Pass cookie: name `pf_<slug>`, value `<base64url email>.<expiresAtMs>.<hmac>`, HMAC-SHA256 over `partner-feedback:<slug>:<email>:<expiresAtMs>` with `NEXTAUTH_SECRET` (the `unsubscribe.ts` pattern), lifetime 12 hours, `httpOnly`, `sameSite: "lax"`, `secure` in production, `path: "/f/<slug>"`.
- Copy must pass `npm run lint` (incl. `scripts/check-copy.mjs`). Exact student copy: not-listed error `"This email isn't on the list for <Name>. Check the address, or ask your coordinator to add it."`; done screen `"Thanks — your feedback was sent."` with link `"Leave another"`.
- No nav/sidebar entry anywhere. No `programId` on any new table.
- `CHANGELOG.md` entry lands in the same commit as the first user-visible change (Task 6); Task 7 extends that entry; Tasks 1–5 add none.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; run `/verify` before the feature commits that change app behaviour.

## Review Focus

1. **A pass for one partner replayed on another** (cookie copied from `pf_khana` to `pf_other`) → refused, because the slug is inside the HMAC. Test in Task 2.
2. **Partner switched off, or the email removed, while a student's 12-hour pass is live** → next submit refused and the student sent back to the email step. Test in Task 3.
3. **A mentor unticked between page load and submit** (stale dropdown) → `"Pick one of the listed mentors."`, no row. Test in Task 3.
4. **Messy pasted email lists** — mixed case, duplicates within the paste, ones already listed, blank lines, commas and semicolons, garbage like `bob@` → counts reported exactly (added / already there / invalid), nothing invalid stored. Test in Task 4.
5. **Slug typed with spaces or capitals, or already taken** (`" Khana "`, `"khana"` twice) → normalized or `"That link is already used."`. Test in Task 4.

---

### Task 1: Schema, migration, fixtures

**Files:**
- Modify: `prisma/schema.prisma` (add the four models and enum exactly as in the spec's Data section; add back-relations on `User`: `partnerMentorships PartnerMentor[]` and `partnerFeedback PartnerFeedback[] @relation("PartnerFeedbackMentor")`)
- Create: `prisma/migrations/20261022120000_partner_feedback/migration.sql`
- Modify: `src/test/db.ts`

**Interfaces:**
- Produces: Prisma models `feedbackPartner`, `partnerStudent`, `partnerMentor`, `partnerFeedback`; enum `PartnerFeedbackKind { MENTOR, SESSION }`; fixtures `partner(opts?: { slug?: string; name?: string; active?: boolean }): Promise<FeedbackPartner>`, `partnerEmail(partnerId: string, email: string): Promise<PartnerStudent>`, `partnerMentor(partnerId: string, mentorId: string): Promise<PartnerMentor>`.

- [ ] **Step 1:** Edit the schema; generate the migration with `npx prisma migrate dev --name partner_feedback --create-only` and rename its folder to `20261022120000_partner_feedback` (later than `20261021090000_bug_report_diagnostics`). Read the SQL: four `CREATE TABLE`, the unique on `(partnerId, email)`, the index on `(partnerId, createdAt)`, nothing else.
- [ ] **Step 2:** In `resetDb()`, delete `partnerFeedback`, `partnerMentor`, `partnerStudent`, `feedbackPartner` (in that order) before `user.deleteMany()`. Add the three fixtures; `partner()` defaults slug `khana-<seq>`, name `"Khana"`, active `true`.
- [ ] **Step 3:** Run `npx prisma migrate dev` then `npm test`. Expected: all existing tests PASS.
- [ ] **Step 4:** Commit `"Add partner feedback tables"`.

### Task 2: Pass cookie and field parsing (pure)

**Files:**
- Create: `src/lib/partner-feedback.ts` (`import "server-only"`)
- Test: `src/lib/partner-feedback.test.ts`

**Interfaces:**
- Produces:
  - `PASS_HOURS = 12`
  - `passCookieName(slug: string): string` → `"pf_" + slug`
  - `signPass(slug: string, email: string, now: Date): { value: string; expires: Date }`
  - `readPass(slug: string, value: string | undefined, now: Date): string | null` — the email, or null when missing, malformed, wrong signature, other slug, or expired
  - `type FeedbackInput = { kind: "MENTOR"; mentorId: string; rating: number; comment: string } | { kind: "SESSION"; sessionNumber: number; name: string; rating: number; comment: string }`
  - `parseFeedback(kind: "MENTOR" | "SESSION", form: FormData): { ok: true; value: FeedbackInput } | { ok: false; error: string; field: string }`
  - `normalizeSlug(raw: string): string | null` (trim, lowercase, then the slug regex and length)
  - `parseEmailList(raw: string): { emails: string[]; invalid: string[] }` — split on newlines, commas, semicolons and whitespace; drop blanks; normalize; de-duplicate; split by `EMAIL_RE`

- [ ] **Step 1: Write the failing tests**

```ts
describe("readPass", () => {
  it("returns the email for a fresh pass", () => {
    const { value } = signPass("khana", "a@b.uz", NOW);
    expect(readPass("khana", value, NOW)).toBe("a@b.uz");
  });
  it("refuses another partner's pass", () => {
    expect(readPass("other", signPass("khana", "a@b.uz", NOW).value, NOW)).toBeNull();
  });
  it("refuses a pass 12 hours and one second old", () => {
    const { value } = signPass("khana", "a@b.uz", NOW);
    expect(readPass("khana", value, new Date(NOW.getTime() + 12 * 3600e3 + 1000))).toBeNull();
  });
  it("refuses a pass whose email was swapped", () => {
    const [, exp, mac] = signPass("khana", "a@b.uz", NOW).value.split(".");
    const forged = `${Buffer.from("c@d.uz").toString("base64url")}.${exp}.${mac}`;
    expect(readPass("khana", forged, NOW)).toBeNull();
  });
  it.each([undefined, "", "garbage", "a.b", "a.b.c.d"])("refuses %s", (v) => {
    expect(readPass("khana", v, NOW)).toBeNull();
  });
});

describe("parseFeedback", () => {
  // helper form({...}) as in bugs.test.ts
  it("accepts a mentor rating", () => {
    expect(parseFeedback("MENTOR", form({ mentorId: "m1", rating: "4", comment: " Clear " })))
      .toEqual({ ok: true, value: { kind: "MENTOR", mentorId: "m1", rating: 4, comment: "Clear" } });
  });
  it("accepts a session rating", () => {
    expect(parseFeedback("SESSION", form({ sessionNumber: "7", name: " Aziz ", rating: "5", comment: "Good" })))
      .toEqual({ ok: true, value: { kind: "SESSION", sessionNumber: 7, name: "Aziz", rating: 5, comment: "Good" } });
  });
  it.each([
    ["MENTOR", { mentorId: "", rating: "4", comment: "x" }, "mentorId"],
    ["MENTOR", { mentorId: "m", rating: "0", comment: "x" }, "rating"],
    ["MENTOR", { mentorId: "m", rating: "6", comment: "x" }, "rating"],
    ["MENTOR", { mentorId: "m", rating: "4", comment: "   " }, "comment"],
    ["MENTOR", { mentorId: "m", rating: "4", comment: "x".repeat(2001) }, "comment"],
    ["SESSION", { sessionNumber: "", name: "A", rating: "4", comment: "x" }, "sessionNumber"],
    ["SESSION", { sessionNumber: "1.5", name: "A", rating: "4", comment: "x" }, "sessionNumber"],
    ["SESSION", { sessionNumber: "1000", name: "A", rating: "4", comment: "x" }, "sessionNumber"],
    ["SESSION", { sessionNumber: "3", name: " ", rating: "4", comment: "x" }, "name"],
  ] as const)("%s %o refuses on %s", (kind, fields, field) => {
    expect(parseFeedback(kind, form(fields))).toMatchObject({ ok: false, field });
  });
});

describe("parseEmailList", () => {
  it("normalizes, de-duplicates and separates the invalid", () => {
    expect(parseEmailList(" A@x.uz\na@x.uz, b@x.uz;\n\nbob@ \tc@x.uz"))
      .toEqual({ emails: ["a@x.uz", "b@x.uz", "c@x.uz"], invalid: ["bob@"] });
  });
});

describe("normalizeSlug", () => {
  it.each([[" Khana ", "khana"], ["sat-2026", "sat-2026"], ["a", null], ["kh ana", null], ["-k", null], ["k".repeat(41), null]])(
    "%s → %s", (raw, out) => expect(normalizeSlug(raw)).toBe(out));
});
```

- [ ] **Step 2:** `npx vitest run src/lib/partner-feedback.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Implement. `readPass` compares MACs with `timingSafeEqual` after a length check, as `verifyUnsubscribeToken` does. Field errors use the spec copy: `"Pick one of the listed mentors."`, `"Pick a rating from 1 to 5."`, `"Write your feedback."`, `"Keep it under 2000 characters."`, `"Enter the session number."`, `"Enter your name."`.
- [ ] **Step 4:** Rerun — PASS. Commit `"Sign partner feedback passes and parse its fields"`.

### Task 3: Student actions

**Files:**
- Create: `src/lib/actions/partner-feedback.ts` (`"use server"`)
- Test: `src/lib/actions/partner-feedback.test.ts`

**Interfaces:**
- Consumes: Task 2 exports; fixtures from Task 1.
- Produces (bound with `.bind(null, slug)` / `.bind(null, slug, kind)` by the pages):
  - `checkPartnerEmail(slug: string, prev: ActionState, form: FormData): Promise<ActionState>` — on success sets the cookie and returns `{ ok: true }`
  - `submitPartnerFeedback(slug: string, kind: "MENTOR" | "SESSION", prev: ActionState, form: FormData): Promise<ActionState>` — on a bad/expired/stale pass returns `{ ok: false, error: "Enter your email again to continue.", field: "pass" }` and deletes the cookie; on success `{ ok: true, message: "Thanks — your feedback was sent." }`
  - `forgetPartnerEmail(slug: string): Promise<void>` — deletes the cookie
  - `activePartner(slug: string)` (exported from `src/lib/partner-feedback.ts` if pages need it too: `findFirst({ where: { slug, active: true } })`)

- [ ] **Step 1: Write the failing tests.** Mock `next/headers` with an in-memory jar (`cookies: async () => ({ get: k => jar.get(k) && { value: jar.get(k) }, set: (k, v) => jar.set(k, v), delete: k => jar.delete(k) })`) and `next/cache` as `bugs.test.ts` does. Cases:
  - `checkPartnerEmail` with `" A@X.uz "` when `a@x.uz` is listed → `{ ok: true }`, `jar` holds `pf_<slug>` and `readPass` of it is `"a@x.uz"`.
  - unlisted email → `{ ok: false, error: "This email isn't on the list for Khana. Check the address, or ask your coordinator to add it.", field: "email" }`, jar empty.
  - inactive partner, unknown slug → both `{ ok: false, error: "This form isn't open." }`.
  - `submitPartnerFeedback` MENTOR with a listed mentor → exactly one `partnerFeedback` row: right `partnerId`, `studentEmail`, `mentorId`, `rating`, `comment`, null `sessionNumber`/`name`.
  - SESSION valid → one row with `sessionNumber`, `name`, null `mentorId`.
  - MENTOR with a mentor not on this partner (or unticked after the pass was issued) → `field: "mentorId"`, zero rows.
  - no cookie / tampered cookie / other partner's cookie copied in → `field: "pass"`, zero rows, cookie deleted.
  - email removed from the list after the pass was issued → `field: "pass"`, zero rows.
  - partner deactivated after the pass was issued → `"This form isn't open."`, zero rows.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. Order inside `submitPartnerFeedback`: partner active → pass valid → email still listed → `parseFeedback` → (MENTOR) `partnerMentor` row exists → `create`. Returned errors include `values` of the submitted fields so the form keeps them.
- [ ] **Step 4:** Run — PASS. Commit `"Let partner students check in and leave feedback"`.

### Task 4: Admin actions

**Files:**
- Create: `src/lib/actions/partners.ts` (`"use server"`)
- Test: `src/lib/actions/partners.test.ts`

**Interfaces:**
- Consumes: `normalizeSlug`, `parseEmailList` (Task 2); `getCurrentUser` (mocked like `bugs.test.ts`).
- Produces (all return `ActionState`; all refuse non-platform-admins with `"Not allowed."`):
  - `createPartner(prev, form)` — fields `name` (1–80), `slug`; success redirects to `/partners/<slug>/settings`; taken slug → `{ field: "slug", error: "That link is already used." }`; bad slug → `"Use 2–40 lowercase letters, digits or dashes."`
  - `updatePartner(partnerId: string, prev, form)` — `name`, `active` (`"on"` or absent)
  - `addPartnerEmails(partnerId: string, prev, form)` — field `emails`; message `"Added <n>. <m> already listed. <k> not valid: <first five, comma-separated>."` omitting zero clauses
  - `removePartnerEmail(partnerId: string, emailId: string): Promise<ActionState>`
  - `setPartnerMentors(partnerId: string, prev, form)` — `mentorId` repeated; only users that `canActAsMentor` are kept; replaces the set in one transaction
  - Each revalidates `/partners`, `/partners/<slug>` and `/partners/<slug>/settings`.

- [ ] **Step 1: Write the failing tests:**
  - every action with a plain `admin()` and with `null` actor → `"Not allowed."`, no write.
  - `createPartner` with slug `" Khana "` → row with slug `khana`; again with `khana` → `field: "slug"`.
  - `addPartnerEmails` with `a@x.uz` already listed and paste `"A@x.uz\nb@x.uz, b@x.uz;bob@"` → message `"Added 1. 1 already listed. 1 not valid: bob@."`; rows are exactly `a@x.uz`, `b@x.uz`.
  - `setPartnerMentors` with a mentor id and a student id → only the mentor is stored; a second call with an empty set removes it.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (`createMany` of new emails after reading existing ones). **Step 4:** Run — PASS. Commit `"Let platform admins set up partner feedback"`.

### Task 5: Read model for the admin view

**Files:**
- Create: `src/lib/partner-feedback-queries.ts` (`import "server-only"`)
- Test: `src/lib/partner-feedback-queries.test.ts`

**Interfaces:**
- Produces:
  - `type PartnerFilters = { kind?: "MENTOR" | "SESSION"; mentorId?: string; session?: number; rating?: number; from?: Date; to?: Date; q?: string }`
  - `readPartnerFilters(params: SearchParams, now: Date): PartnerFilters` — params `kind`, `mentor`, `session`, `rating`, date via `readDateWindow` (`src/lib/filters.ts:449`), `q`; anything unparseable is dropped, not an error
  - `partnerFeedbackWhere(partnerId: string, f: PartnerFilters): Prisma.PartnerFeedbackWhereInput` — `q` matches `studentEmail` or `name` (contains, case-insensitive via lowercased `q` against the stored lowercase email; `name` with `contains`)
  - `partnerSummary(partnerId: string, f: PartnerFilters): Promise<{ total: number; average: number | null; lastWeek: number; byMentor: { mentorId: string; name: string; count: number; average: number }[]; bySession: { sessionNumber: number; count: number; average: number }[] }>` — `byMentor` sorted by average ascending then count descending; `bySession` by number ascending; `lastWeek` is rows in the filtered set from the last 7 days

- [ ] **Step 1: Write the failing tests:** seed two mentors (ratings 5,5 and 1,2) and sessions 2 and 1 → `byMentor[0]` is the 1.5 mentor; `bySession` is `[1, 2]`; `kind: "SESSION"` filter gives `byMentor: []`; `q: "AZ"` matches name `"Aziz"` and email `aziz@x.uz` once each; another partner's rows never counted.
- [ ] **Step 2:** FAIL. **Step 3:** Implement with `groupBy` + one `user.findMany` for names. **Step 4:** PASS. Commit `"Summarise partner feedback by mentor and session"`.

### Task 6: Public student pages

**Files:**
- Modify: `src/proxy.ts` — add `"/f"` to `PUBLIC_PATHS` and extend the comment above it with one sentence on why (partner students have no account; the pages authorize on a signed pass cookie, `src/lib/partner-feedback.ts`).
- Create: `src/app/f/[slug]/layout.tsx` — `dynamic = "force-dynamic"`; a centred `max-w-md` column with the partner name as a small header; no `AppShell`.
- Create: `src/app/f/[slug]/page.tsx`, `src/app/f/[slug]/mentor/page.tsx`, `src/app/f/[slug]/session/page.tsx`
- Create: `src/components/forms/partner-feedback-forms.tsx` (`"use client"`)

**Interfaces:**
- Consumes: `activePartner`, `readPass`, `passCookieName` (Task 2/3), the actions from Task 3, `StarRating` from `src/components/forms/feedback-forms.tsx`, `Select`, `SubmitButton`, `SaveState`/`useSaveState`, `inputClasses`.
- Produces components: `PartnerEmailForm({ slug })`, `PartnerMentorForm({ slug, mentors: { id: string; label: string }[] })`, `PartnerSessionForm({ slug })`, `PartnerDone({ again: string })`.

Page logic (each page): `activePartner(slug)` or `notFound()`; read the pass from `cookies()`; if no valid pass **or** the email is no longer listed → render `PartnerEmailForm`. Otherwise:
- `/f/[slug]`: "Rate a mentor" / "Rate a session" as two large link cards to `/mentor` and `/session`, plus "Not you?" (a form posting `forgetPartnerEmail`).
- `/mentor`, `/session`: the matching form. On `{ ok: true }` the client form swaps to `PartnerDone` with "Leave another" (resets the form). On `field: "pass"` it calls `router.refresh()` so the page falls back to the email step.

`PartnerEmailForm` on success calls `router.refresh()`. Mentor dropdown labels are the mentor's display name, sorted by name. Field labels: "Your email", "Mentor", "Session number", "Your name", "Rating", "Feedback". All inputs `text-base` under `sm` (iOS zoom), comment textarea 4 rows.

- [ ] **Step 1:** Implement the files.
- [ ] **Step 2:** `npm run lint && npx tsc --noEmit` — clean.
- [ ] **Step 3:** Start `npm run dev:local`; with a partner seeded through Prisma Studio or a script, at 375px width: unknown slug → 404; unlisted email → the exact error; listed → choice screen; submit both kinds → done screen and a row each; clear the cookie mid-form and submit → back to the email step.
- [ ] **Step 4:** Check `/feedback` still redirects a signed-out request to `/login` (the `/f` prefix must not open `/feedback`: `PUBLIC_PATHS` matches `p` exactly or `p + "/"`).
- [ ] **Step 5:** Add to `CHANGELOG.md` under `## 2026-10-22` → `### New`: "Students of a partner school can leave feedback from a link: they enter their email, and if it is on the school's list they rate a mentor or a class session."
- [ ] **Step 6:** Run `/verify`, then commit `"Give partner students a feedback page they reach by link"` with the changelog entry.

### Task 7: Admin pages, changelog, verification

**Files:**
- Create: `src/app/partners/layout.tsx` (as `src/app/feedback/layout.tsx`: `AppShell`, `force-dynamic`, gate repeated in pages)
- Create: `src/app/partners/page.tsx`, `src/app/partners/[slug]/page.tsx`, `src/app/partners/[slug]/settings/page.tsx`
- Create: `src/components/forms/partner-settings-forms.tsx` (`"use client"`): `NewPartnerForm`, `PartnerDetailsForm`, `PartnerEmailsForm`, `PartnerMentorsForm`, `CopyLink({ url })`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 4 actions, Task 5 queries, `appUrl()` from `src/lib/email/send` for the absolute deep links, `FilterBar`, `Table`/`Td`/`Tr`, `Pagination`/`parsePage`/`PAGE_SIZE`, `ExpandableText`, `Rating`, `EmptyState`, `PageTitle`/`Section`.

- `/partners`: table of partners — name, `/f/<slug>`, Active/Off chip, emails, feedback, average — and `NewPartnerForm`. Empty state: "No partners yet. Add one to get a feedback link."
- `/partners/[slug]`: unknown slug → `notFound()`. Header with name, links to Settings. Summary row (total, average, last 7 days); "By mentor" and "By session" tables from `partnerSummary`; then the filtered, paginated feedback table (columns: Date, Kind, About — mentor name or "Session <n>", Name, Email, Rating, Feedback) with `FilterBar` selects for kind, mentor (every mentor that has feedback or is ticked), rating 1–5, date presets, a session-number field and search. Empty filtered state: "No feedback matches these filters."
- `/partners/[slug]/settings`: `PartnerDetailsForm` (name, active), the three deep links each with `CopyLink`, `PartnerEmailsForm` (textarea + listed emails with remove), `PartnerMentorsForm` (checkboxes of every user who `canActAsMentor` and is active).

- [ ] **Step 1:** Implement the pages and forms; every page's first line is `await requirePlatformAdmin();`.
- [ ] **Step 2:** Add a test to `src/lib/dal.test.ts`-style or a page test (as `src/app/bugs/page.test.ts`) that `/partners` and `/partners/[slug]` render `notFound` for a plain admin.
- [ ] **Step 3:** Replace Task 6's `CHANGELOG.md` entry with: "Partner schools can now leave feedback. Admins set up a partner — Khana is the first — paste in its students' emails and pick its mentors; students open the partner's link, enter their email, and rate a mentor or a session. Every rating is on the partner's page, with filters."
- [ ] **Step 4:** `npm test && npm run lint && npx tsc --noEmit` — all PASS.
- [ ] **Step 5:** Run `/verify`: sign in as a platform admin, create Khana, paste emails, tick a mentor, open `/f/khana/mentor` and `/f/khana/session` at phone width in a signed-out tab, submit one of each, then filter them on `/partners/khana` by kind, mentor and session.
- [ ] **Step 6:** Commit `"Give platform admins a partner feedback view"` with the changelog entry.
