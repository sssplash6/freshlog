import { notFound } from "next/navigation";

import { AssignTaskForm } from "@/components/forms/assign-task-form";
import { PageTitle, Section } from "@/components/ui/section";
import { adminScope, canManageStudent, scopeProgramFilter, studentScope } from "@/lib/authz";
import { enrollmentLabel } from "@/lib/enrollments";
import { requireUser } from "@/lib/dal";
import { formatMinutes } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { studentLedger } from "@/lib/queries";

export default async function AllocateStudentTimePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  const { id } = await params;
  const profile = await prisma.studentProfile.findUnique({
    where: { id },
    include: {
      user: true,
      enrollments: {
        include: { program: true, cohort: true },
        orderBy: { program: { name: "asc" } },
      },
    },
  });
  if (!profile || !(await canManageStudent(me, profile))) notFound();

  const scope = await adminScope(me);
  const visible = await studentScope(me, profile);
  const enrollments = profile.enrollments.filter((e) => visible.includes(e.programId));
  const programIds = scopeProgramFilter(scope);
  const [mentors, ledger] = await Promise.all([
    prisma.user.findMany({
      where: {
        OR: [{ role: "MENTOR" }, { isMentor: true }],
        ...(programIds
          ? { mentorAssignments: { some: { programId: { in: [...programIds] } } } }
          : {}),
      },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, email: true },
    }),
    studentLedger(profile.id, visible),
  ]);

  const openTasksByMentor: Record<string, { purpose: string; hint?: string }[]> = {};
  for (const task of ledger.assignments) {
    if (task.progress === "DONE") continue;
    (openTasksByMentor[`${task.programId}:${task.mentorId ?? ""}`] ??= []).push({
      purpose: task.purpose,
      hint:
        task.minuteLimit != null
          ? `${formatMinutes(task.loggedMinutes)}/${formatMinutes(task.minuteLimit)}`
          : undefined,
    });
  }

  // The reader is never an option: a grant written to its own author is the
  // one `setMentorAllocation` refuses, so the picker doesn't offer it rather
  // than explaining the refusal after the fact.
  const mentorOptions = mentors
    .filter((mentor) => mentor.id !== me.id)
    .map((mentor) => ({
      value: mentor.id,
      label: mentor.name ?? mentor.email,
    }));
  const paymentPrograms = enrollments
    .filter((e) => e.program.tracksPayment)
    .map((e) => e.programId);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageTitle
        backHref={`/students/${profile.id}`}
        backLabel="Student"
        title="Allocate time"
        subtitle={profile.user.name ?? profile.user.email}
      />
      <Section title="New allocation">
        <div className="px-4 py-2 sm:px-5">
          <AssignTaskForm
            studentProfileId={profile.id}
            programs={enrollments.map((e) => ({
              value: e.programId,
              label: enrollmentLabel(e),
            }))}
            mentors={mentorOptions}
            openTasksByMentor={openTasksByMentor}
            paymentPrograms={paymentPrograms}
          />
        </div>
      </Section>
    </div>
  );
}
