> **Superseded by `REDESIGN.md`, 5 September 2026.**
>
> This was the brief that started the UX work. `REDESIGN.md` is what came out
> of it — the binding specification, 59 commits, all of them landed — and where
> the two disagree, `REDESIGN.md` governs. The roles listed below no longer
> exist as this file describes them: access is a per-program grant, not a role,
> and the `/leader` and `/sales` trees are gone.
>
> Kept because it records what was asked for, in the words it was asked in.
> Do not implement from this file.

# Claude Code Prompt: Freshform UX Upgrade

You are working in `/Users/workingmyassof/freshform`, a Next.js 16 + React 19 + Prisma 7 + SQLite + Auth.js application for Freshman Academy. It tracks mentoring hours, mentor sessions, scheduled interviews, assignments, feedback, programs, cohorts, and notifications.

Roles:

- Admin: cross-program operations, students, mentors, allocations, feedback
- Department leader: students, program dashboard, program feedback
- Sales: students and program dashboard
- Mentor: assigned students, sessions, interviews, feedback
- Student: remaining hours, meetings, bookings, tasks, feedback

Implement the UX upgrade below as a production-quality change. This is not a visual mockup. Preserve the existing Freshform visual language from `PRODUCT.md` and `DESIGN.md`: warm, precise, editorial, numbers-first, restrained containers, meaningful orange progress, blue actions, red warnings, and no generic SaaS dashboard styling.

## Required Preparation

Before editing:

1. Read `PRODUCT.md`, `DESIGN.md`, `README.md`, `TODO.md`, `CLAUDE.md`, and `AGENTS.md`.
2. Inspect `src/lib/dal.ts`, `src/lib/queries.ts`, `src/lib/actions/*`, `src/lib/nav.ts`, notification actions, role layouts, and existing UI primitives.
3. Preserve the existing role and program permission model. Server-side authorization remains mandatory.
4. Run `npm run lint`, `npx tsc --noEmit`, and `npm run build` before changes if the environment supports them. Record the baseline.
5. Do not replace the existing design system, create a parallel component library, or introduce a new frontend framework.
6. Existing `TODO.md` items are still relevant. Fold them into this work where they overlap, otherwise leave them for the remaining backlog.

## Scope

Implement these UX areas:

1. Role-based home dashboards
2. Persistent next-action states
3. Mentor preparation and operational checklist
4. Global status, freshness, and save-state indicators
5. Recovery from interruptions
6. Mentor/student operational command center
7. Upcoming timeline for sessions, interviews, and deadlines
8. Search, filtering, and useful saved views
10. Inline editing with explicit save state
12. Better empty states, without automatic direct-action buttons
13. Student home experience
14. Student progress center
16. More forgiving session and task-entry interaction
29. Notification center with categories

Do not add unrelated features such as SMS, Google Calendar/Meet integration, multi-program enrollment, or a staff-management system beyond what is necessary for these flows.

## Product Principles

- The user should know what requires attention within five seconds.
- Each role home should answer its core question first.
- The product tracks hours honestly. Never obscure, soften, or visually disguise a negative balance, missed session, expired allocation, or pending confirmation.
- Every mutation should explain what changed and what the user can do next.
- Never rely on color alone for status.
- Prefer inline progressive disclosure over modal-heavy workflows.
- Use plain language: `mentor`, `student`, `session`, `task`, `program`.
- Keep numbers visible, but do not turn every number into an identical card.
- Preserve keyboard access, visible focus, 44px touch targets, and reduced-motion behavior.

## Feature Requirements

### 1. Role-Based Home Dashboards

Improve the existing role homes rather than adding disconnected landing pages.

Student home (`/student`) must prioritize:

- Remaining mentoring time
- Next scheduled or pending interview
- Tasks that need work
- Deadlines and expiring allocations
- Latest logged session or change to balance
- Recent notifications

Admin home (`/admin`) must prioritize:

- Students pending approval
- Students low on hours or overdrawn
- Programs requiring attention
- Recent sessions and hour changes
- Unassigned mentors
- Upcoming deadlines and operational exceptions

Department leader and sales homes must prioritize:

- Their program's student count and remaining time
- Students needing attention
- Upcoming interviews and deadlines
- Recent changes relevant to their scope

Mentor home (`/mentor`) must prioritize:

