import Link from "next/link";
import { redirect } from "next/navigation";

import { SessionAnswerForm } from "@/components/forms/session-answer-form";
import { PersonCell } from "@/components/person-chip";
import { SessionRow } from "@/components/session-row";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLink } from "@/components/ui/link";
import { PageTitle, Section } from "@/components/ui/section";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { StatusChip } from "@/components/ui/status-chip";
import { SESSION_STATUS, ROLES, USER_STATUS } from "@/lib/constants";
import { withoutMentorNotes } from "@/lib/authz";
import { requireRole } from "@/lib/dal";
import { readParam, type SearchParams } from "@/lib/filters";
import { templateName } from "@/lib/interview-templates";
import {
  PHASE_STATUS,
  formatSlotWhen,
  interviewPhase,
  sideOf,
} from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import { studentLedger } from "@/lib/queries";
import {
  notHeldNote,
  sessionsCaption,
  toSessionEntries,
} from "@/lib/session-entries";
import {
  sessionStatuses,
  status,
  type ViewerContext,
} from "@/lib/status";
import { programWallClock } from "@/lib/when";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Meetings" };

/** Sessions per page — the spec's count for a history a student scrolls. */
const MEETINGS_PER_PAGE = 20;

/**
 * The student's meetings: what is coming, and what already happened.
 *
 * Two different things share the name, and the page keeps them honest about
 * it. "Coming up" is booked practice interviews — the only thing in the app a
 * student can schedule ahead. (Mentors do not book meetings here; a session
 * exists once it has been logged, so nothing a mentor plans can appear on
 * this page before it happens.) "Past sessions" is the ledger they already
 * met on the home disclosure, all of it now, paged.
 *
 * The page's one job is §6.5's: every session waits for the student's answer,
 * and a row inside the confirm window carries the "Did this happen?" form on
 * its face rather than behind a link. The chip and the form are the same
 * question — `SESSION_UNCONFIRMED` decides both, so a row can never wear the
 * chip without offering the answer.
 */
