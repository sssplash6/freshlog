"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/dal";
import {
  adminWriteScope,
  canManageProgram,
  mentorReaches,
  scopeCovers,
  scopeIsEmpty,
} from "@/lib/authz";
import type { Prisma, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ASSIGNMENT_PROGRESS,
  ATTENDANCE,
  ATTENDANCE_META,
  attendanceFields,
  attendanceOf,
  canActAsMentor,
  CHARGED_SESSION,
  MAX_SESSION_MINUTES,
  TIME_KIND,
  TIME_KIND_META,
  timeKindFields,
  timeKindOf,
  NOTIFICATION_TYPES,
  SESSION_ANSWER,
  SESSION_STATUS,
  USER_STATUS,
} from "@/lib/constants";
import {
  formatDuration,
  formatFullDate,
  formatMinutes,
} from "@/lib/format";
import { describeSessionChange } from "@/lib/session-change";
import { programToday } from "@/lib/when";
import { chargeableAgainst } from "@/lib/deadlines";
import { syncGoalProgress } from "@/lib/goal-progress";
import { parseNewAgendaField } from "@/lib/tasks";
import { notify, notificationHref, staffIdsFor } from "@/lib/notify";
import {
  parseDateField,
  parseMinutesField,
  type ActionState,
} from "@/lib/actions/shared";
import { reachablePrograms } from "@/lib/queries";
import { bankDrawnBy, bankRemaining } from "@/lib/hours";

/**
 * A session records a meeting that has happened, so its day cannot be after the
 * program's today. The log form already stops the picker there; this is the
 * same rule where a hand-made request cannot walk around it. It is how
 * "October 24" got into a September ledger, and into the notice that said it
 * had been corrected.
 */
const FUTURE_REFUSAL =
  "A session can't be dated in the future. Pick today or an earlier day.";

function isFuture(day: Date): boolean {
  return day.getTime() > Date.parse(`${programToday()}T00:00:00.000Z`);
}

/**
 * Which of the four kinds of meeting this was. Defaults to Attended, so a form
 * that somehow arrives without the field records the ordinary case rather than
 * failing — and an unknown value is never written.
 */
function readAttendance(raw: FormDataEntryValue | null): string {
  const value = String(raw ?? "").trim().toUpperCase();
  return value in ATTENDANCE_META ? value : ATTENDANCE.ATTENDED;
}

/**
 * Whether these hours come out of the student's allocation. Defaults to in-plan
 * for the same reason attendance defaults to Attended: a form that somehow
 * arrives without the field should record the ordinary case, and the ordinary
 * case is a meeting the student paid for.
 */
function readHoursKind(raw: FormDataEntryValue | null): string {
  const value = String(raw ?? "").trim().toUpperCase();
  return value in TIME_KIND_META ? value : TIME_KIND.PLAN;
}



async function requireActiveMentor() {
  const actor = await getCurrentUser();
  if (!actor || !canActAsMentor(actor)) return null;
  if (actor.status !== USER_STATUS.ACTIVE) return null;
  return actor;
}

/** Remaining hours the student holds with this mentor, in this program. */
async function remainingWith(
  studentProfileId: string,
  programId: string,
  mentorId: string,
  allocatedHours: number
): Promise<number> {
  const sum = await prisma.session.aggregate({
    where: {
      studentId: studentProfileId,
      programId,
      mentorId,
      ...CHARGED_SESSION,
    },
    _sum: { minutes: true },
  });
  return allocatedHours - (sum._sum.minutes ?? 0);
}

/**
 * Whether a session held on `date` lands past the hours' use-by `deadline` —
 * held after it, or written down after the late-logging window closed. Never
 * a refusal: a deadline is a use-by date, not a wall, and a meeting that
 * happened is recorded. The verdict is what the receipt and the staff note
 * say out loud instead.
 */
function pastDeadline(
  source: { deadline: Date } | null,
  date: Date
): Date | null {
  if (!source) return null;
  return chargeableAgainst(source.deadline, date).ok ? null : source.deadline;
}

/**
 * Resolve the task a session is being logged against. OPTIONAL: naming one is
 * what lets planned hours be read against delivered ones, but a meeting that
 * fits none of them still happened and still has to be loggable — a mentor
 * shouldn't have to wait on an admin to record work they've already done.
 *
 * When one IS named it must be a task an admin gave THIS mentor for THIS
 * student — nobody logs time against a colleague's task, or another student's —
 * or one with no mentor yet, which logging against claims.
 */
async function resolveGoal(
  raw: FormDataEntryValue | null,
  studentProfileId: string,
  programId: string,
  mentorId: string,
  /** Whose list it has to be on, said the way the reader would say it. */
  whose = "yours"
): Promise<
  | { value: { id: string; purpose: string; unassigned: boolean } | null }
  | { error: string }
> {
  const id = String(raw ?? "").trim();
  if (!id) return { value: null };

  const assignment = await prisma.assignment.findUnique({ where: { id } });
  if (
    !assignment ||
    assignment.studentId !== studentProfileId ||
    // A task belongs to one program's plan. Logging a Master's Program meeting
    // against a Global Admissions essay would put delivered hours on work in a
    // program that never ordered them.
    assignment.programId !== programId ||
    (assignment.mentorId !== null && assignment.mentorId !== mentorId)
  ) {
    return { error: `That task isn't one of ${whose} for this student.` };
  }
  return {
    value: {
      id: assignment.id,
      purpose: assignment.purpose,
      unassigned: assignment.mentorId === null,
    },
  };
}

/**
 * What a logged session goes toward. `id` is null for a name the agenda does
 * not have yet, which the log adds.
 */
type Goal = { id: string | null; purpose: string; unassigned: boolean };

/**
 * The open item on this student's agenda, in this program, called `name` —
 * the mentor's own first, then one no mentor holds yet, which logging claims.
 * Never a colleague's: their item is their hours. Case and spacing aside,
 * "supplemental essays" is the same work as "Supplemental Essays", and a second
 * row of it would split one piece of work in two.
 */
async function openAgendaNamed(
  db: Pick<typeof prisma, "assignment">,
  name: string,
  studentId: string,
  programId: string,
  mentorId: string
): Promise<Goal | null> {
  const want = name.trim().toLowerCase();
  const rows = await db.assignment.findMany({
    where: {
      studentId,
      programId,
      OR: [{ mentorId }, { mentorId: null }],
      progress: { not: ASSIGNMENT_PROGRESS.DONE },
    },
    orderBy: { position: "asc" },
    select: { id: true, purpose: true, mentorId: true },
  });
  const match =
    rows.find((r) => r.mentorId === mentorId && r.purpose.trim().toLowerCase() === want) ??
    rows.find((r) => r.mentorId === null && r.purpose.trim().toLowerCase() === want);
  return match
    ? { id: match.id, purpose: match.purpose, unassigned: match.mentorId === null }
    : null;
}

