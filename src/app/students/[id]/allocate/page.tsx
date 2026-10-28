import { notFound } from "next/navigation";

import { AssignTaskForm } from "@/components/forms/assign-task-form";
import { PageTitle, Section } from "@/components/ui/section";
import {
  adminWriteScope,
  canAdministerStudent,
  scopeProgramFilter,
  staffLevel,
} from "@/lib/authz";
import { enrollmentLabel } from "@/lib/enrollments";
import { requireUser } from "@/lib/dal";
import { readParam, type SearchParams } from "@/lib/filters";
import { formatMinutes, toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { bankRemaining, pastHours } from "@/lib/hours";
import { studentLedger } from "@/lib/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Allocate time" };

export default async function AllocateStudentTimePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireUser();
  const { id } = await params;
  const from = readParam(await searchParams, "from");
  const profile = await prisma.studentProfile.findUnique({
    where: { id },
    include: {
      user: true,
      enrollments: {
        include: { program: true, cohort: true, level: true },
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
  // A bank program asks for no payment: its hours are one balance.
  const paymentPrograms = enrollments
    .filter((e) => e.program.tracksPayment && !e.program.hourBank)
    .map((e) => e.programId);
  // "Hour bank" is on the Agenda list only where the program has one and the
  // reader is an admin of it, who alone may change it.
  const bankPrograms = (
    await Promise.all(
      enrollments
        .filter((e) => e.program.hourBank)
        .map(async (e) =>
          (await staffLevel(me, e.programId)) === "ADMIN" ? e.programId : null
        )
    )
  ).filter((id): id is string => id !== null);
  const bankRows = await prisma.hourAllocation.findMany({
    where: { studentId: profile.id, isBank: true, programId: { in: visible } },
  });
  const bankedPrograms = bankRows.map((b) => b.programId);
  // What each bank still has to give a mentor, and the date a share may not pass.
  const banks = Object.fromEntries(
    await Promise.all(
      bankRows.map(
        async (b) =>
          [
            b.programId,
            { left: await bankRemaining(prisma, b), useBy: toDateInputValue(b.deadline) },
          ] as const
      )
    )
  );
  const pastByProgram = Object.fromEntries(
    await Promise.all(
      bankPrograms
        .filter((id) => !bankedPrograms.includes(id))
        .map(async (id) => [id, await pastHours(prisma, profile.id, id)] as const)
    )
  );

  return (
    <div className="max-w-4xl space-y-4">
      <PageTitle
        backHref={`/students/${profile.id}${from ? `?from=${from}` : ""}`}
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
            bankPrograms={bankPrograms}
            bankedPrograms={bankedPrograms}
            banks={banks}
            pastByProgram={pastByProgram}
          />
        </div>
      </Section>
    </div>
  );
}
