"use server";

import { revalidatePath } from "next/cache";

import { assertProgramScope, assertTaskAssigner, assertTaskScope } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  EMAIL_BY_DEFAULT,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_TYPES,
  USER_STATUS,
  canActAsMentor,
} from "@/lib/constants";
import { sendTaskEmails, taskSetMail, taskSetMentorMail } from "@/lib/email/task";
import { formatDate, toDateInputValue } from "@/lib/format";
import { notify, notificationHref } from "@/lib/notify";
import {
  MAX_TASK_NOTE,
  MAX_TASK_TITLE,
  parsePercentField,
} from "@/lib/student-tasks";
import { parseDateField, type ActionState } from "@/lib/actions/shared";
import { programToday } from "@/lib/when";

/**
 * Work a mentor sets a student, and the student's own progress on it.
 *
 * The other half of the week from `actions/assignments.ts`, and the division is
 * who writes. An AGENDA item is planned by an admin, budgeted in minutes, and
 * moved by the hours a mentor logs against it. A TASK is set by the mentor the
 * student actually sits with, carries no hours at all, and is moved by nobody
 * but the student — which is the only reason it is a second table.
 *
 * So there are two gates here rather than one, and they never overlap:
 *
 *   `assertTaskAssigner`  may this person SET work here? A mentor who works in
 *                         the program, or an admin of it. Asked on create,
 *                         where there is no row yet to ask about.
 *   `assertTaskScope`     may this person CHANGE this row? The mentor whose
 *                         task it is, or an admin of the task's own program —
 *                         the same rule an agenda item's edits go through.
 *
 * And the student, who may do exactly one thing: say how far along they are.
 * That is checked against the row's own `studentId`, never against a role, so a
 * student cannot move somebody else's task by posting its id.
 *
 * Every refusal about a row that exists reads identically to one about a row
 * that does not, so none of them can be used to find out what is there.
 */

/**
 * Which of these people still want task mail?
 *
 * Absence is the default and the default is yes (`EMAIL_BY_DEFAULT.TASKS`), so
 * the only row that can exist here is one somebody wrote by turning the switch
 * on /settings off — which is why this asks the question rather than assuming
 * it, and why the answer is not cached with the task.
 */
async function wantTaskEmail(userIds: string[]): Promise<Set<string>> {
  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds }, category: NOTIFICATION_CATEGORY.TASKS },
    select: { userId: true, email: true },
  });
  const said = new Map(prefs.map((p) => [p.userId, p.email]));
  return new Set(
    userIds.filter((id) => said.get(id) ?? EMAIL_BY_DEFAULT.TASKS)
  );
}

/** Title, deadline and note — the three things a mentor is asked. */
function parseFields(
  formData: FormData
):
  | { error: string }
  | { title: string; dueOn: Date; note: string | null } {
  const title = String(formData.get("title") ?? "").trim().replace(/\s+/g, " ");
  if (!title) return { error: "Say what the task is." };
  if (title.length > MAX_TASK_TITLE) {
    return { error: `Keep the task under ${MAX_TASK_TITLE} characters.` };
  }

  // Required, unlike an agenda item's due date. A task is given at one meeting
  // to be done before the next, and a task with no date is a suggestion the
  // student's home has no way to sort or chase.
  const dueOn = parseDateField(formData.get("dueOn"));
  if ("error" in dueOn) {
    return { error: "Give the task a deadline — that is what makes it one." };
  }

  const note = String(formData.get("note") ?? "").trim();
  if (note.length > MAX_TASK_NOTE) {
    return { error: `Keep the note under ${MAX_TASK_NOTE} characters.` };
  }

  return { title, dueOn: dueOn.value, note: note || null };
}

/**
 * A new task is due today or later: the forms' pickers stop at today, and this
 * is that rule for whatever posts around them. An edit may keep a day already
 * behind it, so an overdue task can still be corrected, but not move to one.
 */
const PAST_DUE = "Pick today or a later day.";
const pastDue = (dueOn: Date) => toDateInputValue(dueOn) < programToday();

