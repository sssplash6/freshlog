# Practice interview guide — design

Date: 2026-09-27
Status: approved in conversation, awaiting spec review

## Why

Two students who book a practice interview (`/student/interviews`) meet
outside the app and get only a list of questions. The school runs these as a
structured session — introductions, a shared rubric, questions answered in
turn, then partner feedback — and wants the app to walk both students through
it while they talk on Google Meet, with an option to speak an answer and have
it written down.

## Decisions (made with the owner)

| Question | Decision |
|---|---|
| Where it runs | A freshform page opened beside the Meet call. **Not** a Meet add-on (no Google Cloud project, Marketplace listing, or per-student install; mic access inside a Meet add-on is unverified). |
| Do the two screens move together | No. Each student has their own copy and moves at their own pace; they coordinate by talking. No realtime. |
| Who sees what | A student's transcribed answers are private to them. The feedback a student writes about their partner is shown to that partner once submitted. Existing free notes stay private. |
| Question sets | Add "Freshman Interview Practice: Session 1". All sets, old and new, use the same guided flow and the same rubric. |
| Feedback form | As the school's text says, no scores: summary of partner's answers, what went well (first), what to improve. The four criteria are shown beside the boxes as prompts. |
| Step order | Intro → Rubric → Interview → Feedback. The source text lists feedback as step 3 but says "after completing the interview"; the screen follows the order it is done in. Wording is kept verbatim. |

## What the students see

### Where to meet

The "offer a time" form gains an optional **Meeting link** (`https://` only).
Once booked, the interview page shows a **Join meeting** button to its two
students. Classmates browsing open times never see the link.

### The guide — `/student/interviews/[id]/live`

Reached from a **Start interview** button on the interview page, shown from
the slot's start time until the interview is completed (after that, the
results live on the interview page). One step per screen, Back / Next, a
progress bar; built narrow so it sits beside Meet or on a phone.

1. **Introductions** — the school's prompt text.
2. **Feedback rubric** — Content, Flow & Structure, Grammar & Language,
   Confidence, each with its three questions.
3. **Interview practice** — "Take turns interviewing each other…", then the
   set's questions one per screen. Each has a text box for *your own* answer
   and a **Speak** button (the existing `DictateButton`) that appends what you
   said. The box saves itself on blur and on Next; a closed tab loses nothing
   already saved.
4. **Partner feedback** — Summary / What went well / What to improve, the four
   criteria alongside, "Discuss your feedback with each other before
   submitting." Drafts save like answers. **Submit** is final.

Submitting feedback marks the interview completed if the partner has not
already. The existing **Mark done** button stays on the interview page for
pairs who skip the guide.

### Afterwards — the interview page

- **Your answers** — question and transcript, visible only to you.
- **Feedback from {partner}** — shown once they submit; "Not submitted yet"
  before.
- **Your notes** — unchanged.

## Content

`src/lib/interview-templates.ts`:

- `INTERVIEW_RUBRIC` — the four criteria, each `{ name, questions[] }`, and
  the intro and feedback instructions, text exactly as the school wrote it.
  Shared by every template.
- New template `freshman-session-1`, "Freshman Interview Practice: Session 1",
  with its four questions. Listed first.

## Data (one migration)

- `InterviewSlot.meetingUrl String?`
- `InterviewAnswer` — `id`, `interviewId` → `PeerInterview` (cascade),
  `studentId` → `StudentProfile` (cascade), `questionIndex Int`, `question
  String` (the wording at the time, so an edited template never relabels an old
  answer), `text String`, timestamps. `@@unique([interviewId, studentId,
  questionIndex])`.
- `InterviewFeedback` — `id`, `interviewId` (cascade), `fromId` →
  `StudentProfile` (cascade), `summary`, `wentWell`, `toImprove` (all
  `String?`), `submittedAt DateTime?`, timestamps.
  `@@unique([interviewId, fromId])`.

No `programId`: like `PeerInterview`, these are two students rehearsing and
touch no ledger. Cancelling an interview deletes its answers and feedback by
cascade. `src/test/db.ts` resets both new tables.

## Rules and gates

Pure functions in `src/lib/peer-interviews.ts`, used by pages and actions
alike:

- `parseMeetingUrl(raw)` — empty → null; otherwise a valid `https:` URL of at
  most 500 characters, else an error.
- `questionAt(template, index)` — the question text or null; an answer to an
  index the template does not have is refused.
- `feedbackVisibleTo(feedback, studentId)` — the author always; the partner
  only when `submittedAt` is set.
- `canUseGuide(interview, now)` — started and not completed.

Every page calls `requireRole(ROLES.STUDENT)` on its first line, loads the
interview, then checks `sideOf`; not-yours and not-found are the same 404 /
the same error sentence (AGENTS.md).

Server actions in `src/lib/actions/interviews.ts`, each starting with
`activeStudent()` + `myInterview()`:

- `saveInterviewAnswer(interviewId, questionIndex, text)` — upsert own row
  only; guide must be open; text ≤ `NOTES_MAX`.
- `saveInterviewFeedback(interviewId, fields)` — upsert own row; refused once
  `submittedAt` is set.
- `submitInterviewFeedback(interviewId, fields)` — saves and sets
  `submittedAt` in one write scoped to `submittedAt: null`; then
  `updateMany({ completedAt: null })` on the interview; notifies the partner
  ("{name} sent you feedback on your practice interview").
- `addInterviewSlot` accepts `meetingUrl`.

The partner's answers are never selected by any page or action.

## Speak button

`/api/notes/dictate` already only transcribes for a student in the named
interview. It gains a `purpose=answer` field that selects a new
`DictationKind` **`answer`** with a prompt that writes down **exactly what was
said** — grammar mistakes and filler words kept, only punctuation added —
because the rubric asks the partner to judge those. Notes keep today's
tidying prompt. The audio limit stays at two minutes (the button's existing
cap; 5MB at 16kHz mono WAV); a longer answer is a second press, which appends.
The route's "under a minute" message is corrected to "two minutes".
Nothing is stored but the text the student keeps.

## Testing

- `peer-interviews.test.ts`: `parseMeetingUrl`, `questionAt`,
  `feedbackVisibleTo`, `canUseGuide`.
- `actions/interviews.test.ts`: answers saved per side and never readable by
  the partner; out-of-range question refused; feedback editable until submit
  and locked after; submit completes the interview once and notifies; an
  outsider is refused on every action; meeting link validated.
- `route.test.ts`: `purpose=answer` picks the verbatim prompt; still refused
  for an interview the student is not in.
- End to end with the `verify` skill: two students, offer with a Meet link,
  book, walk the guide on both, submit, check each sees partner feedback and
  not partner answers.

## Out of scope

- A real Google Meet add-on.
- Screens moving in lockstep.
- Scores, staff views of interviews, recording whole meetings.
