import "server-only";

import { nameOf, type Reader } from "@/lib/api/v1/sessions";
import type { StudentWork } from "@/lib/api/v1/types";
import { workOf } from "@/lib/api/v1/work";
import { assertTaskAssigner, canManageStudent, mentorReaches, studentScope } from "@/lib/authz";
import { canActAsMentor } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { studentLedger } from "@/lib/queries";
import { programToday } from "@/lib/when";

/** The most of either list the student page's board sends: its `ROW_CAP`. */
const BOARD_ROWS = 60;

/**
 * One student's tasks and plan items, as the website's `/students/[id]` shows
 * them to `reader`, or null when that page would be a 404.
 *
 * Who reads is the page's rule: an admin of one of the student's programs
 * (`canManageStudent`), or a mentor who reaches them. Nobody else, the student
 * included: their own page is their home. What is read follows the same split:
 * an admin sees the rows of their own programs and no trace of the others, a
 * mentor who does not manage the student sees the whole ledger.
 *
 * A student who is not there and one who is not the reader's answer alike.
 */
export async function studentWorkFor(
  reader: Reader,
  studentProfileId: string,
  now: Date = new Date()
): Promise<StudentWork | null> {
  const profile = await prisma.studentProfile.findUnique({
    where: { id: studentProfileId },
    include: {
      user: { select: { name: true, email: true } },
      enrollments: { include: { program: true }, orderBy: { program: { name: "asc" } } },
    },
  });
  if (!profile) return null;

  const manages = await canManageStudent(reader.user, profile);
  const reaches = !manages && canActAsMentor(reader.user) && (await mentorReaches(reader.user, profile));
  if (!manages && !reaches) return null;

  // Which programs, as the page asks it: a manager's rows are their programs',
  // a mentor's are all of them.
  const visible = manages ? await studentScope(reader.user, profile) : undefined;
  const enrollments = visible ? profile.enrollments.filter((e) => visible.includes(e.programId)) : profile.enrollments;

  const [ledger, assignable] = await Promise.all([
    studentLedger(profile.id, visible),
    // `assertTaskAssigner` itself, so the list offers exactly what the action
    // will take. A visit counts, as it does on the page.
    Promise.all(enrollments.map(async (e) => ((await assertTaskAssigner(reader.user, profile, e.programId)) === null ? e.program : null))),
  ]);

  const work = workOf(reader, { id: profile.id, userId: profile.userId, user: profile.user }, ledger, now);
  // The page's board sends at most 60 of each list and counts the rest (`ROW_CAP`): tasks open then done, plan items
  // not finished then finished, the finished filling what is left of the 60.
  const open = work.plan.filter((item) => item.progress !== "DONE");
  const done = work.plan.filter((item) => item.progress === "DONE");
  return {
    student: { id: profile.id, userId: profile.userId, name: nameOf(profile.user) },
    ...work,
    tasks: work.tasks.slice(0, BOARD_ROWS),
    plan: [...open.slice(0, BOARD_ROWS), ...done.slice(0, Math.max(BOARD_ROWS - open.length, 0))],
    taskCount: work.tasks.length,
    planCount: work.plan.length,
    canSetTaskIn: assignable.flatMap((program) =>
      program ? [{ id: program.id, name: program.name, colorIndex: program.colorIndex }] : []
    ),
    today: programToday(now),
  };
}
