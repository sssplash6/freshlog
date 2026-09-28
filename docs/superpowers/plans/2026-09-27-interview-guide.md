# Practice Interview Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Walk two students through a structured practice interview (intro → rubric → questions → feedback) on a freshform page beside their Meet call, with a Speak button that transcribes each answer word for word.

**Architecture:** Two new tables (`InterviewAnswer`, `InterviewFeedback`) and one new column (`InterviewSlot.meetingUrl`), written only through server actions in `src/lib/actions/interviews.ts` that gate on `activeStudent()` + `myInterview()`. Pure rules live in `src/lib/peer-interviews.ts`. A new page `/student/interviews/[id]/live` renders a client stepper (`src/components/forms/interview-guide.tsx`); the existing dictation route gains an `answer` mode.

**Tech Stack:** Next.js 16 (App Router, server actions — read `node_modules/next/dist/docs/` before touching routing), React 19, Prisma 7 on SQLite (hand-written SQL migrations applied by `prisma migrate deploy`), Vitest against `prisma/test.db`.

**Spec:** `docs/superpowers/specs/2026-09-27-interview-guide-design.md`

## Global Constraints

- Every page function calls its gate on its **first line**, before any query (AGENTS.md). Student pages use `requireRole(ROLES.STUDENT)`.
- "Not yours" and "does not exist" answer identically: pages `notFound()`, actions return `"That interview isn't one of yours."`.
- A student's answers are **never** selected for the other student, by any page or action.
- Partner feedback is visible to its recipient **only when `submittedAt` is set**.
- Meeting link: optional, `https:` only, ≤ 500 characters; shown only to the two students of a booked interview.
- Every text field (answer, summary, wentWell, toImprove) ≤ `NOTES_MAX` (5000).
- Answer dictation writes **exactly what was said** (mistakes, fillers kept). Notes dictation is unchanged.
- Audio cap stays 2 minutes / `MAX_AUDIO_BYTES` (5MB); the route message says "two minutes".
- School text (intro, rubric, feedback instructions, Session 1 questions) is copied **verbatim**.
- Step order on screen: Introductions → Feedback rubric → Interview practice → Partner feedback.
- No `programId` on the new tables. Notification category for the new type: `SESSIONS`.
- `npm run lint` (includes `scripts/check-copy.mjs`) and `npx tsc --noEmit` must pass after every task.

**Correction to the spec, found while planning:** the spec says the guide is open "until the interview is completed". But the first student to submit feedback marks the interview completed, which would lock the partner out mid-session. So the guide is open **from the start time until *this student* submits their own feedback**, whether or not the interview is completed. `guideOpen` below encodes that.

## Review Focus

1. **Partner submits first**: B must still be able to answer and submit after A's submit has set `completedAt`. Pinned in Task 4 ("the second student can still finish after the first submits").
2. **Same question, both students**: host's and guest's answers to question 0 must be two rows; neither overwrites the other. Pinned in Task 4.
3. **Double submit / submit after lock**: the second submit is refused, and the first `submittedAt` is kept. Pinned in Task 4.
4. **Hostile meeting link** (`javascript:alert(1)`, `http://`, 600-char URL): refused with a sentence, not stored. Pinned in Tasks 1 and 3.
5. **Guide opened before the start time or by a stranger**: before the start, the page shows when it opens and no inputs; a stranger gets 404; actions refuse early saves. Pinned in Task 4 ("refuses answers before the interview starts").

---

### Task 0: Branch

- [ ] **Step 1:** `git checkout -b interview-guide` (the repo is on `main`; never commit there).

---

### Task 1: Content and pure rules

**Files:**
- Modify: `src/lib/interview-templates.ts`
- Modify: `src/lib/peer-interviews.ts`
- Test: `src/lib/peer-interviews.test.ts`

**Interfaces:**
- Produces:
  - `INTERVIEW_INTRO: string`, `INTERVIEW_RUBRIC: readonly { name: string; questions: readonly string[] }[]`, `INTERVIEW_TURNS: string`, `FEEDBACK_PROMPTS: { summary: string; wentWell: string; toImprove: string }`, `FEEDBACK_DISCUSS: string`
  - template id `"freshman-session-1"` (first in `INTERVIEW_TEMPLATES`)
  - `parseMeetingUrl(raw: FormDataEntryValue | null): { value: string | null } | { error: string }`
  - `MEETING_URL_MAX = 500`
  - `questionAt(template: InterviewTemplate | null, index: number): string | null`
  - `feedbackVisibleTo(feedback: { fromId: string; submittedAt: Date | null }, studentId: string): boolean`
  - `guideOpen(slot: { startsAt: Date }, mySubmittedAt: Date | null, now: Date): boolean`

- [ ] **Step 1: Write the failing tests** — append to `src/lib/peer-interviews.test.ts` (add the new names to its import):

```ts
import {
  feedbackVisibleTo,
  guideOpen,
  parseMeetingUrl,
  questionAt,
} from "@/lib/peer-interviews";
import { INTERVIEW_TEMPLATES, templateById } from "@/lib/interview-templates";

describe("parseMeetingUrl", () => {
  it("takes nothing as no link", () => {
    expect(parseMeetingUrl("")).toEqual({ value: null });
    expect(parseMeetingUrl(null)).toEqual({ value: null });
    expect(parseMeetingUrl("   ")).toEqual({ value: null });
  });

  it("takes an https link, trimmed", () => {
    expect(parseMeetingUrl(" https://meet.google.com/abc-defg-hij ")).toEqual({
      value: "https://meet.google.com/abc-defg-hij",
    });
  });

  it("refuses anything that is not an https link", () => {
    expect(parseMeetingUrl("javascript:alert(1)")).toHaveProperty("error");
    expect(parseMeetingUrl("http://meet.google.com/x")).toHaveProperty("error");
    expect(parseMeetingUrl("meet.google.com/x")).toHaveProperty("error");
    expect(parseMeetingUrl(`https://x.com/${"a".repeat(600)}`)).toHaveProperty("error");
  });
});

describe("questionAt", () => {
  const t = templateById("freshman-session-1");

  it("gives the question at an index the template has", () => {
    expect(questionAt(t, 1)).toBe("Describe a teacher you really enjoyed learning from.");
  });

  it("refuses an index it does not have, and a missing template", () => {
    expect(questionAt(t, 4)).toBeNull();
    expect(questionAt(t, -1)).toBeNull();
    expect(questionAt(t, 1.5)).toBeNull();
    expect(questionAt(null, 0)).toBeNull();
  });
});

