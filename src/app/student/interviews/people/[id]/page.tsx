import { notFound, redirect } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { BookInterviewForm } from "@/components/forms/interview-forms";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { requireRole } from "@/lib/dal";
import { studiesIn } from "@/lib/enrollments";
import { INTERVIEW_TEMPLATES } from "@/lib/interview-templates";
import {
  areClassmates,
  formatSlotDay,
  formatSlotSpan,
} from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import { programWallClock } from "@/lib/when";

/**
 * A classmate, as another student sees them: their name, the programs the two
 * share, and the times they have offered for a practice interview.
 *
 * Gated on the row, not the route: the classmate is loaded first and then
 * asked whether they share one of the reader's own programs — and "not a
 * classmate" and "no such student" both answer 404, so an id cannot be used to
 * learn who exists.
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
    select: {
      id: true,
      enrollments: { select: { programId: true, exchangeId: true } },
    },
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
    !classmate.user.name?.trim() ||
    !areClassmates(me.enrollments, classmate.enrollments)
  ) {
    notFound();
  }

  const name = classmate.user.name ?? "";
  const first = name.split(" ")[0] || name;
  // Only the programs the two share: the rest of a classmate's enrollments are
  // not the reader's business.
  const mine = new Set(studiesIn(me.enrollments).map((e) => e.programId));
  const shared = studiesIn(classmate.enrollments)
    .filter((e) => mine.has(e.programId))
    .map((e) => e.program.name);

  const slots = classmate.interviewSlots.map((s) => ({
    id: s.id,
    day: formatSlotDay(s.startsAt),
    span: formatSlotSpan(s),
  }));

  return (
    <div className="space-y-4">
      <PageTitle
        backHref="/student/interviews"
        backLabel="Practice interviews"
        leading={
          <Avatar
            person={{ ...classmate.user, email: "" }}
            className="h-12 w-12 text-sm"
          />
        }
        title={name}
        subtitle={shared.join(" · ")}
      />

      <Section title="Available interview times" count={slots.length || undefined}>
        {slots.length === 0 ? (
          <EmptyState framed={false} title="No times offered">
            {first} hasn&apos;t offered any times yet.
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