/** Set a student a piece of work, in one of the programs they study in. */
export async function setStudentTask(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const studentProfileId = String(formData.get("studentProfileId") ?? "");
  const programId = String(formData.get("programId") ?? "");
  const student = await prisma.studentProfile.findUnique({
    where: { id: studentProfileId },
    include: {
      user: true,
      // The program's name comes along for the email, which has to say where
      // the work is from: a student in two programs gets tasks from both.
      enrollments: {
        select: { programId: true, program: { select: { name: true } } },
      },
    },
  });
  if (!student) return { ok: false, error: "That student no longer exists." };

  const denied = await assertTaskAssigner(actor, student, programId);
  if (denied) return denied;

  const fields = parseFields(formData);
  if ("error" in fields) return { ok: false, error: fields.error };
  if (pastDue(fields.dueOn)) return { ok: false, error: PAST_DUE };

  /**
   * The mentor on the row is the ACTOR, never a field.
   *
   * An admin setting a task owns it themselves rather than assigning it to
   * somebody else's name — which is the difference from an agenda item, where
   * naming the mentor IS the act and the row can wait without one. A task with
   * a mentor's name on it that they did not set is a task the student will ask
   * them about and they will not recognise.
   */
  await prisma.$transaction(async (tx) => {
    await tx.studentTask.create({
      data: {
        studentId: student.id,
        programId,
        mentorId: actor.id,
        title: fields.title,
        note: fields.note,
        dueOn: fields.dueOn,
      },
    });
    await notify(tx, {
      to: [student.userId],
      type: NOTIFICATION_TYPES.TASK_SET,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `${actor.name ?? actor.email} set you a task: "${fields.title}", due ${formatDate(fields.dueOn)}.`,
    });
  });

  // Queued AFTER the transaction and never inside it: a rollback cannot recall
  // an email, and the send holds SQLite's one write lock while it waits. The
  // mail itself goes out after the response — `queueEmails` — so the mentor
  // gets their confirmation without waiting on Resend.
  // Every mentor of the student's — the grants say who they are, in any of
  // their programs — and the mentor who set it, who may hold no grant yet.
  const grants = await prisma.hourAllocation.findMany({
    where: {
      studentId: student.id,
      mentor: { status: USER_STATUS.ACTIVE },
    },
    select: { mentor: { select: { id: true, email: true } } },
  });
  const mentors = new Map(
    grants.flatMap((g) => (g.mentor ? [[g.mentor.id, g.mentor.email]] : []))
  );
  if (canActAsMentor(actor)) mentors.set(actor.id, actor.email);
  mentors.delete(student.userId);

  const wants = await wantTaskEmail([student.userId, ...mentors.keys()]);
  const setterName = actor.name ?? actor.email;
  const studentName = student.user.name ?? student.user.email;
  const programName =
    student.enrollments.find((e) => e.programId === programId)?.program.name ??
    "your program";
  const task = { programName, title: fields.title, dueOn: fields.dueOn, note: fields.note };
  sendTaskEmails([
    ...(wants.has(student.userId)
      ? [
          taskSetMail({
            ...task,
            to: student.user.email,
            studentName: student.user.name,
            mentorName: setterName,
          }),
        ]
      : []),
    ...[...mentors]
      .filter(([id]) => wants.has(id))
      .map(([id, to]) =>
        taskSetMentorMail({
          ...task,
          to,
          isSetter: id === actor.id,
          setterName,
          studentName,
          studentProfileId: student.id,
        })
      ),
  ]);

  // This form lives on the student's workspace. Revalidating the entire app
  // layout made production task submissions wait on unrelated dashboard reads
  // and could leave the submit button showing "Setting…" indefinitely.
  revalidatePath(`/students/${student.id}`);
  return {
    ok: true,
    message: `"${fields.title}" is on their list, due ${formatDate(fields.dueOn)}.`,
  };
}

/**
 * Set the same task for every student in a program, in one go.
 *
 * Asked for by the program admins (11 October 2026): an essay deadline or a
 * form everybody has to fill in was the same task typed onto forty student
 * pages. EVERY student the program holds, exchange visitors included, and no
 * list to untick, by the same decision — it is the program's task, not a pick.
 * Students not yet approved are skipped: they have no home to see it on.
 *
 * Admins of the program only, which is narrower than `setStudentTask`'s gate:
 * a mentor sets work for the students they sit with, and a mentor who works in
 * a program does not sit with all of it. The admin owns every row, as an admin
 * owns a task they set one student.
 *
 * Each student is told and mailed as for one task. Their mentors are not
 * mailed per student — a mentor with ten students here would get ten copies
 * of one announcement — and see the task on each student's page.
 */
