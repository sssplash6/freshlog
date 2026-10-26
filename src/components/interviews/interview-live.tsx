import { notFound, redirect } from "next/navigation";

import { InterviewGuide } from "@/components/forms/interview-guide";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { dictationConfigured } from "@/lib/dictation";
import type { InterviewViewer } from "@/lib/interview-viewer";
import { templateById } from "@/lib/interview-templates";
import { formatSlotWhen, guideClosedAt, hasStarted, partOf, sideOf } from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";

/**
 * The practice interview as it happens, opened beside the call: one step at a
 * time, the reader's own answers, and the feedback they will hand over — or,
 * with a mentor, only the half that is theirs (`partOf`).
 *
 * Only this student's answers and feedback are selected — the partner's are
 * never loaded here, so they cannot leak into the payload. Not-yours and
 * not-found are the same 404.
 */
export async function InterviewLive({ viewer, id }: { viewer: InterviewViewer; id: string }) {
  const { now, base } = viewer;
  const me = { id: viewer.user.id };

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
      slot: { select: { startsAt: true, meetingUrl: true } },
      host: { select: { name: true } },
      guest: { select: { name: true } },
      answers: {
        where: { userId: me.id },
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
  const part = partOf(interview, me.id);
  if (guideClosedAt(part, mine?.submittedAt ?? null, interview.completedAt) || interview.absentId) {
    redirect(`${base}/${interview.id}`);
  }

  const template = templateById(interview.template);
  const partner = (side === "host" ? interview.guest : interview.host).name ?? "your partner";
  const title = template?.name ?? "Practice interview";

  if (!hasStarted(interview.slot.startsAt, now)) {
    return (
      <div className="space-y-4">
        <PageTitle backHref={`${base}/${interview.id}`} backLabel="Interview" title={title} />
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
      <PageTitle backHref={`${base}/${interview.id}`} backLabel="Interview" title={title} />
      <InterviewGuide
        interviewId={interview.id}
        base={base}
        part={part}
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
