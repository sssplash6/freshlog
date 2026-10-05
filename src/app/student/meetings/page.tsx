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
            className="text-[0.9375rem] font-medium"
          >
            Practice interviews
          </ArrowLink>
        }
      >
        {interviews.length === 0 ? (
          <EmptyState framed={false} title="Nothing booked">
            Book a classmate&apos;s time on the interviews page.
          </EmptyState>
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
                      // A quiet Rate link, and only where a rating would make
                      // sense — a voided session is a meeting that did not
                      // happen, so there is nobody's evening to grade. Once
                      // the row shows its stars (the same condition as
                      // `SessionRow`'s own), the link says "Change rating".
                      session.status !== SESSION_STATUS.VOIDED ? (
                        <Link
                          href={`/student/feedback?mentor=${session.mentor.id}`}
                          className="text-[0.8125rem] font-medium text-brand hover:text-brand-dark"
                        >
                          {session.studentAnswer && session.studentRating
                            ? "Change rating"
                            : "Rate"}
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
            <Pagination
              basePath="/student/meetings"
              params={params}
              page={page}
              pageSize={MEETINGS_PER_PAGE}
              total={entries.length}
              unit="sessions"
              note={notHeldNote(entries)}
              className="border-t border-line px-4 py-2 sm:px-5"
            />
          </>
        )}
      </Section>
    </div>
  );
}