export async function setProgramTask(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const programId = String(formData.get("programId") ?? "");
  const denied = await assertProgramScope(actor, programId);
  if (denied) return denied;

  const fields = parseFields(formData);
  if ("error" in fields) return { ok: false, error: fields.error };
  if (pastDue(fields.dueOn)) return { ok: false, error: PAST_DUE };

  const [program, enrollments] = await Promise.all([
    prisma.program.findUnique({ where: { id: programId }, select: { name: true } }),
    prisma.studentEnrollment.findMany({
      where: { programId, student: { user: { status: USER_STATUS.ACTIVE } } },
      select: { student: { select: { id: true, userId: true, user: true } } },
    }),
  ]);
  if (!program) return { ok: false, error: "You don't administer that program." };
  const students = enrollments.map((e) => e.student);
  if (students.length === 0) {
    return { ok: false, error: `${program.name} has no approved students to set it for.` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.studentTask.createMany({
      data: students.map((student) => ({
        studentId: student.id,
        programId,
        mentorId: actor.id,
        title: fields.title,
        note: fields.note,
        dueOn: fields.dueOn,
      })),
    });
    await notify(tx, {
      to: students.map((student) => student.userId),
      type: NOTIFICATION_TYPES.TASK_SET,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `${actor.name ?? actor.email} set you a task: "${fields.title}", due ${formatDate(fields.dueOn)}.`,
    });
  });

  // After the transaction, as for one task: a rollback cannot recall an email.
  const wants = await wantTaskEmail(students.map((student) => student.userId));
  const setterName = actor.name ?? actor.email;
  sendTaskEmails(
    students
      .filter((student) => wants.has(student.userId))
      .map((student) =>
        taskSetMail({
          to: student.user.email,
          studentName: student.user.name,
          mentorName: setterName,
          programName: program.name,
          title: fields.title,
          dueOn: fields.dueOn,
          note: fields.note,
        })
      )
  );

  revalidatePath(`/programs/${programId}`);
  const count = students.length === 1 ? "1 student" : `${students.length} students`;
  return {
    ok: true,
    message: `"${fields.title}" is set for ${count}, due ${formatDate(fields.dueOn)}.`,
  };
}

/** Correct a task: any of its title, deadline and note. */
export async function updateStudentTask(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const id = String(formData.get("taskId") ?? "");
  const existing = await prisma.studentTask.findUnique({
    where: { id },
    include: { student: { select: { userId: true } } },
  });
  if (!existing || (await assertTaskScope(actor, existing))) {
    return { ok: false, error: "That task no longer exists." };
  }

  const fields = parseFields(formData);
  if ("error" in fields) return { ok: false, error: fields.error };
  const moved = toDateInputValue(fields.dueOn) !== toDateInputValue(existing.dueOn);
  if (moved && pastDue(fields.dueOn)) return { ok: false, error: PAST_DUE };

  // What this save actually CHANGES, which is the whole notice rather than a
  // decoration on it — the same lesson `updateAssignment` records: a form that
  // posts every field back turns "I fixed a typo" into "your task was updated,
  // due November 27", and a student who reads three of those stops reading the
  // fourth.
  const news: string[] = [];
  if (fields.title !== existing.title) {
    news.push(`now "${fields.title}"`);
  }
  if (fields.dueOn.getTime() !== existing.dueOn.getTime()) {
    news.push(`due ${formatDate(fields.dueOn)}`);
  }
  if (fields.note !== existing.note) {
    news.push(fields.note ? "a new note on it" : "the note taken off");
  }
  if (news.length === 0) return { ok: true, message: "Nothing changed." };

  await prisma.$transaction(async (tx) => {
    await tx.studentTask.update({ where: { id }, data: fields });
    await notify(tx, {
      to: [existing.student.userId],
      type: NOTIFICATION_TYPES.TASK_CHANGED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `Your task "${existing.title}" changed: ${news.join(", ")}.`,
    });
  });

  revalidatePath("/", "layout");
  return { ok: true, message: `"${fields.title}" updated.` };
}

/**
 * Withdraw a task. Nothing is at stake — no hours were budgeted against it and
 * no session was logged into it — so a task set by mistake is simply deleted,
 * and the student is told rather than left looking for a row that vanished.
 */
export async function deleteStudentTask(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const id = String(formData.get("taskId") ?? "");
  const existing = await prisma.studentTask.findUnique({
    where: { id },
    include: { student: { select: { userId: true } } },
  });
  if (!existing || (await assertTaskScope(actor, existing))) {
    return { ok: false, error: "That task no longer exists." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.studentTask.delete({ where: { id } });
    await notify(tx, {
      to: [existing.student.userId],
      type: NOTIFICATION_TYPES.TASK_CHANGED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `"${existing.title}" was taken off your list — you no longer need to do it.`,
    });
  });

  revalidatePath("/", "layout");
  return { ok: true, message: `"${existing.title}" withdrawn.` };
}

/**
 * How far along the work is — and, since 21 September 2026, said by either of
 * the two people who know.
 *
 * It was the student's write alone, and that was written down as the only
 * reason a task is not an agenda item. It is still the student's row to move,
 * and most of the time they are the one who moves it. But the mentor is who
 * reads the draft: they finish a meeting knowing the thing is half done, and
 * leaving the list to say 0% until the student remembers to tap makes it a
 * list nobody trusts. So the mentor who set it may mark it too, and so may an
 * admin of the program it was set in — `assertTaskScope`, the same pair who
 * may already correct the task's title, its deadline and its note.
 *
 * 100 is not "done". Reaching the last step and calling the thing finished are
 * two different claims, and a control that conflated them would have no way to
 * say "I've written the whole draft and I'm still checking it". So `percent`
 * moves freely and `completedAt` is stamped only by the Done button.
 *
 * Whoever did it, the OTHER party hears about it — and the message says who,
 * because "your task was marked done" with nobody's name on it is a thing the
 * student cannot check.
 */