/**
 * Log a completed session against one of the mentor's open tasks for the
 * student. Draws down the hours the student holds with THIS mentor (derived) —
 * or, when the mentor holds none, carves what the session charges out of the
 * student's unassigned pool into a new allocation of their own — and notifies
 * them. Overdraw is allowed but flagged back to the mentor.
 *
 * A mentor working in the student's program may log without holding any
 * allocation for them at all; the "Whose hours?" tick decides whether those
 * hours charge, and an in-plan log with nothing to draw on overdraws.
 */
/**
 * The form's own fields, echoed back on failure.
 *
 * React 19 resets an uncontrolled form once its action settles. That is right
 * after a success and wrong after a failure: a mentor who typed "1.5" in the
 * minutes box was losing the note, the task, the date and the attendance
 * choice along with the correction. The page refills from this.
 */
const LOG_FIELDS = [
  "mentorId",
  "studentProfileId",
  "programId",
  "assignmentId",
  "agendaName",
  "minutes",
  "date",
  "note",
  "attendance",
  "timeKind",
] as const;

function submitted(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of LOG_FIELDS) {
    const value = formData.get(name);
    if (value != null) values[name] = String(value);
  }
  return values;
}

export async function logSession(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const values = submitted(formData);
  /** An error the mentor can fix, with the field to put it next to. */
  const bad = (error: string, field?: string): ActionState => ({
    ok: false,
    error,
    ...(field ? { field } : {}),
    values,
  });

  // Whose session this is, which is not always who is typing it.
  //
  // An admin of the program may log for a mentor in it: mentors leave, miss
  // the week, or never log at all, and the hours were still delivered. What
  // the admin is NOT is the mentor — the row, the allocation it draws down and
  // the student's notification all name the person who held the meeting, and
  // the admin only appears in the audit trail and in what the other staff are
  // told. Which program the hours land in is checked below, once it is known:
  // administering one program is not licence to log into another.
  const actor = await getCurrentUser();
  if (!actor) return bad("Sign in to do that.");
  const named = String(formData.get("mentorId") ?? "").trim();
  const onBehalf = named !== "" && named !== actor.id;
  const mentor = onBehalf
    ? await prisma.user.findUnique({ where: { id: named } })
    : await requireActiveMentor();
  if (!mentor) {
    return bad(
      onBehalf ? "That mentor no longer exists." : "Only assigned mentors can log sessions.",
      onBehalf ? "mentorId" : undefined
    );
  }
  if (onBehalf) {
    if (scopeIsEmpty(await adminWriteScope(actor))) {
      return bad("Only an admin can log a session for somebody else.", "mentorId");
    }
    if (!canActAsMentor(mentor) || mentor.status !== USER_STATUS.ACTIVE) {
      return bad("That person isn't an active mentor.", "mentorId");
    }
  }
  /** The mentor by name, for everything said about somebody else's hours. */
  const mentorLabel = mentor.name ?? mentor.email;
  /** "remaining with you" — or with the mentor, when the reader is not them. */
  const theirs = onBehalf ? mentorLabel : "you";

  const studentProfileId = String(formData.get("studentProfileId") ?? "");
  const minutesParsed = parseMinutesField(formData.get("minutes"), {
    min: 0.01,
    // One session is a day at the very most.
    max: MAX_SESSION_MINUTES,
    label: "Minutes",
  });
  if ("error" in minutesParsed) return bad(minutesParsed.error, "minutes");
  const dateParsed = parseDateField(formData.get("date"));
  if ("error" in dateParsed) return bad(dateParsed.error, "date");
  if (isFuture(dateParsed.value)) return bad(FUTURE_REFUSAL, "date");
  const note = String(formData.get("note") ?? "").trim() || null;
  const state = readAttendance(formData.get("attendance"));
  const fields = attendanceFields(state);
  const rescheduled = state === ATTENDANCE.RESCHEDULED;
  const kind = readHoursKind(formData.get("timeKind"));
  const withinPlan = timeKindFields(kind).withinPlan;

  const profile = await prisma.studentProfile.findUnique({
    where: { id: studentProfileId },
    include: {
      user: true,
      enrollments: { include: { program: true } },
    },
  });
  if (!profile) return bad("Student not found.", "studentProfileId");
  if (profile.user.status !== USER_STATUS.ACTIVE) {
    return bad("That student hasn't been approved by an admin yet.", "studentProfileId");
  }

  // Reach IS authorization here, and `mentorReaches` is the only place it is
  // written: the log picker offers exactly the students it reaches, so a
  // student a mentor can see is never one the log then refuses. Every leg of it
  // takes an admin's act to exist — a grant, a pairing, a task moved onto their
  // list — so none of it is self-granted, which is what stops any mentor
  // anywhere logging against any student and carving their unassigned hours to
  // themselves.
  if (!(await mentorReaches(mentor, profile))) {
    return bad(
      onBehalf
        ? `${mentorLabel} isn't assigned to that student's program, so hours can't be logged for them.`
        : "You aren't assigned to that student's program, so you can't log hours for them.",
      "studentProfileId"
    );
  }

  // WHICH program this meeting was for. A student may be enrolled in several,
  // and each holds its own time with its own deadline, so a session that could
  // not say which one it spent would spend the wrong one. The mentor is asked
  // only when the answer is genuinely more than one; with a single shared
  // program — which is nearly every meeting — the form fills it in silently.
  const reachable = await reachablePrograms(mentor.id, profile);
  const namedProgram = String(formData.get("programId") ?? "").trim();
  const programId = namedProgram
    ? reachable.find((p) => p.id === namedProgram)?.id
    : reachable.length === 1
      ? reachable[0].id
      : undefined;
  if (!programId) {
    return bad(
      namedProgram
        ? onBehalf
          ? `${mentorLabel} doesn't work in that program, or the student isn't in it.`
          : "You don't work in that program, or the student isn't in it."
        : reachable.length === 0
          ? onBehalf
            ? `${mentorLabel} isn't assigned to any program this student is in, so hours can't be logged for them.`
            : "You aren't assigned to any program this student is in, so you can't log hours for them."
          : onBehalf
            ? `This student is in more than one of ${mentorLabel}'s programs — pick which one this session was for.`
            : "This student is in more than one of your programs — pick which one this session was for.",
      "programId"
    );
  }
  const program = reachable.find((p) => p.id === programId)!;
  // The hours land in this program's ledger, so it has to be one the person
  // typing actually administers — an admin of Global Admissions logging a
  // Master's Program session would be moving a balance in a program they
  // cannot even read.
  if (onBehalf && !(await canManageProgram(actor, programId))) {
    return bad(
      `You don't administer ${program.name}, so you can't log a session in it.`,
      "programId"
    );
  }
  // Is the student HERE on an exchange? Then the session belongs to it, and the
  // row says so: the program that lent them reads its own exchange's sessions
  // rather than asking about a student inside a program it does not administer.
  // Copied at log time rather than derived later, so the log still reads the
  // same to both ends if the placement is ever converted into an enrollment.
  const exchangeId =
    profile.enrollments.find((e) => e.programId === programId)?.exchangeId ?? null;

  // Sessions draw down hours an admin allocated to THIS mentor in THIS
  // program — or, when the mentor holds none, the student's unassigned pool
  // there: those hours deliberately named no mentor yet, and logging is the act
  // that decides one. The logged hours are carved out of the pool into this
  // mentor's own allocation inside the transaction below, so every number
  // afterwards reads the same as if an admin had granted them directly.
  //
  // A student with an HOUR BANK in this program is the exception: every
  // meeting in-plan draws the bank, whoever delivers it, so the mentor's own
  // grant and the pool are not looked at — unless an admin handed this mentor
  // a share of the bank, which their meetings draw instead. Only in-plan hours
  // draw either — extra time charges nothing, bank or not.
  const bank = withinPlan
    ? await bankDrawnBy(prisma, profile.id, programId, mentor.id)
    : null;
  const allocation = bank
    ? null
    : await prisma.hourAllocation.findUnique({
        where: {
          studentId_programId_mentorId: {
            studentId: profile.id,
            programId,
            mentorId: mentor.id,
          },
        },
      });
  const pool =
    bank || allocation
      ? null
      : await prisma.hourAllocation.findFirst({
          where: { studentId: profile.id, programId, mentorId: null, isBank: false },
        });

  // Whether the hours charge is the mentor's own answer to "Whose hours?", and
  // nothing else: it is NOT inferred from what the student happens to hold.
  // In-plan against an empty balance overdraws — warned, never blocked, exactly
  // as in-plan past a balance always has — because the alternative is a mentor
  // choosing between misreporting the meeting as extra and not logging it.

  // Deadlines are use-by dates, not walls: once passed, the unused hours show
  // as forfeited everywhere balances are counted, but a meeting that happened
  // is still logged against the allocation it draws on. The ledger's job is
  // to record the hours; a deadline that could silence them would make a
  // mentor choose between misreporting the meeting as extra and not recording
  // it at all — and an admin's remedy was only ever the same log through a
  // second door. So the verdict is said, not enforced: a session held past
  // the use-by, or written down after the fortnight's grace for late entries,
  // is marked on its receipt and in what the program's staff are told.
  //
  // A student holding nothing at all has no deadline to be past: an expired
  // allocation is a positive statement that the time is over, where an absent
  // one is only an absence — the second overdraws, as ever.
  const source = withinPlan ? (bank ?? allocation ?? pool) : null;
  const lateDeadline = pastDeadline(source, dateParsed.value);

  // Checked after reach, so a mentor who may not log for this student at all
  // hears that first rather than being told about a task they can't use.
  //
  // The agenda used to be only what an admin had named while granting hours,
  // so a meeting about anything else could say nothing about its work but the
  // note. A NAME — a preset, or typed under "Something else…" — goes to the
  // open item already called that, or is added to the agenda below.
  const newAgenda = parseNewAgendaField(formData.get("assignmentId"), formData.get("agendaName"));
  if (newAgenda && "error" in newAgenda) return bad(newAgenda.error, "assignmentId");
  const resolved: { value: Goal | null } | { error: string } = newAgenda
    ? {
        value: (await openAgendaNamed(prisma, newAgenda.name, profile.id, programId, mentor.id)) ?? {
          id: null,
          purpose: newAgenda.name,
          unassigned: false,
        },
      }
    : await resolveGoal(
        formData.get("assignmentId"),
        profile.id,
        programId,
        mentor.id,
        onBehalf ? `${mentorLabel}'s` : "yours"
      );
  if ("error" in resolved) return bad(resolved.error, "assignmentId");
  const goal = resolved.value;
  // Reads "toward "Main essay"" when there is one, and nothing at all when there
  // isn't, rather than an empty pair of quotes.
  const toward = goal ? ` toward "${goal.purpose}"` : "";
  const forTask = goal ? ` for "${goal.purpose}"` : "";

    // A double-tapped submit writes the session twice and charges the time
  // twice, and the mentor has no way to tell which of the two identical rows to
  // void. useFormStatus disables the button, but only once React has the
  // pending state — a fast second tap, or a phone that fires touch and click,
  // gets there first. So the guard is here, where it cannot be raced: the same
  // mentor, student, duration and date within a minute is one session.
  const twin = await prisma.session.findFirst({
    where: {
      mentorId: mentor.id,
      studentId: profile.id,
      programId,
      minutes: minutesParsed.value,
      date: dateParsed.value,
      status: SESSION_STATUS.ACTIVE,
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
  });
  if (twin) {
    return bad(
      `That session is already logged — ${formatMinutes(minutesParsed.value)} with ${profile.user.name ?? profile.user.email} on ${formatFullDate(dateParsed.value)}. Correct it instead of logging it twice.`
    );
  }

  const staff = await staffIdsFor(programId);
  const studentName = profile.user.name ?? profile.user.email;
  // Said out loud only when the mentor had a choice to make. Confirming the
  // program back to somebody who was never asked about it is noise.
  const inProgram = reachable.length > 1 ? ` in ${program.name}` : "";

  const { sessionId, sync, carved, poolAfter, added } = await prisma.$transaction(async (tx) => {
    // A name the agenda does not have yet is added to it: the mentor's item,
    // at the foot of the student's list, and with NO budget — how many hours
    // the work gets is still an admin's to plan. Looked for again here, where
    // a log of the same name a moment ago is finally visible, so the two land
    // on one item rather than two.
    let target = goal;
    let added = false;
    if (goal && goal.id === null) {
      target = await openAgendaNamed(tx, goal.purpose, profile.id, programId, mentor.id);
      if (!target) {
        const last = await tx.assignment.findFirst({
          where: { studentId: profile.id },
          orderBy: { position: "desc" },
          select: { position: true },
        });
        const item = await tx.assignment.create({
          data: {
            studentId: profile.id,
            programId,
            mentorId: mentor.id,
            purpose: goal.purpose,
            position: (last?.position ?? -1) + 1,
            // Whoever typed it, like `changedById`: on an admin's log for a
            // mentor, the admin added the item and the mentor holds it.
            createdById: actor.id,
          },
        });
        target = { id: item.id, purpose: item.purpose, unassigned: false };
        added = true;
      }
    }
    const goalId = target?.id ?? null;

    const session = await tx.session.create({
      data: {
        studentId: profile.id,
        programId,
        mentorId: mentor.id,
        assignmentId: goalId,
        minutes: minutesParsed.value,
        date: dateParsed.value,
        note,
        exchangeId,
        fromBank: bank !== null,
        ...fields,
        ...timeKindFields(kind),
      },
    });

    // The carve, when logging from the pool: what the session charges becomes
    // this mentor's own allocation, and the pool shrinks by the same amount. A
    // rescheduled meeting charges nothing, so it moves nothing. min() because
    // overdraw is warned, never blocked — logging past what the pool holds is
    // allowed, and the shortfall shows as overdraw on the mentor's new row.
    //
    // The amounts come from a re-read INSIDE the transaction: the gate's pool
    // read is stale by now if two mentors log at once, and computing from it
    // would let both carve the same hours. A pool an admin removed mid-flight
    // reads as empty — the session still logs, nothing moves.
    // Out-of-plan hours charge nothing, so there is nothing to carve: the pool
    // still belongs to whoever meets the student on the plan.
    let carved = 0;
    let poolAfter = 0;
    if (pool && !rescheduled && withinPlan) {
      const freshPool = await tx.hourAllocation.findUnique({
        where: { id: pool.id },
      });
      const available = freshPool?.minutes ?? 0;
      carved = Math.max(0, Math.min(available, minutesParsed.value));
      poolAfter = available - carved;
      if (freshPool && carved > 0) {
        // Money stays banked on the pool row: amountPaid records what was paid
        // for the original grant, not who ended up delivering it.
        await tx.hourAllocation.update({
          where: { id: freshPool.id },
          data: { minutes: poolAfter },
        });
        // A double-submit can land here with the first carve's allocation
        // already created; the second tops it up instead of violating the
        // (student, mentor) unique index.
        const mine = await tx.hourAllocation.findUnique({
          where: {
            studentId_programId_mentorId: {
              studentId: profile.id,
              programId,
              mentorId: mentor.id,
            },
          },
        });
        const mineBefore = mine?.minutes ?? 0;
        const mineAfter = mineBefore + carved;
        if (mine) {
          await tx.hourAllocation.update({
            where: { id: mine.id },
            data: { minutes: mineAfter },
          });
        } else {
          await tx.hourAllocation.create({
            data: {
              studentId: profile.id,
              programId,
              mentorId: mentor.id,
              minutes: carved,
              deadline: freshPool.deadline,
              // The pool's own exchange, not the enrollment's: hours carved out
              // of an exchange pool are still that exchange's hours, and a new
              // row without the link would put them outside its cap.
              exchangeId: freshPool.exchangeId,
            },
          });
        }
        // Both sides of the hand-off audited, so the allocation history reads
        // where the pool's hours went.
        // `changedById` is whoever made the change, which is the person who
        // pressed the button — not the mentor whose name the hours now carry.
        await tx.hourAllotmentChange.createMany({
          data: [
            {
              studentId: profile.id,
              programId,
              mentorId: null,
              changedById: actor.id,
              oldMinutes: available,
              newMinutes: poolAfter,
            },
            {
              studentId: profile.id,
              programId,
              mentorId: mentor.id,
              changedById: actor.id,
              oldMinutes: mineBefore,
              newMinutes: mineAfter,
            },
          ],
        });
      }
    }

    // A named task that had no mentor yet: logging against it claims it.
    if (target?.unassigned && goalId) {
      await tx.assignment.update({
        where: { id: goalId },
        data: { mentorId: mentor.id },
      });
    }

    // Progress follows the hours: this may move the task to In progress, or
    // finish it outright if the logged total reached its limit. A session that
    // names no task moves nothing.
    const synced = goalId ? await syncGoalProgress(tx, goalId) : null;

    await notify(tx, {
      to: [profile.userId],
      type: NOTIFICATION_TYPES.SESSION_LOGGED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: rescheduled
        ? `${mentorLabel} recorded that your ${formatMinutes(minutesParsed.value)} meeting on ${formatFullDate(dateParsed.value)}${forTask} was rescheduled. No time was charged.`
        : !withinPlan
          ? `${mentorLabel} logged ${formatDuration(minutesParsed.value)} extra hours on ${formatFullDate(dateParsed.value)}${toward} — work on top of your plan, so none of your time was used.`
          : state === ATTENDANCE.ABSENT
            ? `${mentorLabel} recorded a ${formatMinutes(minutesParsed.value)} no-show on ${formatFullDate(dateParsed.value)}${forTask}. Those hours were still deducted.`
            : `${mentorLabel} logged a ${formatMinutes(minutesParsed.value)} session on ${formatFullDate(dateParsed.value)}${toward}${state === ATTENDANCE.LATE ? ", which you came late to" : ""}.`,
    });

    // Staff watch delivery across every program, so a logged session is news
    // to them as much as to the student.
    // The mentor whose name is on it, when somebody else put it there. They
    // are usually not staff, so the notice below would never reach them — and
    // a session in their log they did not write is the one thing they cannot
    // be left to discover.
    if (onBehalf) {
      await notify(tx, {
        to: [mentor.id],
        type: NOTIFICATION_TYPES.SESSION_LOGGED,
        actorId: actor.id,
        href: notificationHref.adminStudent(profile.id),
        message: `${actor.name ?? actor.email} logged ${formatMinutes(minutesParsed.value)} with ${studentName} on ${formatFullDate(dateParsed.value)} in your name. Correct it on the sessions log if it is wrong.`,
      });
    }

    await notify(tx, {
      to: staff,
      type: NOTIFICATION_TYPES.SESSION_LOGGED,
      actorId: actor.id,
      href: notificationHref.adminStudent(profile.id),
      message:
        (rescheduled
          ? `${mentorLabel} rescheduled a ${formatMinutes(minutesParsed.value)} meeting with ${studentName} on ${formatFullDate(dateParsed.value)}${forTask} — no time charged.`
          : !withinPlan
            ? `${mentorLabel} logged ${formatMinutes(minutesParsed.value)} with ${studentName} on ${formatFullDate(dateParsed.value)}${toward} as EXTRA — outside the plan, so no allocation was charged.`
            : state === ATTENDANCE.ABSENT
              ? `${mentorLabel} recorded a ${formatMinutes(minutesParsed.value)} no-show for ${studentName} on ${formatFullDate(dateParsed.value)}${forTask}.`
              : `${mentorLabel} logged ${formatMinutes(minutesParsed.value)} with ${studentName} on ${formatFullDate(dateParsed.value)}${toward}${state === ATTENDANCE.LATE ? " (came late)" : ""}.`) +
        // An agenda item nobody planned is the admin's to budget, so they
        // hear that it now exists.
        (added && target
          ? ` "${target.purpose}" was added to their agenda, with no hours planned for it yet.`
          : "") +
        // The hand-off is news an admin would otherwise reconstruct from the
        // allocation history: the pool chose its mentor.
        (carved > 0
          ? ` The time came out of the unassigned pool (${formatDuration(poolAfter)} remaining in it).`
          : "") +
        // Past the hours' use-by is allowed now, but it is still a fact the
        // program's staff should read plainly rather than infer from totals.
        (lateDeadline
          ? ` Logged past the ${formatFullDate(lateDeadline)} deadline.`
          : "") +
        // Who actually typed it. The row says the mentor delivered the hours,
        // which is true; this says the mentor did not report them, which is
        // the part another admin needs when the log is queried later.
        (onBehalf ? ` Logged by ${actor.name ?? actor.email} on their behalf.` : ""),
    });

    if (synced?.becameDone) {
      await notify(tx, {
        to: staff,
        type: NOTIFICATION_TYPES.GOAL_DONE,
        actorId: actor.id,
        href: notificationHref.adminStudent(profile.id),
        message: `"${synced.purpose}" for ${studentName} is complete: ${formatMinutes(synced.loggedMinutes)} of ${formatMinutes(synced.minuteLimit ?? 0)} planned hours logged.`,
      });
    }
    return { sessionId: session.id, sync: synced, carved, poolAfter, added };
  });

  revalidatePath("/", "layout");

    // The outcome as separate clauses rather than one built sentence, so
  // `/sessions/new` can show the headline large, the consequences under it, and
  // a link to the row itself. `message` is still the whole thing joined, for
  // the forms that show one line of feedback.
  const notes: string[] = [];
  if (state !== ATTENDANCE.ATTENDED) {
    notes.push(`Recorded as ${ATTENDANCE_META[state].label.toLowerCase()}.`);
  }
  if (lateDeadline) {
    notes.push(
      `These hours were to be used by ${formatFullDate(lateDeadline)} — logged past the deadline.`
    );
  }
  if (added && goal) {
    notes.push(`Added "${goal.purpose}" to their agenda.`);
  }
  // Tell the mentor what their own log just did to the task, so an automatic
  // status change is never a surprise they discover later.
  if (sync?.becameDone) {
    notes.push(
      `"${sync.purpose}" hit its ${formatMinutes(sync.minuteLimit ?? 0)} limit and is now marked done.`
    );
  } else if (sync?.changed) {
    notes.push(`"${sync.purpose}" is now in progress.`);
  }
  // Out-of-plan first: none of the balance arithmetic below applies to hours
  // that were never going to move a balance.
  let headline: string;
  if (!withinPlan) {
    headline = `Logged ${formatMinutes(minutesParsed.value)} with ${studentName}${inProgram} as extra time.`;
    notes.push(`On top of the plan, so their balance is unchanged.`);
  } else if (rescheduled) {
    headline = `Rescheduled meeting with ${studentName}${inProgram} recorded — no time charged.`;
    if (bank) {
      notes.push("Their hour bank is untouched.");
    } else if (pool) {
      notes.push("Their unassigned pool is untouched.");
    } else if (allocation) {
      const left = await remainingWith(
        profile.id,
        programId,
        mentor.id,
        allocation.minutes
      );
      notes.push(`${formatDuration(left)} remaining with ${theirs}.`);
    }
    // Nothing allocated means no balance to reassure anyone about — "0h
    // remaining with you" would read as a loss.
  } else if (bank) {
    const left = await bankRemaining(prisma, bank);
    headline = `Logged ${formatMinutes(minutesParsed.value)} with ${studentName}${inProgram}.`;
    notes.push(
      left >= 0
        ? `${formatDuration(left)} left in their hour bank.`
        : `Heads up: their hour bank is now overdrawn by ${formatDuration(-left)}. Ask an admin to add to it, or correct this session to extra time.`
    );
  } else if (pool) {
    // What the carve just did, in the mentor's terms: these hours are theirs
    // now, and here is what the pool still holds for whoever meets them next.
    const short = Number((minutesParsed.value - carved).toFixed(2));
    headline = `Logged ${formatMinutes(minutesParsed.value)} with ${studentName}${inProgram}.`;
    notes.push(
      short > 0
        ? `${formatDuration(carved)} unassigned minutes moved to ${theirs} — the pool came up ${formatDuration(short)} short, so they are overdrawn with ${theirs}.`
        : `${formatDuration(carved)} of their unassigned minutes moved to ${theirs}; ${formatDuration(poolAfter)} remain in the pool.`
    );
  } else {
    const remaining = await remainingWith(
      profile.id,
      programId,
      mentor.id,
      allocation?.minutes ?? 0
    );
    headline = `Logged ${formatMinutes(minutesParsed.value)} with ${studentName}${inProgram}.`;
    notes.push(
      remaining >= 0
        ? `${formatDuration(remaining)} remaining with ${theirs}.`
        : allocation
          ? `Heads up: they are now overdrawn by ${formatDuration(-remaining)} with ${theirs}.`
          : // No allocation at all, so this overdraw isn't a balance run down —
            // it is time nobody has granted yet. Name the two ways out rather
            // than leaving a red number the mentor can't act on.
            `Heads up: no time is allocated to ${theirs} for them, so they are overdrawn by ${formatDuration(-remaining)} with ${theirs}. Ask an admin to allocate it, or correct this session to extra time.`
    );
  }

  return {
    ok: true,
    message: [headline, ...notes].join(" "),
    receipt: {
      id: sessionId,
      headline,
      notes,
      subject: { kind: "student", id: profile.id, name: studentName },
    },
  };
}

/** A session with everyone the corrections notify: student, user, mentor. */
type LoggedSession = Prisma.SessionGetPayload<{
  include: { student: { include: { user: true } }; mentor: true };
}>;

/** The session to correct, or which refusal the caller should say. */
type SessionAuthority =
  | { ok: true; actor: User; session: LoggedSession }
  /** No session at all is theirs to correct: signed out, or neither of the two. */
  | { ok: false; refusal: "actor" }
  /** Not THIS one. `isAdmin` picks which of the two sentences fits. */
  | { ok: false; refusal: "session"; isAdmin: boolean };

/**
 * Who may change a logged session: the mentor who logged it, and an admin of
 * the program its student is in.
 *
 * A mentor owns their own log — correcting yesterday's hours shouldn't need
 * anyone's permission. An admin owns the ledger, and rows arrive in it that no
 * mentor will ever fix: a duplicate from the spreadsheet import, a session
 * logged against the wrong student, a test row. Without this, the only way to
 * remove one was the database.
 *
 * The admin half used to be the role, and so reached every mentor's hours in
 * every program — the escalation the grants model exists to end. It is the
 * student's program now, which is why loading the row and authorizing it are
 * ONE step: the question cannot be asked until the session says whose student
 * it is. Anything but a voided session can be corrected — a rescheduled one is
 * a live record, and correcting it back to attended is exactly how a mis-tick
 * is fixed.
 *
 * A refusal never separates "gone" from "voided" from "another program's":
 * telling those apart is how somebody maps a ledger they cannot read.
 */
/**
 * The student's answer to a session their mentor logged.
 *
 * The one write in this file a STUDENT may make, and the reason it exists: the
 * ledger's promise is that these numbers are trusted by everyone, and until
 * now a mentor's word moved a student's balance with nowhere for the student
 * to say "that did not happen" or "it was thirty minutes". Confirming is the
 * ordinary case and takes one tap; disputing raises a flag with their words on
 * it.
 *
 * IT MOVES NO BALANCE, either way. A dispute is a fact an admin acts on by
 * correcting or voiding the session — both audited writes that notify — and a
 * button that reversed a charge directly would be a button that reversed one
 * by accident. This is the same reason `attended: false` still charges: the
 * ledger records what happened and a human decides what it means.
 *
 * Answering again is allowed and overwrites: a student who taps Confirm and
 * then remembers the meeting ran short must be able to say so, and the
 * alternative is asking an admin to undo an answer nobody disputes.
 */
export async function answerSession(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to do that." };

  const sessionId = String(formData.get("sessionId") ?? "");
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      student: { include: { user: true } },
      mentor: true,
      program: true,
    },
  });
  // "Not yours" and "does not exist" answer identically, so the error cannot be
  // used to find out which sessions exist.
  if (!session || session.student.userId !== user.id) {
    return { ok: false, error: "That session is not yours." };
  }
  if (session.status !== SESSION_STATUS.ACTIVE) {
    return {
      ok: false,
      error: "That session was already corrected — nothing to answer.",
    };
  }

  const raw = String(formData.get("answer") ?? "").toUpperCase();
  if (raw !== SESSION_ANSWER.CONFIRMED && raw !== SESSION_ANSWER.DISPUTED) {
    return { ok: false, error: "Say whether the session happened." };
  }
  const disputed = raw === SESSION_ANSWER.DISPUTED;

  const noteRaw = String(formData.get("studentNote") ?? "").trim();
  // A dispute with no words is a flag nobody can act on: the mentor and the
  // admin both need to know WHAT is wrong before either can correct it.
  if (disputed && noteRaw.length === 0) {
    return { ok: false, error: "Say what was wrong, so it can be corrected." };
  }
  const note = noteRaw.slice(0, 1000) || null;

  const ratingRaw = Number(formData.get("studentRating") ?? 0);
  const rating =
    Number.isInteger(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5
      ? ratingRaw
      : null;

  await prisma.session.update({
    where: { id: session.id },
    data: {
      studentAnswer: raw,
      studentAnsweredAt: new Date(),
      studentNote: note,
      // A rating belongs to a session that happened. Keeping one on a disputed
      // row would be rating a meeting the student says did not take place.
      studentRating: disputed ? null : rating,
    },
  });

  const who = session.student.user.name ?? session.student.user.email;
  const when = formatFullDate(session.date);
  const staff = disputed ? await staffIdsFor(session.programId) : [];
  await notify(prisma, {
    // The mentor always hears it. Staff hear only a dispute — a stream of
    // "confirmed" rows is not something an admin can act on.
    to: [session.mentorId, ...staff],
    type: NOTIFICATION_TYPES.SESSION_ANSWERED,
    actorId: user.id,
    href: notificationHref.adminStudent(session.studentId),
    message: disputed
      ? `${who} disputes the ${formatMinutes(session.minutes)} logged on ${when}: "${note}"`
      : `${who} confirmed the ${formatMinutes(session.minutes)} logged on ${when}.` +
        (rating ? ` They rated it ${rating}/5.` : ""),
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: disputed
      ? "Thank you — your mentor and your program have been told."
      : "Confirmed. Thank you.",
  };
}

async function requireSessionAuthority(
  sessionId: string
): Promise<SessionAuthority> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, refusal: "actor" };
  const scope = await adminWriteScope(actor);
  const administers = !scopeIsEmpty(scope);
  const isMentor = canActAsMentor(actor) && actor.status === USER_STATUS.ACTIVE;
  if (!administers && !isMentor) return { ok: false, refusal: "actor" };

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { student: { include: { user: true } }, mentor: true },
  });
  const mine = isMentor && session?.mentorId === actor.id;
  // The SESSION's program, not its student's: the row says which program's
  // hours it drew, and a student in two programs must not make their Master's
  // Program ledger correctable by Global Admissions' admin.
  const inScope = session !== null && scopeCovers(scope, session.programId);
  if (
    !session ||
    session.status === SESSION_STATUS.VOIDED ||
    (!mine && !inScope)
  ) {
    return { ok: false, refusal: "session", isAdmin: administers };
  }
  return { ok: true, actor, session };
}

