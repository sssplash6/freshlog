# Partner feedback forms — design

Date: 2026-10-22.

## Why

Freshman Academy teaches SAT classes together with Cana, a partner school.
Cana's students are not Freshform users — no account, no enrollment, no hours —
but the school wants their feedback on the mentors who teach them and on each
class session, and wants to read it in Freshform next to everything else.

Cana is the first such partner, not the last, so the feature is generic: a
**partner** is a named, slugged form with its own email list, its own mentors and
its own feedback. Cana is `/f/cana`.

## Goal

A Cana student opens a link they were sent, types their email, and — if it is
on the list — rates a mentor or a session in under a minute, without signing in.
A platform admin reads every rating in one place, filtered any way they need.

## Decisions already made

| Question | Decision |
|---|---|
| Who the students are | **Outsiders known only by email.** An allow-list per partner, pasted in by an admin. Not `User`, not `StudentProfile`. |
| Cana-only or generic | **Generic partners.** Cana is one row. |
| How students reach it | **A deep link** on the existing domain: `/f/[slug]`, plus `/f/[slug]/mentor` and `/f/[slug]/session` that skip the choice. No subdomain, nothing in the sidebar or any nav. |
| How the email is checked | **Match only.** No emailed code. The page never reveals whether *other* emails exist beyond answering for the one typed, and never shows past feedback. |
| Mentor-wise: which mentors | **Freshform mentor accounts an admin picks per partner.** |
| Session-wise: which session | **The student types the session number.** No admin-made session list. |
| Session-wise: name | **Required.** Mentor-wise asks no name (the email identifies the writer to admins). |
| Rating | **1–5 stars**, both kinds. Feedback text required, both kinds. |
| Who reads it | **Platform admins only** (`requirePlatformAdmin`). Mentors do not see partner feedback in this version. |

## Data

Four new tables. None of them touches the ledger (`HourAllocation`, `Session`,
…), `StudentProfile`, or the existing `MentorFeedback`, and none carries a
`programId`: a partner is not a program, and its feedback is not a student's
feedback in the AGENTS.md sense.

```prisma
model FeedbackPartner {
  id        String   @id @default(cuid())
  slug      String   @unique // the deep link: /f/<slug>; lowercase a–z, 0–9, "-"
  name      String           // "Cana"
  active    Boolean  @default(true)
  createdAt DateTime @default(now())

  students PartnerStudent[]
  mentors  PartnerMentor[]
  feedback PartnerFeedback[]
}

model PartnerStudent {
  id        String   @id @default(cuid())
  partnerId String
  email     String   // stored trimmed and lowercased
  createdAt DateTime @default(now())

  partner FeedbackPartner @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  @@unique([partnerId, email])
}

model PartnerMentor {
  partnerId String
  mentorId  String

  partner FeedbackPartner @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  mentor  User            @relation(fields: [mentorId], references: [id])
  @@id([partnerId, mentorId])
}

enum PartnerFeedbackKind { MENTOR SESSION }

model PartnerFeedback {
  id            String              @id @default(cuid())
  partnerId     String
  kind          PartnerFeedbackKind
  studentEmail  String              // copied, not a FK: removing an email from the list keeps its feedback
  mentorId      String?             // MENTOR only
  sessionNumber Int?                // SESSION only, ≥ 1
  name          String?             // SESSION only, required there
  rating        Int                 // 1–5
  comment       String
  createdAt     DateTime            @default(now())

  partner FeedbackPartner @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  mentor  User?           @relation("PartnerFeedbackMentor", fields: [mentorId], references: [id])
  @@index([partnerId, createdAt])
}
```

Removing an email from the list stops new feedback from it; what it already
wrote stays. Unticking a mentor removes them from the dropdown; their feedback
stays and is still filterable.

## Student side — `/f/[slug]`

Public. `/f` is added to `PUBLIC_PATHS` in `src/proxy.ts`. Unknown slug or
inactive partner → the ordinary 404, identical for both, so slugs cannot be
probed for "exists but off".

1. **Email.** One field, "Your email". On submit the server action normalises it
   and looks it up in that partner's list.
   - Not on the list: "This email isn't on the list for Cana. Check the address,
     or ask your coordinator to add it." The form stays filled.
   - On the list: a cookie `pf_<slug>` is set, holding the email and an expiry
     (12 hours), HMAC-signed with the app secret the way unsubscribe tokens are
     (`src/lib/email/unsubscribe.ts`). HttpOnly, SameSite=Lax, path `/f/<slug>`.
2. **Choose.** "Rate a mentor" / "Rate a session". Skipped by the `/mentor` and
   `/session` links. A "Not you?" link clears the cookie.
3. **Form.**
   - Mentor: mentor dropdown (that partner's mentors, by display name), stars,
     feedback.
   - Session: session number, your name, stars, feedback.
4. **Done.** "Thanks — your feedback was sent." with "Leave another".

Every submit re-checks, inside the action and not just on the page: the cookie's
signature and expiry, that the partner is still active, that the email is still
on its list, that the mentor (MENTOR) is still one of its mentors, and the field
rules (rating 1–5 integer; comment non-empty, ≤ 2000 chars; session number
integer 1–999; name non-empty, ≤ 100 chars). A failed cookie check sends the
student back to step 1 rather than erroring.

The pages are mobile-first (students open the link on their phones from
Telegram), carry no app chrome — no sidebar, no account menu — and use the
existing form components and `Rating` input.

## Admin side — `/partners`

Platform admins only. Every page calls `requirePlatformAdmin()` on its first
line, and every action re-checks it (AGENTS.md: gate every page). Linked from
nowhere for now; reached by URL.

- **`/partners`** — the partners: name, link, active, email count, feedback
  count, average. "New partner" (name, slug).
- **`/partners/[slug]`** — the comprehensive view:
  - Summary: total feedback, average rating, last 7 days.
  - By mentor: each mentor's count and average, **worst average first** (the
    same ordering `/feedback` uses, for the same reason).
  - By session: each session number's count and average, ascending by number.
  - All feedback: a table — date, kind, mentor or session #, name, email,
    stars, feedback (expandable) — with filters for kind, mentor, session
    number, rating, date range, and email/name search; paginated. Built from
    `FilterBar`, `Table`, `Pagination`, `ExpandableText`, `Rating`.
- **`/partners/[slug]/settings`** — the email list (paste many, one per line or
  comma-separated; shows how many were added and how many were already there or
  invalid; remove one), mentors (tick from active mentors), the deep links with
  copy buttons, rename, and active on/off.

Summaries respect the active filters, so "session 4, last week" reads its own
average.

## Out of scope

Mentors seeing their partner feedback, emailed confirmation codes, subdomains,
CSV export, editing or deleting a submitted rating, a nav entry. Each is a small
follow-up if asked for.

## Testing

Action tests (the existing `src/test/db.ts` harness):

- email not on the list → refused, no cookie;
- email on the list in different case/whitespace → accepted;
- inactive or unknown partner → refused;
- tampered or expired cookie → refused, sent back to the email step;
- email removed from the list after the cookie was set → refused;
- MENTOR with a mentor not on that partner → refused;
- SESSION without name or number, rating 0 or 6, empty comment → refused;
- a valid submission stores exactly one row with the right partner;
- every admin action and page refuses a non-platform-admin.

Then `/verify`: create Cana, paste emails, tick a mentor, submit both kinds on
a phone-width viewport, read and filter them on `/partners/cana`.

## Changelog

One `### New` entry for admins: partner feedback forms, starting with Cana.
