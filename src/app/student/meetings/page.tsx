import { redirect } from "next/navigation";

import { InterviewResponse } from "@/components/forms/interview-response";
import { SessionAnswerForm } from "@/components/forms/session-answer-form";
import { SessionRow } from "@/components/session-row";
import { Timeline, type TimelineEntry } from "@/components/timeline";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLink } from "@/components/ui/link";
import { PageTitle, Section } from "@/components/ui/section";
import {
  CONFIRM_WINDOW_DAYS,
  INTERVIEW_STATUS,
  ROLES,
  SESSION_STATUS,
  interviewIsOpen,
} from "@/lib/constants";
import { requireRole } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { studentLedger, studentMeetings } from "@/lib/queries";
import { meetingStatus, type ViewerContext } from "@/lib/status";
import { bucketOf } from "@/lib/when";

/**
 * A student's meetings, ahead and behind.
 *
 * This page is why the home page could get short. `StudentJourney` put thirteen
 * unpaginated past sessions — about 1,200px — under everything a student
 * actually opens the app for, and removing it from the home left the history
 * with nowhere to be: the component was orphaned and a student could no longer
 * see a single past session anywhere in the app.
 *
 * Two lists, because "still to come" and "already happened" are two different
 * questions and only one of them has anything to answer. Coming up carries the
 * answer buttons; the past is a read-only rail.
 */
export default async function StudentMeetingsPage() {
  const user = await requireRole(ROLES.STUDENT);
  const now = new Date();
  const viewer: ViewerContext = { audience: "student", userId: user.id, now };

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!profile) redirect("/onboarding");

  const [meetings, ledger] = await Promise.all([
    studentMeetings(profile.id),
    studentLedger(profile.id),
  ]);

  const open = meetings.filter(interviewIsOpen);
  const upcoming: TimelineEntry[] = open.map((m) => {
    // A meeting whose day has gone cannot be answered — saying "I can't make
    // it" about last Tuesday is not an answer to anything — so the row states
    // whose move it is instead. The component this replaced had this right and
    // hid its buttons on a passed row.
    const passed = bucketOf(m.scheduledAt, now) === "overdue";
    const state = meetingStatus(
      {
        id: m.id,
        status: m.status,
        scheduledAt: m.scheduledAt,
        sessionId: m.sessionId,
      },
      viewer
    );
    return {
      id: m.id,
      at: m.scheduledAt,
      hasTime: m.hasTime,
      timePending: !m.hasTime,
      // The buttons state the answer, so a chip repeating it is the same fact
      // twice. A meeting still waiting for one, or one already past, keeps its
      // chip — otherwise the row would say nothing at all.
      status:
        passed || m.status === INTERVIEW_STATUS.PROPOSED ? state : undefined,
      person: m.mentor,
      joinUrl: m.link,
      note: m.note,
      action: passed ? undefined : (
        <InterviewResponse interviewId={m.id} status={m.status} />
      ),
    };
  });

  // Every session the student has had, whoever logged it. The rail reads
  // backwards from the most recent, which is the order `studentLedger` returns.
  const past = ledger.sessions;

  /**
   * Whether this row still has a question in it.
   *
   * The same three conditions `sessionStatuses` uses to raise the chip, so the
   * row cannot say "Confirm this session" and then offer no way to. A month,
   * after which it stops asking: an unanswered session from March is not a job
   * anybody is going to do.
   */
  const needsAnswer = (s: (typeof past)[number]) =>
    s.status === SESSION_STATUS.ACTIVE &&
    s.withinPlan &&
    !s.studentAnswer &&
    (now.getTime() - s.date.getTime()) / 86_400_000 <= CONFIRM_WINDOW_DAYS;

  return (
    <div className="space-y-6">
      <PageTitle
        backHref="/student"
        backLabel="Home"
        title="Meetings"
        actions={<ArrowLink href="/student/book">Book a session</ArrowLink>}
      />

      {/* Every bucket, unlike the home page: this is the page a student comes
          to for the whole picture, including the meeting last Tuesday that is
          still waiting on a mentor to write up. */}
      <Timeline
        entries={upcoming}
        now={now}
        title="Coming up"
        buckets={["overdue", "today", "week", "later"]}
        empty="Nothing scheduled. Your mentors schedule meetings here."
      />

      <Section title="Past sessions" count={past.length || undefined}>
        {past.length === 0 ? (
          <EmptyState framed={false} title="No sessions yet">
            Your first one will be here once a mentor logs it.
          </EmptyState>
        ) : (
          <ul className="px-4 py-4 sm:px-5">
            {past.map((s, i) => (
              <SessionRow
                key={s.id}
                variant="timeline"
                viewer={viewer}
                index={i}
                session={{
                  id: s.id,
                  date: s.date,
                  minutes: s.minutes,
                  attended: s.attended,
                  late: s.late,
                  status: s.status,
                  withinPlan: s.withinPlan,
                  note: s.note,
                  studentAnswer: s.studentAnswer,
                  studentRating: s.studentRating,
                  studentNote: s.studentNote,
                  mentor: s.mentor,
                  task: s.assignment,
                }}
                // The one write on this page, and only where there is
                // something to answer: a live, in-plan session they have not
                // spoken about yet. An extra hour given on top of the plan
                // charged nothing, so there is no balance to agree with; a
                // voided one has already been taken back.
                actions={
                  needsAnswer(s) ? (
                    <SessionAnswerForm
                      sessionId={s.id}
                      mentorName={s.mentor.name ?? s.mentor.email}
                    />
                  ) : undefined
                }
              />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