/**
 * Correct a logged session — its task, hours, date, notes, or how the meeting
 * went. The hour delta flows through derived totals; the student is told, and so
 * is the mentor when it wasn't them who made the change.
 */
export async function editSession(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await requireSessionAuthority(
    String(formData.get("sessionId") ?? "")
  );
  if (!auth.ok) {
    return {
      ok: false,
      error:
        auth.refusal === "actor"
          ? "Only the mentor who logged a session, or an admin, can edit it."
          : auth.isAdmin
            ? "That session is gone, already voided, or isn't in a program you administer."
            : "You can only edit sessions you logged yourself, and not voided ones.",
    };
  }
  const { actor, session } = auth;

  const minutesParsed = parseMinutesField(formData.get("minutes"), {
    min: 0.01,
    // One session is a day at the very most.
    max: MAX_SESSION_MINUTES,
    label: "Minutes",
  });
  if ("error" in minutesParsed) return { ok: false, error: minutesParsed.error };
  const dateParsed = parseDateField(formData.get("date"));
  if ("error" in dateParsed) return { ok: false, error: dateParsed.error };
  // Only a date being CHANGED is held to it: a row already dated ahead (an
  // import, an old typo) must stay correctable in its minutes and note, and the
  // way to fix its date is to pick a real one.
  if (
    dateParsed.value.getTime() !== session.date.getTime() &&
    isFuture(dateParsed.value)
  ) {
    return { ok: false, error: FUTURE_REFUSAL };
  }
  const note = String(formData.get("note") ?? "").trim() || null;
  const state = readAttendance(formData.get("attendance"));
  const fields = attendanceFields(state);
  const kind = readHoursKind(formData.get("timeKind"));

  // The task can be corrected here, but is not forced: sessions logged before
  // tasks existed have none, and re-picking one to fix a typo in the hours
  // would be a strange thing to demand. It stays scoped to the mentor who ran
  // the meeting, even when an admin is the one correcting it.
  const rawGoal = String(formData.get("assignmentId") ?? "").trim();
  let assignmentId = session.assignmentId;
  if (rawGoal && rawGoal !== session.assignmentId) {
    const resolved = await resolveGoal(
      rawGoal,
      session.studentId,
      session.programId,
      session.mentorId
    );
    if ("error" in resolved) return { ok: false, error: resolved.error };
    assignmentId = resolved.value?.id ?? null;
  }

  // A deadline never refuses a new log, so it refuses a correction no more:
  // a use-by date is displayed, not enforced, and moving a session's date or
  // making it in-plan is the same act done after the fact. What used to be a
  // refusal is now only which allocation the charge lands on below.
  const charges = timeKindFields(kind).withinPlan;
  // Becoming in-plan is a new charge, and against a bank when the student has
  // one and the mentor holds no share of it; a session that was already
  // in-plan stays on whatever it was drawing.
  const bankRow = charges
    ? await bankDrawnBy(prisma, session.studentId, session.programId, session.mentorId)
    : null;
  const fromBank = !charges ? false : session.withinPlan ? session.fromBank : bankRow !== null;

  const wasState = attendanceOf(session);
  const attendanceNote =
    state === wasState ? "" : ` Now marked as ${ATTENDANCE_META[state].label.toLowerCase()}.`;
  // Flipping this moves hours into or out of a balance, so it is stated plainly
  // rather than left for someone to notice in a total.
  const wasKind = timeKindOf(session);
  const kindNote =
    kind === wasKind
      ? ""
      : kind === TIME_KIND.EXTRA
        ? " These hours are now extra, on top of the plan — they no longer count against the allocation."
        : " These hours now count against the allocation.";
  const staff = await staffIdsFor(session.programId);
  const actorLabel = actor.name ?? actor.email;
  const mentorLabel = session.mentor.name ?? session.mentor.email;
  const studentName = session.student.user.name ?? session.student.user.email;
  const whose = session.mentorId === actor.id ? "a session" : `${mentorLabel}'s session`;
  const change = describeSessionChange(
    { minutes: session.minutes, date: session.date },
    { minutes: minutesParsed.value, date: dateParsed.value }
  );

  await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: session.id },
      data: {
        assignmentId,
        minutes: minutesParsed.value,
        date: dateParsed.value,
        note,
        fromBank,
        ...fields,
        ...timeKindFields(kind),
      },
    });

    // Both tasks: the hours left the old one and arrived at the new one, so each
    // has to be re-derived. A task that was auto-completed by these hours drops
    // back to In progress on its own when they move away.
    for (const id of new Set(
      [session.assignmentId, assignmentId].filter((v): v is string => !!v)
    )) {
      await syncGoalProgress(tx, id);
    }

    await notify(tx, {
      // notify() drops the actor, so the mentor only hears about it when someone
      // else changed their log.
      to: [session.student.userId, session.mentorId],
      type: NOTIFICATION_TYPES.SESSION_EDITED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `${actorLabel} corrected ${whose}: ${change}.${attendanceNote}${kindNote}`,
    });
    await notify(tx, {
      to: staff,
      type: NOTIFICATION_TYPES.SESSION_EDITED,
      actorId: actor.id,
      href: notificationHref.adminStudent(session.studentId),
      message: `${actorLabel} corrected ${whose} with ${studentName}: ${change}.${attendanceNote}${kindNote}`,
    });
  });

  const task = assignmentId
    ? await prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { id: true, purpose: true },
      })
    : null;

  // Inline autosave must not refresh the route underneath the editor. The
  // session is already persisted, and the next navigation reads the updated
  // ledger; revalidating the layout here would reset the open popover on every
  // field change.
  return {
    ok: true,
    message: "Session updated.",
    session: {
      minutes: minutesParsed.value,
      date: dateParsed.value.toISOString(),
      note,
      assignmentId,
      ...fields,
      ...timeKindFields(kind),
      task,
    },
  };
}

