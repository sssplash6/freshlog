import Link from "next/link";

import {
  SetMentorTaskForm,
  WithdrawMentorTask,
} from "@/components/forms/mentor-task-forms";
import { MentorTaskDue } from "@/components/mentor-task-due";
import { PersonChip } from "@/components/person-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { canManageProgram } from "@/lib/authz";
import { requireProgramScope } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { programMentorTasks, programTeam } from "@/lib/mentor-tasks";

import { requestNow } from "../../reads";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Mentor tasks" };

/**
 * What this program's admins have asked its mentors to do.
 *
 * Every task here belongs to THIS program: its mentors are the program's
 * pairings and its students the program's enrollments, so an admin of one
 * program never reads another's list or names another's people. Only an
 * ADMIN-level grant sets or withdraws; a LEADER or SALES grant reads.
 */
export default async function ProgramMentorTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { id } = await params;
  const viewer = await requireProgramScope(id);
  // Arrived with `?new=1`: the form starts open.
  const startOpen = (await searchParams).new === "1";

  const [canWrite, team, tasks, enrollments] = await Promise.all([
    canManageProgram(viewer, id),
    programTeam(id),
    programMentorTasks(id),
    prisma.studentEnrollment.findMany({
      where: { programId: id },
      select: {
        student: {
          select: { id: true, user: { select: { name: true, email: true } } },
        },
      },
    }),
  ]);
  const now = requestNow();

  const students = enrollments
    .map((e) => ({ id: e.student.id, name: e.student.user.name ?? e.student.user.email }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const open = tasks.filter((t) => t.assignees.some((a) => !a.completedAt));
  const finished = tasks.filter((t) => t.assignees.every((a) => a.completedAt));

  return (
    <div className="space-y-4">
      <Section title="Open" count={open.length || undefined}>
        {canWrite && (
          <div className="border-b border-line">
            <SetMentorTaskForm
              key={startOpen ? "open" : "closed"}
              programId={id}
              team={team}
              students={students}
              defaultOpen={startOpen}
            />
          </div>
        )}
        {open.length === 0 ? (
          <EmptyState framed={false} variant="healthy" title="No open tasks" />
        ) : (
          <TaskList tasks={open} programId={id} now={now} canWrite={canWrite} />
        )}
      </Section>

      {finished.length > 0 && (
        <Section title="Done" count={finished.length}>
          <TaskList tasks={finished} programId={id} now={now} canWrite={canWrite} />
        </Section>
      )}
    </div>
  );
}

type Task = Awaited<ReturnType<typeof programMentorTasks>>[number];

function TaskList({
  tasks,
  programId,
  now,
  canWrite,
}: {
  tasks: Task[];
  programId: string;
  now: Date;
  canWrite: boolean;
}) {
  return (
    <ul className="divide-y divide-line">
      {tasks.map((t) => {
        const done = t.assignees.filter((a) => a.completedAt).length;
        const allDone = done === t.assignees.length;
        return (
          <li key={t.id} className="space-y-2.5 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="text-body font-semibold text-ink">{t.title}</p>
                <p className="mt-0.5 text-xs text-muted-fg">
                  Due <MentorTaskDue dueOn={t.dueOn} now={now} done={allDone} className="text-xs" />
                  {" · "}
                  <span className="tabular-nums">
                    {done}/{t.assignees.length} done
                  </span>
                </p>
              </div>
              {canWrite && <WithdrawMentorTask taskId={t.id} />}
            </div>

            {t.note && <p className="whitespace-pre-line text-sm text-ink">{t.note}</p>}

            {/* Each mentor with their own answer beside them, so a tick cannot
                be read as belonging to the next name along. The same ○ / ✓
                chip a task wears on the agenda. */}
            <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Mentors">
              {t.assignees.map((a) => (
                <li key={a.id} className="flex items-center gap-1.5">
                  <PersonChip person={a.mentor} size="sm" />
                  <StatusChip
                    severity={a.completedAt ? "ok" : "neutral"}
                    glyph={a.completedAt ? "✓" : "○"}
                  >
                    {a.completedAt ? "Done" : "Not started"}
                  </StatusChip>
                </li>
              ))}
            </ul>

            {t.students.length > 0 && (
              <p className="text-xs text-muted-fg">
                About{" "}
                {t.students.map((s, i) => (
                  <span key={s.studentId}>
                    {i > 0 && ", "}
                    <Link
                      href={`/students/${s.student.id}?from=${programId}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {s.student.user.name ?? s.student.user.email}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