- Today's and upcoming interviews
- Students requiring a session or follow-up
- Session logging state
- Students low on allocated time
- Tasks assigned to the mentor
- Booking-link completeness

Keep each role's key question above secondary history and detail. Avoid a repeated grid of generic stat cards.

### 2. Persistent Next-Action States

Create a shared typed model for actionable states. Do not scatter one-off conditionals and labels throughout pages.

Examples:

- Student registration awaiting approval
- Student has no remaining hours
- Allocation expires soon
- Interview awaiting student confirmation
- Interview needs mentor action
- Session needs logging
- Task is overdue
- Booking link missing
- Mentor unassigned
- Feedback awaiting response
- Weekly digest disabled

Each state should provide:

- Stable type
- Human-readable label
- Supporting explanation
- Tone/severity
- Optional destination
- Whether it is actionable, informational, or blocked

Use this consistently in dashboards, student rows, mentor rows, program pages, interview lists, and notifications.

### 3. Mentor Preparation and Operational Checklist

Give mentors a concise operational checklist on their home and student detail surfaces:

- Booking link configured
- Upcoming interviews reviewed
- Interviews awaiting confirmation
- Sessions ready to log
- Tasks needing progress updates
- Students with low or expired hours
- Feedback requiring attention

For each item, show the count and a short explanation. The checklist must reflect actual records and permission scope. Do not show a green “ready” state when data is incomplete.

### 4. Global Status, Freshness, and Save-State Indicators

Create shared patterns for:

- Loading
- Saving
- Saved, including last saved time
- Save failed with retry
- Data refreshed time
- Stale data
- Request failed
- Empty but healthy
- Permission denied

Use them for inline forms, session logging, student corrections, profile updates, booking links, interview responses, notification preferences, and dashboard data where refresh timing matters.

Errors that require action must remain visible inline. Toasts may supplement but must not be the only indication.

### 5. Recovery from Interruptions

Design recovery for:

- Losing a form submission during session logging
- Navigating away with unsaved student corrections
- Returning to a pending interview confirmation
- A failed avatar/profile update
- A stale dashboard after a role or allocation change
- A student returning after approval or allocation changes
- A mentor returning after a session was logged elsewhere

Show what was preserved, what was not, and how to retry. Do not invent client-side hour balances; reload server-derived data after successful mutations.

### 6. Mentor/Student Operational Command Center

Create a coherent workspace around the student relationship, reusing existing student detail pages and components.

For mentors, the workspace should bring together:

- Student identity and contact context
- Remaining allocation and deadline
- Upcoming interviews
- Recent sessions
- Tasks and progress
- Booking link
- Feedback context
- Log-session action

For staff, retain the broader administrative controls but make the same relationship visible without requiring users to visit multiple unrelated pages.

Do not duplicate query or mutation logic. Factor shared read models and components where useful.

### 7. Upcoming Timeline

Add a chronological “up next” view for each role, combining the relevant time-based objects:

- Interviews
- Session logging needs
- Task deadlines
- Allocation expiry dates
- Feedback follow-ups
- Weekly digest timing where relevant

Each item should show date/time, student or mentor, program, status, and a clear contextual label. Support today, next seven days, and overdue views. Preserve the calendar-like meaning of interviews and do not turn all history into one undifferentiated feed.

### 8. Search, Filtering, and Useful Saved Views

Add server-side search and filters to scalable lists:

- Admin students: name, email, program, cohort, status, balance state
- Mentor students: name, email, program, allocation state, deadline state
- Mentor sessions: student, date range, attendance, hour kind, status
- Admin feedback: status, program, mentor, date
- Interviews: status, date range, mentor, student

Requirements:

- Query and filtering must happen in Prisma, not by fetching everything and filtering in React.
- Preserve state in URL parameters so links and browser navigation work.
- Provide clear active-filter summaries and a reset control.
- Add pagination anywhere a list can grow without bound.
- Use existing `Pagination` patterns from the design system.
- Saved views may initially be URL presets; do not create a persistence model without a clear need.

### 10. Inline Editing with Explicit Save State

Audit profile, booking link, student correction, task, interview, allocation, and settings forms.

Each inline editor should communicate:

- Editing
- Unsaved changes
- Saving
- Saved with timestamp
- Failed with retry

Requirements:

