import { notFound, redirect } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { BookInterviewForm } from "@/components/forms/interview-forms";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { requireRole } from "@/lib/dal";
import { studiesIn } from "@/lib/enrollments";
import { INTERVIEW_TEMPLATES } from "@/lib/interview-templates";
import { formatSlotDay, formatSlotSpan } from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import { programWallClock } from "@/lib/when";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Interview partner" };

/**
 * A classmate, as another student sees them: their name, their own programs,
 * and the times they have offered for a practice interview. Any approved
 * student is a classmate, whatever their program.
 *
 * Gated on the row, not the route: the classmate is loaded first and then
 * asked whether they are an approved, named student — and "not a classmate"
 * and "no such student" both answer 404, so an id cannot be used to learn who
 * exists.
 */
export default async function ClassmatePage({
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
  if (id === me.id) redirect("/student/interviews");

  const classmate = await prisma.studentProfile.findUnique({
    where: { id },
    select: {
      id: true,
      user: {
        select: { id: true, name: true, role: true, status: true, avatarUpdatedAt: true },
      },
      enrollments: {
        select: { programId: true, exchangeId: true, program: { select: { name: true } } },
      },
      interviewSlots: {
        where: { startsAt: { gt: programWallClock(now) }, interview: null },
        select: { id: true, startsAt: true, minutes: true },
        orderBy: { startsAt: "asc" },
      },
    },
  });
  if (
    !classmate ||
    classmate.user.role !== ROLES.STUDENT ||
    classmate.user.status !== USER_STATUS.ACTIVE ||
    !classmate.user.name?.trim()
  ) {
    notFound();
  }

  const name = classmate.user.name ?? "";
  const first = name.split(" ")[0] || name;
  // Their own programs, never one they are only visiting.
  const programs = studiesIn(classmate.enrollments).map((e) => e.program.name);

  const slots = classmate.interviewSlots.map((s) => ({
    id: s.id,
    day: formatSlotDay(s.startsAt, { zone: true }),
    span: formatSlotSpan(s),
  }));

  return (
    <div className="space-y-4">
      <PageTitle
        backHref="/student/interviews"
        backLabel="Interviews"
        leading={
          <Avatar
            person={{ ...classmate.user, email: "" }}
            className="h-12 w-12 text-sm"
          />
        }
        title={name}
        subtitle={programs.join(" · ")}
      />

      <Section title="Available interview times" count={slots.length || undefined}>
        {slots.length === 0 ? (
          <EmptyState framed={false} title="No times offered">
            {`${first} hasn’t offered any times yet.`}
          </EmptyState>
        ) : (
          <BookInterviewForm
            slots={slots}
            templates={INTERVIEW_TEMPLATES}
            classmate={first}
          />
        )}
      </Section>
    </div>
  );
}