export async function setStudentTaskProgress(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to do that." };

  const id = String(formData.get("taskId") ?? "");
  const task = await prisma.studentTask.findUnique({
    where: { id },
    include: { student: { select: { userId: true, user: true } } },
  });
  // "Not yours" and "does not exist" answer identically, so the refusal cannot
  // be used to find out whose tasks exist.
  const isStudent = task?.student.userId === user.id;
  if (!task || (!isStudent && (await assertTaskScope(user, task)))) {
    return { ok: false, error: "That task is not yours." };
  }

  /**
   * Who hears about it, and how the sentence starts.
   *
   * The student moving their own work is reported to the mentor in the third
   * person ("Khabiba finished …"); the mentor moving it is reported to the
   * student with the mentor's name on it, for the same reason. Nobody is ever
   * told about their own tap.
   */
  const actorName = user.name ?? user.email;
  const studentName = task.student.user.name ?? task.student.user.email;
  const audience = isStudent ? [task.mentorId] : [task.student.userId];
  const href = isStudent
    ? notificationHref.mentorStudent(task.studentId)
    : notificationHref.studentHome();
  const who = isStudent ? studentName : actorName;

  // Three things this one control can submit: a percentage, "I'm done", and
  // "I spoke too soon". They share an action because they are one question
  // asked in one place, and splitting them would let two of the three write a
  // state the third contradicts.
  const intent = String(formData.get("intent") ?? "percent");

  if (intent === "done") {
    if (task.completedAt) return { ok: true, message: "Already done." };
    await prisma.$transaction(async (tx) => {
      await tx.studentTask.update({
        where: { id },
        data: { percent: 100, completedAt: new Date() },
      });
      await notify(tx, {
        to: audience,
        type: NOTIFICATION_TYPES.TASK_MOVED,
        actorId: user.id,
        href,
        message: isStudent
          ? `${who} finished "${task.title}".`
          : `${who} marked "${task.title}" as done.`,
      });
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `"${task.title}" is done.` };
  }

  if (intent === "reopen") {
    if (!task.completedAt) return { ok: true, message: "It isn't finished yet." };
    await prisma.$transaction(async (tx) => {
      // Back to 75, not to 0: the student is saying "not quite", and a control
      // that answered by wiping every step they had recorded would be punishing
      // them for correcting themselves.
      await tx.studentTask.update({
        where: { id },
        data: { percent: 75, completedAt: null },
      });
      await notify(tx, {
        to: audience,
        type: NOTIFICATION_TYPES.TASK_MOVED,
        actorId: user.id,
        href,
        message: `${who} reopened "${task.title}" — it isn't finished after all.`,
      });
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `"${task.title}" is open again.` };
  }

  const parsed = parsePercentField(formData.get("percent"));
  if ("error" in parsed) return { ok: false, error: parsed.error };
  if (parsed.value === task.percent && !task.completedAt) {
    return { ok: true, message: "No change." };
  }

  // Moving the percentage of a finished task reopens it: the student is saying
  // it is 50% done, which cannot be true of something they also called
  // finished. That reopening IS news, where a nudge from 25 to 50 is not — a
  // student walking a task up in four taps would otherwise send their mentor
  // four notifications about one afternoon, and a feed that always arrives is
  // one nobody reads.
  //
  // A MENTOR's nudge is news even so, and the asymmetry is deliberate: this is
  // somebody else editing the student's own statement about their own work,
  // and the student should not have to notice it for themselves. The quiet
  // rule exists to stop one person's afternoon becoming four notices, and a
  // mentor does not walk a task up in four taps.
  const reopened = task.completedAt != null;
  await prisma.$transaction(async (tx) => {
    await tx.studentTask.update({
      where: { id },
      data: { percent: parsed.value, completedAt: null },
    });
    if (reopened || !isStudent) {
      await notify(tx, {
        to: audience,
        type: NOTIFICATION_TYPES.TASK_MOVED,
        actorId: user.id,
        href,
        message: reopened
          ? `${who} put "${task.title}" back to ${parsed.value}% — it isn't finished after all.`
          : `${who} marked "${task.title}" ${parsed.value}% done.`,
      });
    }
  });

  revalidatePath("/", "layout");
  return { ok: true, message: `Saved — ${parsed.value}%.` };
}
