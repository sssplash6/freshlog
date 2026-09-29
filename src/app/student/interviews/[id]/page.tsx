import { notFound, redirect } from "next/navigation";

import {
  CancelInterviewButton,
  InterviewNotesForm,
  MarkDoneButton,
} from "@/components/forms/interview-forms";
import { PersonChip } from "@/components/person-chip";
import { buttonClasses, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { requireRole } from "@/lib/dal";
import { dictationConfigured } from "@/lib/dictation";
import { formatDate } from "@/lib/format";
import { templateById } from "@/lib/interview-templates";
import {
  PHASE_STATUS,
  feedbackVisibleTo,
  formatSlotSpan,
  formatSlotWhen,
  guideOpen,
  interviewPhase,
  sideOf,
} from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import { status, type ViewerContext } from "@/lib/status";

/**
 * One practice interview, for one of the two students in it: who with, when,
 * the questions, and — once it has happened — this student's own notes.
 *
 * The row is loaded first and then asked whether the reader is in it; an
 * interview that is not theirs and one that does not exist are the same 404.
 */
export default async function InterviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole(ROLES.STUDENT);
  const { id } = await params;
  const now = new Date();
  const viewer: ViewerContext = { audience: "student", userId: user.id, now };

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
      completedAt: true,
      hostNotes: true,
      guestNotes: true,
      slot: { select: { startsAt: true, minutes: true, meetingUrl: true } },
      host: { select: { user: { select: { id: true, name: true, avatarUpdatedAt: true } } } },
      guest: { select: { user: { select: { id: true, name: true, avatarUpdatedAt: true } } } },
      answers: {
        where: { studentId: me.id },
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

  const other = side === "host" ? interview.guest.user : interview.host.user;
  const myNotes = (side === "host" ? interview.hostNotes : interview.guestNotes) ?? "";
  const template = templateById(interview.template);
  const phase = interviewPhase(interview, now);
  const chip = status(PHASE_STATUS[phase], viewer);
  const myFeedback = interview.feedback.find((f) => f.fromId === me.id) ?? null;
  const theirs = interview.feedback.find(
    (f) => f.fromId !== me.id && feedbackVisibleTo(f, me.id)
  ) ?? null;
  const canGuide = guideOpen(interview.slot, myFeedback?.submittedAt ?? null, now);

  return (
    <div className="space-y-4">
      <PageTitle
        backHref="/student/interviews"
        backLabel="Practice interviews"
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
            <LinkButton href={`/student/interviews/${interview.id}/live`}>
              {interview.answers.length || myFeedback ? "Continue interview" : "Start interview"}
            </LinkButton>
          )}
          {phase === "booked" && (
            <p className="text-[0.8125rem] text-muted-fg">
              {interview.slot.meetingUrl
                ? "You can mark it done once it starts."
                : "Arrange where to meet between you. You can mark it done once it starts."}
            </p>
          )}
        </div>
      </Section>

      {template && !interview.answers.length && !myFeedback?.submittedAt && (
        <Section title="Questions" count={template.questions.length} caption={template.summary}>
          <ol className="list-decimal space-y-2 py-3 pl-9 pr-4 text-[0.9375rem] text-ink marker:text-muted-fg sm:pl-10 sm:pr-5">
            {template.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </Section>
      )}

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

      {phase === "completed" ? (
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
          <CancelInterviewButton interviewId={interview.id} />
        </div>
      )}
    </div>
  );
}