/** Void a session logged in error — the row stays, the hours go back. */
export async function voidSession(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await requireSessionAuthority(
    String(formData.get("sessionId") ?? "")
  );
  if (!auth.ok) {
    return {
      ok: false,
      error:
        auth.refusal === "actor"
          ? "Only the mentor who logged a session, or an admin, can void it."
          : auth.isAdmin
            ? "That session is gone, already voided, or isn't in a program you administer."
            : "You can only void sessions you logged yourself, and not twice.",
    };
  }
  const { actor, session } = auth;

  const staff = await staffIdsFor(session.programId);
  const actorLabel = actor.name ?? actor.email;
  const mentorLabel = session.mentor.name ?? session.mentor.email;
  const studentName = session.student.user.name ?? session.student.user.email;
  const whose = session.mentorId === actor.id ? "the" : `${mentorLabel}'s`;

  await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: session.id },
      data: { status: SESSION_STATUS.VOIDED },
    });

    // Voiding returns the hours, so a task these hours had completed reopens.
    if (session.assignmentId) {
      await syncGoalProgress(tx, session.assignmentId);
    }

    await notify(tx, {
      to: [session.student.userId, session.mentorId],
      type: NOTIFICATION_TYPES.SESSION_VOIDED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `${actorLabel} voided ${whose} ${formatMinutes(session.minutes)} session from ${formatFullDate(session.date)}. That time is back in the balance.`,
    });
    await notify(tx, {
      to: staff,
      type: NOTIFICATION_TYPES.SESSION_VOIDED,
      actorId: actor.id,
      href: notificationHref.adminStudent(session.studentId),
      message: `${actorLabel} voided ${whose} ${formatMinutes(session.minutes)} session with ${studentName} from ${formatFullDate(session.date)}; the hours went back.`,
    });
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Session voided; hours returned." };
}

