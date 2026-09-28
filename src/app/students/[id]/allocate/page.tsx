import { notFound } from "next/navigation";

import { AssignTaskForm } from "@/components/forms/assign-task-form";
import { PageTitle, Section } from "@/components/ui/section";
import { adminWriteScope, canAdministerStudent, scopeProgramFilter } from "@/lib/authz";
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
  // A form, not a record: a read-only grant (LEADER, SALES) has nothing to do
  // here, so the gate and the picker both ask the write scope — an enrollment
  // the admin can read but not write must not be offered as a grant target.
  if (!profile || !(await canAdministerStudent(me, profile))) notFound();

  const scope = await adminWriteScope(me);
  const visible = profile.enrollments
    .map((e) => e.programId)
    .filter((id) => scope === "ALL" || scope.has(id));
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

  const mentorOptions = mentors.map((mentor) => ({
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