describe("feedbackVisibleTo", () => {
  it("shows a draft to its author only", () => {
    const draft = { fromId: "a", submittedAt: null };
    expect(feedbackVisibleTo(draft, "a")).toBe(true);
    expect(feedbackVisibleTo(draft, "b")).toBe(false);
  });

  it("shows submitted feedback to the partner", () => {
    expect(feedbackVisibleTo({ fromId: "a", submittedAt: NOW }, "b")).toBe(true);
  });
});

describe("guideOpen", () => {
  const slot = { startsAt: at("2026-09-03T17:00") }; // exactly now on Tashkent's clock

  it("opens at the start time and stays open until this student submits", () => {
    expect(guideOpen({ startsAt: at("2026-09-03T18:00") }, null, NOW)).toBe(false);
    expect(guideOpen(slot, null, NOW)).toBe(true);
    expect(guideOpen(slot, NOW, NOW)).toBe(false);
  });
});

describe("Session 1", () => {
  it("is offered first, with the school's four questions", () => {
    expect(INTERVIEW_TEMPLATES[0].id).toBe("freshman-session-1");
    expect(INTERVIEW_TEMPLATES[0].questions).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/peer-interviews.test.ts`
Expected: FAIL — `parseMeetingUrl` / `questionAt` / … is not exported.

- [ ] **Step 3: Add the content** — in `src/lib/interview-templates.ts`, put this entry **first** in `INTERVIEW_TEMPLATES`:

```ts
  {
    id: "freshman-session-1",
    name: "Freshman Interview Practice: Session 1",
    summary: "The school's first session: getting to know you, and why college.",
    questions: [
      "What are you reading, watching, or working on right now? Is there anything that has caught your attention recently?",
      "Describe a teacher you really enjoyed learning from.",
      "What are you most excited about in college?",
      "Tell me about a situation when you had to change your mind or adapt to make something work.",
    ],
  },
```

and append, after `templateName`:

```ts
/**
 * The session around the questions, the same for every template: the school's
 * own words, kept verbatim so a student reads what their teacher wrote.
 */
export const INTERVIEW_INTRO =
  "Introduce yourself to your partner. Share your name, where you're from, and a little about what you've been up to this week.";

export const INTERVIEW_RUBRIC: readonly { name: string; questions: readonly string[] }[] = [
  {
    name: "Content",
    questions: [
      "How relevant, detailed, and insightful was the response?",
      "Did your partner provide specific examples?",
      "Did you learn something interesting?",
    ],
  },
  {
    name: "Flow & Structure",
    questions: [
      "Was the response easy to follow?",
      "Were the ideas logically connected, or did your partner jump from point to point?",
      "Did the response have a clear structure?",
    ],
  },
  {
    name: "Grammar & Language",
    questions: [
      "Was the language grammatically accurate?",
      "Did your partner use appropriate and varied vocabulary?",
      "Were there any recurring mistakes?",
    ],
  },
  {
    name: "Confidence",
    questions: [
      "Did your partner speak clearly and confidently?",
      "Did they maintain a natural pace?",
      "Did they avoid excessive filler words and unnecessary pauses?",
    ],
  },
];

export const INTERVIEW_TURNS =
  "Take turns interviewing each other using the following questions. Listen carefully to your partner's responses.";

export const FEEDBACK_PROMPTS = {
  summary: "Briefly summarize your partner's answers.",
  wentWell:
    "Always start with positive feedback. Highlight what your partner did particularly well.",
  toImprove:
    "Identify areas for improvement and provide specific, constructive suggestions.",
} as const;

export const FEEDBACK_DISCUSS =
  "Discuss your feedback with each other before submitting the form.";
```

- [ ] **Step 4: Add the rules** — append to `src/lib/peer-interviews.ts` (add `import type { InterviewTemplate } from "@/lib/interview-templates";`):

```ts
/** Long enough for any meeting link with its query string. */
export const MEETING_URL_MAX = 500;

/**
 * The optional "where we meet" link on an offered time. https only: the link
 * is rendered as an href another student clicks, so `javascript:` and plain
 * http are refused here, not trusted to the browser.
 */
export function parseMeetingUrl(
  raw: FormDataEntryValue | null
): { value: string | null } | { error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { value: null };
  const invalid = { error: "Paste a meeting link that starts with https://." };
  if (text.length > MEETING_URL_MAX) return invalid;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return invalid;
  }
  return url.protocol === "https:" ? { value: text } : invalid;
}

/** The question at `index` in a template, or null if it has no such question. */
export function questionAt(template: InterviewTemplate | null, index: number): string | null {
  if (!template || !Number.isInteger(index)) return null;
  return template.questions[index] ?? null;
}

/**
 * Feedback is its author's until they submit it; after that, the partner it is
 * about reads it too. A half-written judgement is never shown.
 */
export function feedbackVisibleTo(
  feedback: { fromId: string; submittedAt: Date | null },
  studentId: string
): boolean {
  return feedback.fromId === studentId || feedback.submittedAt !== null;
}

/**
 * Whether this student may still use the guide: from the start time until
 * they submit their own feedback. NOT until the interview is completed — the
 * partner who submits first completes it, and must not lock the other out.
 */
export function guideOpen(
  slot: { startsAt: Date },
  mySubmittedAt: Date | null,
  now: Date
): boolean {
  return mySubmittedAt === null && hasStarted(slot.startsAt, now);
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/peer-interviews.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS, no type or lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/interview-templates.ts src/lib/peer-interviews.ts src/lib/peer-interviews.test.ts
git commit -m "The school's Session 1 and its rubric, and the rules the guide will ask"
```

---

### Task 2: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (models `InterviewSlot`, `PeerInterview`, `StudentProfile`; add two models)
- Create: `prisma/migrations/20260927090000_interview_guide/migration.sql`
- Modify: `src/test/db.ts:13`

**Interfaces:**
- Produces: `prisma.interviewAnswer` (`interviewId`, `studentId`, `questionIndex`, `question`, `text`), unique `interviewId_studentId_questionIndex`; `prisma.interviewFeedback` (`interviewId`, `fromId`, `summary`, `wentWell`, `toImprove`, `submittedAt`), unique `interviewId_fromId`; `InterviewSlot.meetingUrl`.

- [ ] **Step 1: Edit the schema.** In `model InterviewSlot` add after `minutes`:

```prisma
  // Where the two students meet — a Meet or Zoom link, https only, optional.
  // Shown to the two students of a booked interview, never to classmates
  // browsing open times.
  meetingUrl String?
```

In `model PeerInterview` add after the `guest` relation:

```prisma
  answers  InterviewAnswer[]
  feedback InterviewFeedback[]
```

Add after `model PeerInterview`:

```prisma
// One student's own answer to one question, typed or dictated. Private to the
// student who gave it: no page or action selects it for the partner.
//
// `question` is the wording at the time, so editing a template never relabels
// an answer already given.
model InterviewAnswer {
  id            String   @id @default(cuid())
  interviewId   String
  studentId     String
  questionIndex Int
  question      String
  text          String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  interview PeerInterview  @relation(fields: [interviewId], references: [id], onDelete: Cascade)
  student   StudentProfile @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@unique([interviewId, studentId, questionIndex])
}

// What one student says about their partner's answers. A draft is its author's
// alone; `submittedAt` is the moment it becomes the partner's to read, and
// after it the row does not change.
model InterviewFeedback {
  id          String    @id @default(cuid())
  interviewId String
  fromId      String
  summary     String?
  wentWell    String?
  toImprove   String?
  submittedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  interview PeerInterview  @relation(fields: [interviewId], references: [id], onDelete: Cascade)
  from      StudentProfile @relation(fields: [fromId], references: [id], onDelete: Cascade)

  @@unique([interviewId, fromId])
}
```

In `model StudentProfile`, next to its existing `interviewSlots` / `InterviewHost` relations, add:

```prisma
  interviewAnswers  InterviewAnswer[]
  interviewFeedback InterviewFeedback[]
```

- [ ] **Step 2: Write the migration** — `prisma/migrations/20260927090000_interview_guide/migration.sql`:

```sql
-- The guided practice interview: where the two students meet, each one's own
-- answers, and the feedback each writes about the other. No programId: like
-- PeerInterview, these are two students rehearsing and touch no ledger.

ALTER TABLE "InterviewSlot" ADD COLUMN "meetingUrl" TEXT;

CREATE TABLE "InterviewAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "interviewId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "questionIndex" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterviewAnswer_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "PeerInterview" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterviewAnswer_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "InterviewFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "interviewId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "summary" TEXT,
    "wentWell" TEXT,
    "toImprove" TEXT,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterviewFeedback_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "PeerInterview" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterviewFeedback_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InterviewAnswer_interviewId_studentId_questionIndex_key" ON "InterviewAnswer"("interviewId", "studentId", "questionIndex");
CREATE UNIQUE INDEX "InterviewFeedback_interviewId_fromId_key" ON "InterviewFeedback"("interviewId", "fromId");
```

- [ ] **Step 3: Check the SQL matches the schema**

Run: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script`
Expected: an empty script (`-- This is an empty migration.`). If it prints statements, fix the SQL until it does not. (If this Prisma version wants `--shadow-database-url`, pass `file:./prisma/shadow.db` and delete that file afterwards.)

- [ ] **Step 4: Regenerate the client, extend the test wipe** — run `npx prisma generate`. In `src/test/db.ts` add these two lines **above** `await prisma.peerInterview.deleteMany();`:

```ts
  await prisma.interviewAnswer.deleteMany();
  await prisma.interviewFeedback.deleteMany();
```

- [ ] **Step 5: Run the whole suite** (global setup applies the migration to `prisma/test.db`)

Run: `npm test && npx tsc --noEmit`
Expected: all existing tests PASS.

- [ ] **Step 6: Apply to the dev database** — `npx prisma migrate deploy`.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260927090000_interview_guide src/test/db.ts src/generated
git commit -m "A booked practice interview can hold each student's answers and feedback"
```

---

### Task 3: Meeting link on an offered time

**Files:**
- Modify: `src/lib/actions/interviews.ts` (`addInterviewSlot`)
- Modify: `src/components/forms/interview-forms.tsx` (`OfferSlotForm`)
- Modify: `src/app/student/interviews/[id]/page.tsx`
- Test: `src/lib/actions/interviews.test.ts`

**Interfaces:**
- Consumes: `parseMeetingUrl` (Task 1), `InterviewSlot.meetingUrl` (Task 2).

- [ ] **Step 1: Write the failing tests** — add to `interviews.test.ts`, inside a new `describe("addInterviewSlot meeting link", …)`:

```ts
describe("addInterviewSlot meeting link", () => {
  const tomorrow = () => toDateInputValue(wallHoursFromNow(24));

  it("keeps an https link on the time", async () => {
    const { guest } = await scene();
    as(guest);

    const result = await addInterviewSlot(
      null,
      form({ date: tomorrow(), time: "10:00", minutes: "45", meetingUrl: "https://meet.google.com/abc-defg-hij" })
    );

    expect(result).toMatchObject({ ok: true });
    const slot = await prisma.interviewSlot.findFirstOrThrow({ where: { studentId: guest.id } });
    expect(slot.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("refuses a link that is not https, and stores nothing", async () => {
    const { guest } = await scene();
    as(guest);

    const result = await addInterviewSlot(
      null,
      form({ date: tomorrow(), time: "10:00", minutes: "45", meetingUrl: "javascript:alert(1)" })
    );

    expect(result).toMatchObject({ ok: false });
    expect(await prisma.interviewSlot.count({ where: { studentId: guest.id } })).toBe(0);
  });
});
```

(`toDateInputValue` is already imported at the top of the file.)

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/actions/interviews.test.ts -t "meeting link"`
Expected: FAIL — `meetingUrl` is null / the bad link is accepted.

- [ ] **Step 3: Implement** — in `addInterviewSlot`, after the `minutes` check:

```ts
  const link = parseMeetingUrl(formData.get("meetingUrl"));
  if ("error" in link) return { ok: false, error: link.error };
```

and change the create to `data: { studentId: me.profile.id, ...slot, meetingUrl: link.value }`. Add `parseMeetingUrl` to the import from `@/lib/peer-interviews`.

In `OfferSlotForm`, add below the grid `div` and above the submit row:

```tsx
      <label className="block text-sm">
        <span className="text-muted-fg">Meeting link (optional)</span>
        <Input
          name="meetingUrl"
          type="url"
          inputMode="url"
          placeholder="https://meet.google.com/…"
          maxLength={MEETING_URL_MAX}
          className="mt-0.5"
        />
      </label>
```

(import `MEETING_URL_MAX` from `@/lib/peer-interviews`).

In `src/app/student/interviews/[id]/page.tsx`: add `meetingUrl: true` to the `slot` select, import `buttonClasses` from `@/components/ui/button`, and inside the "With" section's row, after the `PersonChip`:

```tsx
          {interview.slot.meetingUrl && (
            <a
              href={interview.slot.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses("secondary", "sm")}
            >
              Join meeting
            </a>
          )}
```

(a plain `<a>` with `buttonClasses`, not `LinkButton`: it leaves the app). Change the "booked" hint to: `{interview.slot.meetingUrl ? "You can mark it done once it starts." : "Arrange where to meet between you. You can mark it done once it starts."}`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/actions/interviews.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/interviews.ts src/lib/actions/interviews.test.ts src/components/forms/interview-forms.tsx "src/app/student/interviews/[id]/page.tsx"
git commit -m "An offered time can say where to meet"
```

---

### Task 4: Answer and feedback actions

**Files:**
- Modify: `src/lib/actions/interviews.ts`
- Modify: `src/lib/constants.ts` (`NOTIFICATION_TYPES`, `CATEGORY_OF`, `NOTIFICATION_META`)
- Test: `src/lib/actions/interviews.test.ts`

**Interfaces:**
- Consumes: `guideOpen`, `questionAt`, `NOTES_MAX` (Task 1), `templateById`; tables from Task 2.
- Produces (all `(_prev: ActionState, formData: FormData) => Promise<ActionState>`):
  - `saveInterviewAnswer` — fields `interviewId`, `questionIndex`, `text`
  - `saveInterviewFeedback` — fields `interviewId`, `summary`, `wentWell`, `toImprove` (draft)
  - `submitInterviewFeedback` — same fields; all three required
  - `NOTIFICATION_TYPES.PEER_INTERVIEW_FEEDBACK`

- [ ] **Step 1: Write the failing tests** — add the three names to the `await import("@/lib/actions/interviews")` destructure, then append:

```ts
describe("the guide", () => {
  /** An interview that started two hours ago, template Session 1. */
  async function liveScene() {
    const s = await scene();
    const past = await prisma.interviewSlot.create({
      data: { studentId: s.host.id, startsAt: wallHoursFromNow(-2), minutes: 45 },
    });
    const interview = await prisma.peerInterview.create({
      data: { slotId: past.id, hostId: s.host.id, guestId: s.guest.id, template: "freshman-session-1" },
    });
    return { ...s, interview };
  }

  const answer = (interviewId: string, questionIndex: string, text: string) =>
    saveInterviewAnswer(null, form({ interviewId, questionIndex, text }));

  const FULL = { summary: "Talked about books.", wentWell: "Clear examples.", toImprove: "Slow down." };

  it("keeps each student's answer to the same question apart, with its wording", async () => {
    const { host, guest, interview } = await liveScene();
    as(host);
    expect(await answer(interview.id, "0", "Host answer")).toMatchObject({ ok: true });
    as(guest);
    expect(await answer(interview.id, "0", "Guest answer")).toMatchObject({ ok: true });
    await answer(interview.id, "0", "Guest answer, edited");

    const rows = await prisma.interviewAnswer.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.studentId, r.text])).toEqual([
      [host.id, "Host answer"],
      [guest.id, "Guest answer, edited"],
    ]);
    expect(rows[0].question).toMatch(/^What are you reading/);
  });

  it("refuses a question the template does not have", async () => {
    const { host, interview } = await liveScene();
    as(host);
    expect(await answer(interview.id, "4", "x")).toMatchObject({ ok: false });
    expect(await answer(interview.id, "abc", "x")).toMatchObject({ ok: false });
  });

  it("refuses answers before the interview starts", async () => {
    const { guest, slot } = await scene();
    as(guest);
    await book(slot.id);
    const interview = await prisma.peerInterview.findUniqueOrThrow({ where: { slotId: slot.id } });

    expect(await answer(interview.id, "0", "early")).toMatchObject({ ok: false });
  });

  it("refuses a student who is not in the interview, on every action", async () => {
    const { p, interview } = await liveScene();
    const stranger = await student({ programId: p.id });
    as(stranger);
    const notYours = { ok: false, error: "That interview isn't one of yours." };

    expect(await answer(interview.id, "0", "x")).toEqual(notYours);
    expect(await saveInterviewFeedback(null, form({ interviewId: interview.id, ...FULL }))).toEqual(notYours);
    expect(await submitInterviewFeedback(null, form({ interviewId: interview.id, ...FULL }))).toEqual(notYours);
  });

  it("submits feedback once, completes the interview and tells the partner", async () => {
    const { host, guest, interview } = await liveScene();
    as(guest);
    await saveInterviewFeedback(null, form({ interviewId: interview.id, summary: "draft" }));
    await prisma.notification.deleteMany();

    expect(await submitInterviewFeedback(null, form({ interviewId: interview.id, ...FULL }))).toMatchObject({ ok: true });

    const fb = await prisma.interviewFeedback.findUniqueOrThrow({
      where: { interviewId_fromId: { interviewId: interview.id, fromId: guest.id } },
    });
    expect(fb).toMatchObject({ ...FULL });
    expect(fb.submittedAt).not.toBeNull();
    const done = await prisma.peerInterview.findUniqueOrThrow({ where: { id: interview.id } });
    expect(done.completedAt).not.toBeNull();
    const notice = await prisma.notification.findFirstOrThrow({ where: { userId: host.userId } });
    expect(notice.type).toBe("PEER_INTERVIEW_FEEDBACK");

    // Locked: a second submit and a later draft are both refused, and nothing moves.
    expect(await submitInterviewFeedback(null, form({ interviewId: interview.id, ...FULL, summary: "changed" }))).toMatchObject({ ok: false });
    expect(await saveInterviewFeedback(null, form({ interviewId: interview.id, summary: "changed" }))).toMatchObject({ ok: false });
    expect(await answer(interview.id, "0", "late")).toMatchObject({ ok: false });
    const after = await prisma.interviewFeedback.findUniqueOrThrow({ where: { id: fb.id } });
    expect(after.summary).toBe(FULL.summary);
    expect(after.submittedAt).toEqual(fb.submittedAt);
  });

  it("the second student can still finish after the first submits", async () => {
    const { host, guest, interview } = await liveScene();
    as(guest);
    await submitInterviewFeedback(null, form({ interviewId: interview.id, ...FULL }));
    const firstDone = (await prisma.peerInterview.findUniqueOrThrow({ where: { id: interview.id } })).completedAt;

    as(host);
    expect(await answer(interview.id, "2", "Still answering")).toMatchObject({ ok: true });
    expect(await submitInterviewFeedback(null, form({ interviewId: interview.id, ...FULL }))).toMatchObject({ ok: true });
    const done = await prisma.peerInterview.findUniqueOrThrow({ where: { id: interview.id } });
    expect(done.completedAt).toEqual(firstDone);
  });

  it("refuses to submit feedback with a box left empty", async () => {
    const { guest, interview } = await liveScene();
    as(guest);
    const result = await submitInterviewFeedback(
      null,
      form({ interviewId: interview.id, summary: "Only this" })
    );
    expect(result).toMatchObject({ ok: false });
    expect(await prisma.interviewFeedback.count({ where: { submittedAt: { not: null } } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/actions/interviews.test.ts -t "the guide"`
Expected: FAIL — `saveInterviewAnswer is not a function`.

- [ ] **Step 3: Add the notification type** in `src/lib/constants.ts`:
  - in `NOTIFICATION_TYPES`, after `PEER_INTERVIEW_CANCELLED`:
    `PEER_INTERVIEW_FEEDBACK: "PEER_INTERVIEW_FEEDBACK", // to the other student: their partner sent feedback on a practice interview`
  - in `CATEGORY_OF`, after `PEER_INTERVIEW_CANCELLED: "SESSIONS",`: `PEER_INTERVIEW_FEEDBACK: "SESSIONS",`
  - in `NOTIFICATION_META`, after the `PEER_INTERVIEW_CANCELLED` entry: `PEER_INTERVIEW_FEEDBACK: { label: "Interview feedback", tone: "brand" },`

- [ ] **Step 4: Implement** — in `src/lib/actions/interviews.ts`, extend `myInterview`'s select with `template: true` and `slot: { select: { startsAt: true, minutes: true } }` (already there), and `host`/`guest` user `name`:

```ts
      host: { select: { user: { select: { id: true, name: true } } } },
      guest: { select: { user: { select: { id: true, name: true } } } },
```

Add `guideOpen`, `questionAt` to the `@/lib/peer-interviews` import and `templateById` is already imported. Then append:

```ts
/** This student's own feedback row on an interview, if they have started one. */
async function myFeedback(interviewId: string, studentId: string) {
  return prisma.interviewFeedback.findUnique({
    where: { interviewId_fromId: { interviewId, fromId: studentId } },
    select: { submittedAt: true },
  });
}

const GUIDE_CLOSED: ActionState = {
  ok: false,
  error: "The guide opens at the start time and closes once you submit your feedback.",
};

/**
 * Save this student's own answer to one question. Called as the box loses
 * focus, so it is an upsert: the latest text wins, and the question's wording
 * is copied in the first time.
 */
export async function saveInterviewAnswer(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.profile.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview } = found;

  const mine = await myFeedback(interview.id, me.profile.id);
  if (!guideOpen(interview.slot, mine?.submittedAt ?? null, new Date())) return GUIDE_CLOSED;

  const questionIndex = Number(String(formData.get("questionIndex") ?? ""));
  const question = questionAt(templateById(interview.template), questionIndex);
  if (question === null) return { ok: false, error: "That question isn't in this interview." };

  const text = String(formData.get("text") ?? "").trim();
  if (text.length > NOTES_MAX) {
    return { ok: false, error: `An answer can be up to ${NOTES_MAX} characters.` };
  }

  await prisma.interviewAnswer.upsert({
    where: {
      interviewId_studentId_questionIndex: {
        interviewId: interview.id,
        studentId: me.profile.id,
        questionIndex,
      },
    },
    create: { interviewId: interview.id, studentId: me.profile.id, questionIndex, question, text },
    update: { text },
  });
  return { ok: true, message: "Saved." };
}

/** The three feedback boxes, trimmed, or the sentence refusing them. */
function readFeedback(
  formData: FormData
): { value: { summary: string; wentWell: string; toImprove: string } } | { error: string } {
  const value = {
    summary: String(formData.get("summary") ?? "").trim(),
    wentWell: String(formData.get("wentWell") ?? "").trim(),
    toImprove: String(formData.get("toImprove") ?? "").trim(),
  };
  if (Object.values(value).some((v) => v.length > NOTES_MAX)) {
    return { error: `Each box can be up to ${NOTES_MAX} characters.` };
  }
  return { value };
}

/** Save a feedback draft. Only its author reads it until it is submitted. */
export async function saveInterviewFeedback(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.profile.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview } = found;

  const mine = await myFeedback(interview.id, me.profile.id);
  if (!guideOpen(interview.slot, mine?.submittedAt ?? null, new Date())) return GUIDE_CLOSED;

  const read = readFeedback(formData);
  if ("error" in read) return { ok: false, error: read.error };
  const fields = {
    summary: read.value.summary || null,
    wentWell: read.value.wentWell || null,
    toImprove: read.value.toImprove || null,
  };

  // Create the row if missing, then write only while it is unsubmitted: a
  // submit in another tab between the check above and here stays as sent.
  await prisma.interviewFeedback.upsert({
    where: { interviewId_fromId: { interviewId: interview.id, fromId: me.profile.id } },
    create: { interviewId: interview.id, fromId: me.profile.id },
    update: {},
  });
  const { count } = await prisma.interviewFeedback.updateMany({
    where: { interviewId: interview.id, fromId: me.profile.id, submittedAt: null },
    data: fields,
  });
  if (count === 0) return GUIDE_CLOSED;
  return { ok: true, message: "Draft saved." };
}

/**
 * Hand the feedback to the partner. Final: the row is locked, the interview is
 * completed if the partner has not already, and the partner is told.
 */
export async function submitInterviewFeedback(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.profile.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview, side } = found;

  const mine = await myFeedback(interview.id, me.profile.id);
  if (!guideOpen(interview.slot, mine?.submittedAt ?? null, new Date())) return GUIDE_CLOSED;

  const read = readFeedback(formData);
  if ("error" in read) return { ok: false, error: read.error };
  if (!read.value.summary || !read.value.wentWell || !read.value.toImprove) {
    return { ok: false, error: "Fill in all three boxes before you submit.", values: read.value };
  }

  const other = side === "host" ? interview.guest.user : interview.host.user;
  const now = new Date();
  const submitted = await prisma.$transaction(async (tx) => {
    await tx.interviewFeedback.upsert({
      where: { interviewId_fromId: { interviewId: interview.id, fromId: me.profile.id } },
      create: { interviewId: interview.id, fromId: me.profile.id },
      update: {},
    });
    // The lock is this filter: a second submit racing the first finds
    // submittedAt already set and changes nothing.
    const { count } = await tx.interviewFeedback.updateMany({
      where: { interviewId: interview.id, fromId: me.profile.id, submittedAt: null },
      data: { ...read.value, submittedAt: now },
    });
    if (count === 0) return false;
    await tx.peerInterview.updateMany({
      where: { id: interview.id, completedAt: null },
      data: { completedAt: now },
    });
    await notify(tx, {
      to: [other.id],
      type: NOTIFICATION_TYPES.PEER_INTERVIEW_FEEDBACK,
      message: `${me.user.name ?? "Your classmate"} sent you feedback on your practice interview.`,
      href: `${INTERVIEWS}/${interview.id}`,
      actorId: me.user.id,
    });
    return true;
  });
  if (!submitted) return GUIDE_CLOSED;

  revalidatePath(INTERVIEWS, "layout");
  return { ok: true, message: "Feedback sent." };
}
```

Also update the `cancelInterview` confirm copy in `CancelInterviewButton` (`interview-forms.tsx`) to: `"Your classmate is told, any answers and feedback are deleted, and the time opens for others to book."`

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/actions/interviews.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/actions/interviews.ts src/lib/actions/interviews.test.ts src/lib/constants.ts src/components/forms/interview-forms.tsx
git commit -m "Each student keeps their own answers and hands their partner feedback"
```

---

### Task 5: Word-for-word dictation for answers

**Files:**
- Modify: `src/lib/dictation.ts` (`DictationKind`, `PROMPTS`)
- Modify: `src/app/api/notes/dictate/route.ts`
- Modify: `src/components/forms/dictate-button.tsx`
- Test: `src/app/api/notes/dictate/route.test.ts`

**Interfaces:**
- Produces: `DictationKind = "session" | "interview" | "answer"`; route field `purpose=answer`; `DictateButton` prop `purpose?: "answer"`.

- [ ] **Step 1: Write the failing test** — append inside the existing `describe` in `route.test.ts`:

```ts
  it("writes an answer down word for word when asked for one", async () => {
    const { host, interview } = await scene();
    actor.value = { id: host.userId };
    heard.calls = [];

    const response = await post({ interviewId: interview.id, purpose: "answer" });

    expect(response.status).toBe(200);
    expect(heard.calls).toEqual([{ names: ["Bekzod"], kind: "answer" }]);
  });

  it("still refuses an answer on somebody else's interview", async () => {
    const { p, interview } = await scene();
    const stranger = await student({ programId: p.id });
    actor.value = { id: stranger.userId };
    heard.calls = [];

    expect((await post({ interviewId: interview.id, purpose: "answer" })).status).toBe(403);
    expect(heard.calls).toEqual([]);
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/app/api/notes/dictate/route.test.ts`
Expected: FAIL — kind is `"interview"`, not `"answer"`.

- [ ] **Step 3: Implement.** In `src/lib/dictation.ts`, after `INTERVIEW_SYSTEM`:

```ts
/**
 * A student's spoken ANSWER to a practice question — the opposite job to the
 * two prompts above. Their partner will judge grammar, vocabulary, pace and
 * filler words from this text, so tidying it would erase exactly what is being
 * practised. Punctuation is the only thing added.
 */
const ANSWER_SYSTEM = `You are given a voice recording of a student answering a practice interview question in English. Write down exactly what they said.

Keep every word as spoken, including grammar mistakes, wrong word choices, filler words ("um", "uh", "like", "you know"), false starts and repetitions. Do not correct, shorten, summarise or improve anything. Add only punctuation and sentence breaks so it can be read.

Never add a word that was not said. If a word is unclear, write your best guess of what was actually said, not a better word.

Reply with the transcript and nothing else. No preamble, no quotation marks, no markdown. If the recording contains no speech, reply with nothing at all.`;
```

change the type to `export type DictationKind = "session" | "interview" | "answer";` and add `answer: ANSWER_SYSTEM,` to `PROMPTS`. Raise `max_tokens` in `ask` from `1000` to `1500` (two minutes of unedited speech with fillers runs past 300 words).

In `route.ts`, in the student branch replace `kind = "interview";` with:

```ts
    kind = form.get("purpose") === "answer" ? "answer" : "interview";
```

update the top doc comment's first paragraph to mention "or their spoken answer to a practice question", and change the 413 message to `"That recording is too long. Keep it under two minutes."`.

In `dictate-button.tsx`, add the prop

```ts
  /** "answer": transcribe word for word, mistakes kept. Default: a tidied note. */
  purpose?: "answer";
```

append `if (purpose) body.append("purpose", purpose);` after the `interviewId` append, and add `purpose` to the `useCallback` dependency array beside `interviewId`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/api/notes/dictate/route.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dictation.ts "src/app/api/notes/dictate/route.ts" "src/app/api/notes/dictate/route.test.ts" src/components/forms/dictate-button.tsx
git commit -m "A spoken answer is written down as it was said, mistakes and all"
```

---

### Task 6: The guide page

**Files:**
- Create: `src/app/student/interviews/[id]/live/page.tsx`
- Create: `src/components/forms/interview-guide.tsx`

**Interfaces:**
- Consumes: `saveInterviewAnswer`, `saveInterviewFeedback`, `submitInterviewFeedback` (Task 4); content constants (Task 1); `DictateButton` with `purpose="answer"` (Task 5); `guideOpen`, `formatSlotWhen` (peer-interviews).
- Produces: `InterviewGuide` client component with props
  `{ interviewId: string; partner: string; meetingUrl: string | null; questions: readonly string[]; answers: Record<number, string>; feedback: { summary: string; wentWell: string; toImprove: string }; canDictate: boolean }`.

Read `node_modules/next/dist/docs/` for the current `params` shape of dynamic segments before writing the page (the existing `[id]/page.tsx` awaits a `Promise<{ id: string }>` — follow it).

- [ ] **Step 1: Write the page** — `src/app/student/interviews/[id]/live/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";

import { InterviewGuide } from "@/components/forms/interview-guide";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { requireRole } from "@/lib/dal";
import { dictationConfigured } from "@/lib/dictation";
import { templateById } from "@/lib/interview-templates";
import { formatSlotWhen, hasStarted, sideOf } from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";

/**
 * The practice interview as it happens, opened beside the call: one step at a
 * time, the student's own answers, and the feedback they will hand over.
 *
 * Only this student's answers and feedback are selected — the partner's are
 * never loaded here, so they cannot leak into the payload. Not-yours and
 * not-found are the same 404.
 */
export default async function InterviewGuidePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole(ROLES.STUDENT);
  const { id } = await params;
  const now = new Date();

  const me = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!me || user.status !== USER_STATUS.ACTIVE) redirect("/student");

  const interview = await prisma.peerInterview.findUnique({
    where: { id },
    select: {
      id: true,
      hostId: true,
      guestId: true,
      template: true,
      slot: { select: { startsAt: true, meetingUrl: true } },
      host: { select: { user: { select: { name: true } } } },
      guest: { select: { user: { select: { name: true } } } },
      answers: {
        where: { studentId: me.id },
        select: { questionIndex: true, text: true },
      },
      feedback: {
        where: { fromId: me.id },
        select: { summary: true, wentWell: true, toImprove: true, submittedAt: true },
      },
    },
  });
  const side = interview ? sideOf(interview, me.id) : null;
  if (!interview || !side) notFound();

  const mine = interview.feedback[0] ?? null;
  if (mine?.submittedAt) redirect(`/student/interviews/${interview.id}`);

  const template = templateById(interview.template);
  const partner = (side === "host" ? interview.guest : interview.host).user.name ?? "your partner";
  const title = template?.name ?? "Practice interview";

  if (!hasStarted(interview.slot.startsAt, now)) {
    return (
      <div className="space-y-4">
        <PageTitle backHref={`/student/interviews/${interview.id}`} backLabel="Interview" title={title} />
        <Section title="Not started yet">
          <EmptyState framed={false} title={`Opens ${formatSlotWhen(interview.slot.startsAt)}`}>
            Come back at the start time to begin with {partner}.
          </EmptyState>
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageTitle backHref={`/student/interviews/${interview.id}`} backLabel="Interview" title={title} />
      <InterviewGuide
        interviewId={interview.id}
        partner={partner}
        meetingUrl={interview.slot.meetingUrl}
        questions={template?.questions ?? []}
        answers={Object.fromEntries(interview.answers.map((a) => [a.questionIndex, a.text]))}
        feedback={{
          summary: mine?.summary ?? "",
          wentWell: mine?.wentWell ?? "",
          toImprove: mine?.toImprove ?? "",
        }}
        canDictate={dictationConfigured()}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write the client stepper** — `src/components/forms/interview-guide.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DictateButton } from "@/components/forms/dictate-button";
import { Button, buttonClasses } from "@/components/ui/button";
import { GrowingField } from "@/components/ui/field";
import { Section } from "@/components/ui/section";
import {
  saveInterviewAnswer,
  saveInterviewFeedback,
  submitInterviewFeedback,
} from "@/lib/actions/interviews";
import type { ActionState } from "@/lib/actions/shared";
import {
  FEEDBACK_DISCUSS,
  FEEDBACK_PROMPTS,
  INTERVIEW_INTRO,
  INTERVIEW_RUBRIC,
  INTERVIEW_TURNS,
} from "@/lib/interview-templates";
import { NOTES_MAX } from "@/lib/peer-interviews";

type Feedback = { summary: string; wentWell: string; toImprove: string };

/**
 * One screen at a time, in the order the session is run: introductions, the
 * rubric, each question, then feedback. Each student moves at their own pace;
 * the two coordinate by talking.
 *
 * Everything typed is saved as the box loses focus and again on Next, so a
 * closed tab loses at most the box being typed in.
 */
export function InterviewGuide({
  interviewId,
  partner,
  meetingUrl,
  questions,
  answers: savedAnswers,
  feedback: savedFeedback,
  canDictate,
}: {
  interviewId: string;
  partner: string;
  meetingUrl: string | null;
  questions: readonly string[];
  answers: Record<number, string>;
  feedback: Feedback;
  canDictate: boolean;
}) {
  const router = useRouter();
  const steps = ["intro", "rubric", ...questions.map((_, i) => `q${i}`), "feedback"];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>(savedAnswers);
  const [feedback, setFeedback] = useState<Feedback>(savedFeedback);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const current = steps[step];
  const qIndex = current.startsWith("q") ? Number(current.slice(1)) : null;

  function send(action: (p: ActionState, f: FormData) => Promise<ActionState>, fields: Record<string, string>) {
    const data = new FormData();
    data.append("interviewId", interviewId);
    for (const [k, v] of Object.entries(fields)) data.append(k, v);
    return action(null, data);
  }

  function saveCurrent() {
    startTransition(async () => {
      const result =
        qIndex !== null
          ? await send(saveInterviewAnswer, { questionIndex: String(qIndex), text: answers[qIndex] ?? "" })
          : current === "feedback"
            ? await send(saveInterviewFeedback, feedback)
            : null;
      setMessage(result && !result.ok ? result.error : null);
    });
  }

  function go(to: number) {
    saveCurrent();
    setStep(to);
  }

  function submit() {
    startTransition(async () => {
      const result = await send(submitInterviewFeedback, feedback);
      if (result?.ok) {
        router.push(`/student/interviews/${interviewId}`);
      } else {
        setMessage(result?.error ?? "Could not send. Try again.");
      }
    });
  }

  const setBox = (key: keyof Feedback) => (value: string) =>
    setFeedback((was) => ({ ...was, [key]: value }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-fg">
          Step {step + 1} of {steps.length} · with {partner}
        </p>
        {meetingUrl && (
          <a href={meetingUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary", "sm")}>
            Join meeting
          </a>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full bg-brand transition-all" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
      </div>

      {current === "intro" && (
        <Section title="1. Introductions">
          <p className="px-4 py-2 text-sm text-ink sm:px-5">{INTERVIEW_INTRO}</p>
        </Section>
      )}

      {current === "rubric" && (
        <Section title="2. Review the feedback rubric" caption="Familiarize yourselves with the four evaluation criteria before starting the interview.">
          <Rubric />
        </Section>
      )}

      {qIndex !== null && (
        <Section title={`3. Interview practice · question ${qIndex + 1} of ${questions.length}`} caption={INTERVIEW_TURNS}>
          <div className="space-y-3 px-4 py-2 sm:px-5">
            <p className="text-base font-semibold text-ink">{questions[qIndex]}</p>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-fg">Your answer</span>
              {canDictate && (
                <DictateButton
                  interviewId={interviewId}
                  purpose="answer"
                  onText={(text) =>
                    setAnswers((was) => {
                      const before = (was[qIndex] ?? "").trim();
                      return { ...was, [qIndex]: before ? `${before} ${text}` : text };
                    })
                  }
                />
              )}
            </div>
            <GrowingField
              aria-label="Your answer"
              placeholder="Press Speak and answer out loud, or type"
              value={answers[qIndex] ?? ""}
              maxLength={NOTES_MAX}
              onChange={(e) => setAnswers((was) => ({ ...was, [qIndex]: e.target.value }))}
              onBlur={saveCurrent}
            />
          </div>
        </Section>
      )}

      {current === "feedback" && (
        <Section title="4. Partner feedback" caption={FEEDBACK_DISCUSS}>
          <div className="space-y-4 px-4 py-2 sm:px-5">
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-fg">The four criteria</summary>
              <Rubric />
            </details>
            <Box label="Summary" prompt={FEEDBACK_PROMPTS.summary} value={feedback.summary} onChange={setBox("summary")} onBlur={saveCurrent} />
            <Box label="What went well" prompt={FEEDBACK_PROMPTS.wentWell} value={feedback.wentWell} onChange={setBox("wentWell")} onBlur={saveCurrent} />
            <Box label="What to improve" prompt={FEEDBACK_PROMPTS.toImprove} value={feedback.toImprove} onChange={setBox("toImprove")} onBlur={saveCurrent} />
          </div>
        </Section>
      )}

      {message && <p className="text-sm text-danger-ink" role="alert">{message}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" disabled={step === 0 || pending} onClick={() => go(step - 1)}>
          Back
        </Button>
        {current === "feedback" ? (
          <Button disabled={pending} onClick={submit}>
            {pending ? "Sending…" : `Send feedback to ${partner}`}
          </Button>
        ) : (
          <Button disabled={pending} onClick={() => go(step + 1)}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

function Rubric() {
  return (
    <div className="grid gap-3 px-4 py-2 sm:grid-cols-2 sm:px-5">
      {INTERVIEW_RUBRIC.map((c) => (
        <div key={c.name}>
          <p className="text-sm font-semibold text-ink">{c.name}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-fg">
            {c.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Box({
  label,
  prompt,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  prompt: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-ink">{label}</p>
      <p className="text-xs text-muted-fg">{prompt}</p>
      <GrowingField
        aria-label={label}
        value={value}
        maxLength={NOTES_MAX}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
}
```

If `GrowingField` does not forward `onChange`/`onBlur`/`value` (check `src/components/ui/field.tsx:106`), use `Textarea` from the same file instead. If `Section` has no `caption` prop of type string, check `src/components/ui/section.tsx` and pass the text as the first child paragraph.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. (`check-copy.mjs` bans some phrases — fix any copy it flags, keeping the school's text verbatim.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/student/interviews/[id]/live" src/components/forms/interview-guide.tsx
git commit -m "A practice interview walks both students through it, one step at a time"
```

---

### Task 7: Results on the interview page

**Files:**
- Modify: `src/app/student/interviews/[id]/page.tsx`
- Modify: `src/lib/status.ts` (the `INTERVIEW_TO_MARK` explanation)

**Interfaces:**
- Consumes: `feedbackVisibleTo`, `guideOpen` (Task 1); tables (Task 2).

- [ ] **Step 1: Load this student's answers and both feedback rows.** In the page's `peerInterview.findUnique` select add:

```ts
      answers: {
        where: { studentId: me.id },
        select: { questionIndex: true, question: true, text: true },
        orderBy: { questionIndex: "asc" },
      },
      feedback: {
        select: { fromId: true, summary: true, wentWell: true, toImprove: true, submittedAt: true },
      },
```

(`answers` is filtered to this student in the query itself — the partner's are never fetched. Feedback is fetched for both, then filtered with `feedbackVisibleTo` before rendering; the partner's draft never reaches the client because only the filtered values are rendered in this server component.)

- [ ] **Step 2: Compute and render.** After `const phase = …`:

```ts
  const myFeedback = interview.feedback.find((f) => f.fromId === me.id) ?? null;
  const theirs = interview.feedback.find(
    (f) => f.fromId !== me.id && feedbackVisibleTo(f, me.id)
  ) ?? null;
  const canGuide = guideOpen(interview.slot, myFeedback?.submittedAt ?? null, now);
```

Under the "With" section add:

```tsx
      {canGuide && (
        <LinkButton href={`/student/interviews/${interview.id}/live`}>
          {interview.answers.length || myFeedback ? "Continue interview" : "Start interview"}
        </LinkButton>
      )}
```

Replace the existing `Questions` section so it shows only while the guide hasn't been used (`!interview.answers.length && !myFeedback?.submittedAt`), and add after it:

```tsx
      {interview.answers.length > 0 && (
        <Section title="Your answers" caption="Only you can see these.">
          <dl className="divide-y divide-line">
            {interview.answers.map((a) => (
              <div key={a.questionIndex} className="px-4 py-2 sm:px-5">
                <dt className="text-sm font-semibold text-ink">{a.question}</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-ink">{a.text || "—"}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {phase === "completed" || myFeedback?.submittedAt ? (
        <Section title={`Feedback from ${other.name ?? "your partner"}`}>
          {theirs?.submittedAt ? (
            <dl className="space-y-3 px-4 py-2 text-sm sm:px-5">
              <div><dt className="font-semibold text-ink">Summary</dt><dd className="whitespace-pre-wrap">{theirs.summary}</dd></div>
              <div><dt className="font-semibold text-ink">What went well</dt><dd className="whitespace-pre-wrap">{theirs.wentWell}</dd></div>
              <div><dt className="font-semibold text-ink">What to improve</dt><dd className="whitespace-pre-wrap">{theirs.toImprove}</dd></div>
            </dl>
          ) : (
            <EmptyState framed={false} title="Not sent yet">
              {other.name ?? "Your partner"} hasn&apos;t sent their feedback.
            </EmptyState>
          )}
        </Section>
      ) : null}
```

Import `LinkButton` from `@/components/ui/button`, `EmptyState` from `@/components/ui/empty-state`, and `feedbackVisibleTo`, `guideOpen` from `@/lib/peer-interviews`. Keep the existing Notes / Mark done / Cancel block unchanged.

In `src/lib/status.ts`, change the `INTERVIEW_TO_MARK` explanation to `"Start the interview, or mark it done to write your notes."`.

- [ ] **Step 3: Type-check, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean, all PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/student/interviews/[id]/page.tsx" src/lib/status.ts
git commit -m "After the interview, a student reads their answers and their partner's feedback"
```

---

### Task 8: End-to-end check

- [ ] **Step 1:** `npm run build` — expected: succeeds.
- [ ] **Step 2:** Use the `verify` skill (session-cookie login recipe) with two active students in the same program, and walk this:
  1. Student A offers a time 5 minutes ahead with `https://meet.google.com/abc-defg-hij`.
  2. Student B books it with "Freshman Interview Practice: Session 1". The interview page shows **Join meeting** and no Start button yet.
  3. Before the start time, open `/student/interviews/<id>/live`: it shows "Opens …" and no inputs.
  4. After the start time: both open the guide, step through intro → rubric → 4 questions → feedback. Type an answer, reload the page, and the answer is still there.
  5. B submits feedback. A's guide still accepts answers; A submits.
  6. On the interview page, each sees **Your answers** (their own only) and **Feedback from {partner}**. Check the page's HTML for A: B's answer text must not appear anywhere in it.
  7. As a third student, `/student/interviews/<id>/live` returns 404.
- [ ] **Step 3:** Speak button: only if `OPENROUTER_API_KEY` is set locally, record a short answer with a deliberate grammar slip and "um", and check both come back unchanged. If the key isn't set, say so in the report. Don't claim it was checked.
- [ ] **Step 4:** Report the results to the user. Do not push or merge. That is the user's call.
