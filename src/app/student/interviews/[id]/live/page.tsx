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
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Live interview" };

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