/**
 * Remove a logged session outright (admin only). Voiding is the mentor's tool —
 * it keeps the row as history and hands the hours back. Deleting is for rows
 * that should never have been history at all: a duplicate the spreadsheet import
 * brought in twice, a meeting logged against the wrong student, a test entry.
 * The hours return the same way, and everyone who could see the row is told.
 */
/**
 * Put a voided session back. The inverse of `voidSession`, which had none.
 *
 * A void was one-way: `requireSessionAuthority` refuses a voided row, so once
 * voided a session could not be corrected and could not be un-voided — the
 * only remaining tool was Delete, which throws the record away. So the fix for
 * one mis-tap was to destroy the row and log it again from memory, losing the
 * date, the note and the task it was against.
 *
 * Charges the time again, because that is what restoring means: the meeting
 * happened after all. A task the hours had completed re-closes, the same way
 * voiding reopened it.
 *
 * Its own gate rather than `requireSessionAuthority`, whose whole job is to
 * refuse voided rows — the one action that needs a voided row cannot be built
 * on the check that rejects them.
 */
export async function restoreSession(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };
  const scope = await adminWriteScope(actor);
  const administers = !scopeIsEmpty(scope);
  const isMentor = canActAsMentor(actor) && actor.status === USER_STATUS.ACTIVE;
  if (!administers && !isMentor) {
    return { ok: false, error: "Only the mentor who logged a session, or an admin, can restore it." };
  }

  const session = await prisma.session.findUnique({
    where: { id: String(formData.get("sessionId") ?? "") },
    include: { student: { include: { user: true } }, mentor: true },
  });
  const mine = isMentor && session?.mentorId === actor.id;
  const inScope = session !== null && scopeCovers(scope, session.programId);
  if (!session || (!mine && !inScope)) {
    return { ok: false, error: "That session no longer exists." };
  }
  if (session.status !== SESSION_STATUS.VOIDED) {
    return { ok: true, message: "That session is already counting." };
  }
  // Voiding is how a program is cleared before a student is taken off it (or
  // an exchange returned), so a voided session can outlive the membership it
  // was logged under. Restoring it then would charge hours in a program the
  // student is no longer in, where no roster shows them and no admin sees it.
  const member = await prisma.studentEnrollment.findFirst({
    where: { studentId: session.studentId, programId: session.programId },
    select: { id: true },
  });
  if (!member) {
    return {
      ok: false,
      error: "The student is no longer in the program this session was logged in, so it can't be restored.",
    };
  }

  const staff = await staffIdsFor(session.programId);
  const actorLabel = actor.name ?? actor.email;
  const mentorLabel = session.mentor.name ?? session.mentor.email;
  const studentName = session.student.user.name ?? session.student.user.email;
  const whose = session.mentorId === actor.id ? "the" : `${mentorLabel}'s`;

  await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: session.id },
      data: { status: SESSION_STATUS.ACTIVE },
    });
    // The hours count again, so work these hours had finished is finished.
    if (session.assignmentId) {
      await syncGoalProgress(tx, session.assignmentId);
    }
    await notify(tx, {
      to: [session.student.userId, session.mentorId],
      type: NOTIFICATION_TYPES.SESSION_EDITED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `${actorLabel} restored ${whose} ${formatMinutes(session.minutes)} session from ${formatFullDate(session.date)}. That time is charged again.`,
    });
    await notify(tx, {
      to: staff,
      type: NOTIFICATION_TYPES.SESSION_EDITED,
      actorId: actor.id,
      href: notificationHref.adminStudent(session.studentId),
      message: `${actorLabel} restored ${whose} ${formatMinutes(session.minutes)} session with ${studentName} from ${formatFullDate(session.date)}; the hours are charged again.`,
    });
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Session restored; hours charged again." };
}