export default async function StudentMeetingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole(ROLES.STUDENT);
  const now = new Date();
  const viewer: ViewerContext = { audience: "student", userId: user.id, now };
  const params = await searchParams;

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, telegramUsername: true },
  });
  // The same unfinished account the home page sends to /onboarding — a
  // PENDING student has no sessions to answer for.
  if (
    !profile ||
    !user.name?.trim() ||
    !profile.telegramUsername ||
    user.status === USER_STATUS.PENDING
  ) {
    redirect("/onboarding");
  }

  const wallNow = programWallClock(now);
  const [ledger, interviews] = await Promise.all([
    studentLedger(profile.id),
    prisma.peerInterview.findMany({
      where: {
        OR: [{ hostId: profile.id }, { guestId: profile.id }],
        completedAt: null,
        slot: { startsAt: { gt: wallNow } },
      },
      select: {
        id: true,
        hostId: true,
        guestId: true,
        template: true,
        slot: { select: { startsAt: true, minutes: true } },
        host: {
          select: {
            user: { select: { id: true, name: true, avatarUpdatedAt: true } },
          },
        },
        guest: {
          select: {
            user: { select: { id: true, name: true, avatarUpdatedAt: true } },
          },
        },
      },
      orderBy: { slot: { startsAt: "asc" } },
    }),
  ]);

  // The mentor's note is the subject's business to have happened, not to read —
  // stripped before anything renders, as on the home page.
  const held = withoutMentorNotes(ledger.sessions);
  const entries = toSessionEntries(held, { mentorBase: "/mentors" });

  // Answering is the point of the page, so the predicate is the chip's own:
  // where `sessionStatuses` would pin "Waiting for your answer", the form
  // that answers it mounts under the same row. `held` keeps the raw fields —
  // `studentAnswer`, `withinPlan`, `status` — the check reads.
  const needsAnswer = new Set(
    held
      .filter((s) =>
        sessionStatuses(s, viewer).some((x) => x.type === "SESSION_UNCONFIRMED")
      )
      .map((s) => s.id)
  );

  const page = parsePage(readParam(params, "page"));
  const shown = entries.slice(
    (page - 1) * MEETINGS_PER_PAGE,
    page * MEETINGS_PER_PAGE
  );
  const rawById = new Map(held.map((s) => [s.id, s]));

  return (
    <div className="space-y-4">
      <PageTitle backHref="/student" backLabel="Home" title="Meetings" />

      <Section
        title="Coming up"
        count={interviews.length || undefined}
        action={
          <ArrowLink
            href="/student/interviews"
            className="text-body font-medium"
          >
            Interviews
          </ArrowLink>
        }
      >
        {interviews.length === 0 ? (
          // Says where a booked MENTOR meeting is too. Booking happens on the
          // mentor's own calendar, outside this app, so a student who had
          // just booked one came here, found "Nothing booked", and assumed
          // it had not gone through.
          <p className="px-4 py-3 text-xs text-muted-fg sm:px-5">
            No practice interviews booked. Booked a mentor? That meeting lives
            in your calendar invite, and shows up below once your mentor logs
            it.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {interviews.map((i) => {
              const side = sideOf(i, profile.id);
              const other = side === "host" ? i.guest.user : i.host.user;
              const chip = status(
                PHASE_STATUS[
                  interviewPhase({ slot: i.slot, completedAt: null }, now)
                ],
                viewer
              );
              return (
                <li
                  key={i.id}
                  className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 sm:px-5"
                >
                  <PersonCell
                    person={{ ...other, email: "" }}
                    href={`/student/interviews/${i.id}`}
                    secondary={`${templateName(i.template)} · ${formatSlotWhen(i.slot.startsAt)}`}
                    className="min-w-0 flex-1"
                  />
                  {chip && <StatusChip status={chip} className="shrink-0" />}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        title="Past sessions"
        caption={entries.length > 0 ? sessionsCaption(entries) : undefined}
      >
        {entries.length === 0 ? (
          <EmptyState framed={false} title="No sessions yet">
            Your mentors log each meeting once it has happened.
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line px-4 sm:px-5">
              {shown.map((session, i) => {
                const raw = rawById.get(session.id);
                const mentorName =
                  raw?.mentor.name ?? raw?.mentor.email ?? "your mentor";
                return (
                  <SessionRow
                    key={session.id}
                    session={session}
                    viewer={viewer}
                    variant="timeline"
                    index={i}
                    actions={
                      // A quiet link to rate the mentor, only on a meeting
                      // that actually happened: not a voided or rescheduled
                      // one, not a no-show, and not a row still asking "Did
                      // this happen?" — one question per row. It rates the
                      // MENTOR (the feedback form has no session), so it says
                      // who, and no longer flips to "Change rating" off this
                      // session's own stars, which it never edited.
                      session.status === SESSION_STATUS.ACTIVE &&
                      session.attended &&
                      !needsAnswer.has(session.id) ? (
                        <Link
                          href={`/student/feedback?mentor=${session.mentor.id}`}
                          className="inline-flex min-h-11 items-center text-xs font-medium text-brand hover:text-brand-dark"
                        >
                          Rate {mentorName.split(" ")[0]}
                        </Link>
                      ) : undefined
                    }
                    footer={
                      needsAnswer.has(session.id) ? (
                        <SessionAnswerForm
                          sessionId={session.id}
                          mentorName={mentorName}
                        />
                      ) : undefined
                    }
                  />
                );
              })}
            </ul>
            {/* Only when there is a second page to reach. On one page its
                "5 sessions · 1 rescheduled" was a second count, in a second
                vocabulary, of the list the heading had just counted as
                "4 meetings". */}
            {entries.length > MEETINGS_PER_PAGE && (
              <Pagination
                basePath="/student/meetings"
                params={params}
                page={page}
                pageSize={MEETINGS_PER_PAGE}
                total={entries.length}
                unit="meetings"
                note={notHeldNote(entries)}
                className="border-t border-line px-4 py-2 sm:px-5"
              />
            )}
          </>
        )}
      </Section>
    </div>
  );
}
