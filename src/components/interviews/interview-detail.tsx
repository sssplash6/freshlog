import { notFound } from "next/navigation";

import {
  CancelInterviewButton,
  EditFeedbackForm,
  InterviewNotesForm,
  MarkAbsentButton,
  MarkDoneButton,
} from "@/components/forms/interview-forms";
import { PersonChip } from "@/components/person-chip";
import { buttonClasses, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { dictationConfigured } from "@/lib/dictation";
import { formatDate } from "@/lib/format";
import type { InterviewViewer } from "@/lib/interview-viewer";
import { templateById } from "@/lib/interview-templates";
import {
  PHASE_STATUS,
  feedbackEditable,
  feedbackEditableUntil,
  feedbackVisibleTo,
  formatSlotSpan,
  formatSlotWhen,
  givesFeedback,
  guideClosedAt,
  guideOpen,
  interviewPhase,
  partOf,
  sideOf,
} from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import { status, type ViewerContext } from "@/lib/status";
import { formatTimeOfDay } from "@/lib/when";

/**
 * One practice interview, for one of the two people in it: who with, when,
 * the questions, and — once it has happened — this person's own notes.
 *
 * With a mentor, the two sides differ: the mentor asks and writes feedback,
 * the student answers and reads it (`partOf`).
 *
 * The row is loaded first and then asked whether the reader is in it; an
 * interview that is not theirs and one that does not exist are the same 404.
 */
export async function InterviewDetail({ viewer: v, id }: { viewer: InterviewViewer; id: string }) {
  const { now, base } = v;
  const viewer: ViewerContext = { audience: v.as, userId: v.user.id, now };
  const me = { id: v.user.id };

  const interview = await prisma.peerInterview.findUnique({
    where: { id },
    select: {
      id: true,
      hostId: true,
      guestId: true,
      mentorId: true,
      template: true,
      completedAt: true,
      absentId: true,
      hostNotes: true,
      guestNotes: true,
      slot: { select: { startsAt: true, minutes: true, meetingUrl: true } },
      host: { select: { id: true, name: true, avatarUpdatedAt: true } },
      guest: { select: { id: true, name: true, avatarUpdatedAt: true } },
      answers: {
        where: { userId: me.id },
        select: { questionIndex: true, question: true, text: true },
        orderBy: { questionIndex: "asc" },
      },
      // A partner's still-drafting feedback is never fetched, not just never
      // rendered: `feedbackVisibleTo` below would already keep it out of
      // `theirs`, but this query filters it out first.
      feedback: {
        where: { OR: [{ fromId: me.id }, { submittedAt: { not: null } }] },
        select: { fromId: true, summary: true, wentWell: true, toImprove: true, submittedAt: true },
      },
    },
  });
  const side = interview ? sideOf(interview, me.id) : null;
  if (!interview || !side) notFound();

  const other = side === "host" ? interview.guest : interview.host;
  const part = partOf(interview, me.id);
  const myNotes = (side === "host" ? interview.hostNotes : interview.guestNotes) ?? "";
  const template = templateById(interview.template);
  const phase = interviewPhase(interview, now);
  const chip = status(PHASE_STATUS[phase], viewer);
  const myFeedback = interview.feedback.find((f) => f.fromId === me.id) ?? null;
  const theirs = interview.feedback.find(
    (f) => f.fromId !== me.id && feedbackVisibleTo(f, me.id)
  ) ?? null;
  const closedAt = guideClosedAt(part, myFeedback?.submittedAt ?? null, interview.completedAt);
  const canGuide = guideOpen(interview.slot, closedAt, now, interview.absentId);
  const canEditFeedback = feedbackEditable(interview.slot, myFeedback?.submittedAt ?? null, now, interview.absentId);

  return (
    <div className="space-y-4">
      <PageTitle
        backHref={base}
        backLabel="Interviews"
        eyebrow={side === "host" ? "They booked your time" : "You booked their time"}
        title={template?.name ?? "Practice interview"}
        subtitle={`${formatSlotWhen(interview.slot.startsAt)} · ${formatSlotSpan(interview.slot)}`}
        actions={chip && <StatusChip status={chip} />}
      />

      <Section title="With">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <PersonChip person={{ ...other, email: "" }} />
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
          {canGuide && (
            <LinkButton href={`${base}/${interview.id}/live`}>
              {interview.answers.length || myFeedback ? "Continue interview" : "Start interview"}
            </LinkButton>
          )}
          {phase === "booked" && (
            <p className="text-xs text-muted-fg">
              {interview.slot.meetingUrl
                ? "You can mark it done once it starts."
                : "Arrange where to meet between you. You can mark it done once it starts."}
            </p>
          )}
        </div>
      </Section>

      {template && !interview.answers.length && !myFeedback?.submittedAt && (
        <Section title="Questions" count={template.questions.length} caption={template.summary}>
          <ol className="list-decimal space-y-2 py-3 pl-9 pr-4 text-body text-ink marker:text-muted-fg sm:pl-10 sm:pr-5">
            {template.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </Section>
      )}

      {interview.answers.length > 0 && (
        <Section title="Your answers" caption="Only you and your mentors can see these.">
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

      {canEditFeedback && myFeedback && (
        <Section title={`Your feedback to ${other.name ?? "your partner"}`} caption="Sent. Fix anything you missed while the interview is fresh.">
          <EditFeedbackForm
            interviewId={interview.id}
            saved={{
              summary: myFeedback.summary ?? "",
              wentWell: myFeedback.wentWell ?? "",
              toImprove: myFeedback.toImprove ?? "",
            }}
            until={formatTimeOfDay(feedbackEditableUntil(interview.slot), true) ?? ""}
          />
        </Section>
      )}

      {givesFeedback(partOf(interview, other.id)) && (phase === "completed" || myFeedback?.submittedAt) ? (
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

      {phase === "absent" ? (
        <Section title="Marked absent">
          <EmptyState framed={false} title={interview.absentId === me.id ? "You were marked absent" : `${other.name ?? "Your partner"} was marked absent`}>
            {interview.absentId === me.id
              ? `${other.name ?? "Your partner"} said you didn't join this interview, so it is closed.`
              : "You said they didn't join this interview, so it is closed."}
          </EmptyState>
        </Section>
      ) : phase === "completed" ? (
        <Section
          title="Notes"
          caption={interview.completedAt ? `Completed ${formatDate(interview.completedAt)}` : undefined}
        >
          <InterviewNotesForm
            interviewId={interview.id}
            saved={myNotes}
            canDictate={dictationConfigured()}
          />
        </Section>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {phase === "to-mark" && <MarkDoneButton interviewId={interview.id} />}
          {phase === "to-mark" && (
            <MarkAbsentButton interviewId={interview.id} partner={other.name ?? "your partner"} />
          )}
          <CancelInterviewButton interviewId={interview.id} />
        </div>
      )}
    </div>
  );
}