export async function deleteSession(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  // Asked before the row is loaded, and deliberately: it is a fact about the
  // person, not about any session, so a mentor is pointed at the tool they do
  // have without a probe learning whether the id they guessed exists.
  if (!actor || scopeIsEmpty(await adminWriteScope(actor))) {
    return {
      ok: false,
      error: "Only admins can delete a session. Mentors can void their own instead, which keeps the record.",
    };
  }

  const sessionId = String(formData.get("sessionId") ?? "");
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { student: { include: { user: true } }, mentor: true },
  });
  // Which programs an admin holds decides which rows they may remove, and the
  // student is what says which program this row is in — so the fetch comes
  // first and the gate second. One sentence for both outcomes: an id that finds
  // nothing and an id in someone else's program must read the same, or deleting
  // becomes a way to enumerate a ledger you can't see.
  if (!session || !(await canManageProgram(actor, session.programId))) {
    return {
      ok: false,
      error: "That session is gone, or isn't in a program you administer.",
    };
  }

  const staff = await staffIdsFor(session.programId);
  const actorLabel = actor.name ?? actor.email;
  const mentorLabel = session.mentor.name ?? session.mentor.email;
  const studentName = session.student.user.name ?? session.student.user.email;
  const wasCharging = session.status === SESSION_STATUS.ACTIVE;
  const what = `${formatMinutes(session.minutes)} session with ${mentorLabel} from ${formatFullDate(session.date)}`;
  const hoursNote = wasCharging ? " That time is back in the balance." : "";

  await prisma.$transaction(async (tx) => {
    await tx.session.delete({ where: { id: session.id } });

    // The hours left with the row, so anything they had finished reopens.
    if (session.assignmentId) {
      await syncGoalProgress(tx, session.assignmentId);
    }

    await notify(tx, {
      to: [session.student.userId, session.mentorId],
      type: NOTIFICATION_TYPES.SESSION_DELETED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `${actorLabel} removed the ${what} from the log.${hoursNote}`,
    });
    await notify(tx, {
      to: staff,
      type: NOTIFICATION_TYPES.SESSION_DELETED,
      actorId: actor.id,
      href: notificationHref.adminStudent(session.studentId),
      message: `${actorLabel} removed a ${what} for ${studentName}.${hoursNote}`,
    });
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `Session removed.${hoursNote}`,
  };
}