- Warn before navigating away from meaningful unsaved changes.
- Preserve edits when independent fields save at different times.
- Do not silently overwrite a newer server value.
- Use field-scoped actions where appropriate.
- Keep keyboard workflows and visible focus.
- Make validation errors adjacent to the field that caused them.

### 12. Better Empty States

Improve empty states across all roles without adding automatic direct-action buttons in this task.

Each empty state should explain:

- What is empty
- Why it may be empty
- What the normal lifecycle is
- What the user should understand about the absence

Cover:

- No students
- No upcoming interviews
- No logged sessions
- No tasks
- No feedback
- No notifications
- No search results
- No assigned mentor
- No remaining hours
- No pending approvals

Avoid generic “Nothing here” copy and avoid making an empty state look like an error.

### 13. Student Home Experience

The student home must answer:

- How much time do I have left?
- What do I need to do next?
- When am I meeting someone?

Use the existing `HoursBreakdown`, `ScheduledMeetings`, `StudentJourney`, and `StudentGoals` components where they fit. Reorder or reshape the page so current obligations and upcoming meetings precede deep history.

Make pending approval, overdrawn balance, expired time, no mentor, and no upcoming meeting distinct states. Keep copy supportive but exact.

### 14. Student Progress Center

Improve the student-facing progress experience with:

- Remaining time and its components
- Completed, missed, expired, and extra time explained clearly
- Upcoming allocation deadlines
- Scheduled and completed interviews
- Task progress and overdue tasks
- Recent balance changes
- A readable history of sessions
- Clear distinction between “nothing scheduled” and “nothing available”

Do not use gamification, streaks, confetti, or motivational pressure. The progress view should help students make a practical next decision.

### 16. More Forgiving Session and Task Entry

Improve mentor and staff data entry without changing domain rules:

- Searchable student selection
- Keyboard navigation through fields
- Clear attendance consequences
- Clear in-plan versus extra consequences
- Remember safe defaults without hiding them
- Inline validation before submit
- Prevent accidental duplicate submissions
- Preserve entered values after a failed submission
- Clear success receipt after logging
- Easy path to edit or void where permitted
- Task selection that explains why it is relevant

For student corrections and interview responses, keep the same principles: clear current value, clear proposed value, visible save state, and no lost input.

### 29. Notification Center with Categories

Extend the existing notification center and notification model with useful categories and controls:

- Unread count
- Mark one read
- Mark all read
- Category filtering
- Read/unread filtering
- Timestamp and actor where relevant
- Destination link
- Empty state
- Clear notification preference controls

Initial categories:

- Hours changed
- Session logged
- Session missed or voided
- Interview scheduled
- Interview confirmed or declined
- Task assigned or updated
- Student approval
- Allocation deadline
- Feedback received or responded to
- Weekly summary

Keep the existing email preference behavior. Do not add SMS. Preserve notification history and make category labels understandable to students.

## Verification Requirements

Add or update tests for:

- Role-specific dashboard data and access
- Next-action derivation
- Checklist counts and permission scoping
- Freshness and save-state transitions
- Search/filter query construction
- URL-preserved filters and pagination
- Empty-state branches
- Student progress calculations
- Session-entry validation and duplicate protection
- Notification categories and read/unread behavior

Use browser verification for critical flows:

- Student sees remaining hours, next meeting, and pending task
- Mentor finds a student through search and logs a session without losing input
- Staff filters students to find low balances
- A failed mutation remains visible and retryable
- A notification can be filtered, opened, and marked read
- A narrow viewport remains usable without horizontal table scrolling
- Keyboard-only navigation works for the main forms

Run `npm run lint`, `npx tsc --noEmit`, and `npm run build` after implementation. Verify reduced motion, focus restoration, validation messaging, responsive layouts, and server-derived values.

## Completion Standard

The work is complete only when:

- Every role has a task-oriented home experience.
- Users can identify their next action without reading the entire page.
- Major lists can be searched and filtered without client-side loading of unbounded data.
- Mutations visibly communicate saving, success, failure, and recovery.
- Student hour balances and status remain exact and trustworthy.
- Existing permissions and domain rules remain intact.
- Empty, loading, error, stale, and success states are all designed.
- The final summary lists changed files, tests run, remaining limitations, and deliberate tradeoffs.
