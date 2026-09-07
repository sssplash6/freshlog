"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/dal";
import {
  adminScope,
  canManageProgram,
  mentorReaches,
  scopeCovers,
  scopeIsEmpty,
} from "@/lib/authz";
import type { Prisma, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ATTENDANCE,
  ATTENDANCE_META,
  attendanceFields,
  attendanceOf,
  canActAsMentor,
  CHARGED_SESSION,
  TIME_KIND,
  TIME_KIND_META,
  timeKindFields,
  timeKindOf,
  INTERVIEW_STATUS,
  NOTIFICATION_TYPES,
  SESSION_ANSWER,
  SESSION_STATUS,
  USER_STATUS,
} from "@/lib/constants";
import {
  formatDate,
  formatDuration,
  formatMeetingWhen,
  formatMinutes,
} from "@/lib/format";
import { syncGoalProgress } from "@/lib/goal-progress";
import { notify, notificationHref, staffIdsFor } from "@/lib/notify";
import {
  parseDateField,
  parseMinutesField,
  type ActionState,
} from "@/lib/actions/shared";
import { reachablePrograms } from "@/lib/queries";

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

/** Midnight UTC on the day of `d`. */
function dayStart(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

/**
 * Retire the diary entry this session delivered, if there was one: a meeting
 * the same mentor had scheduled with the same student on the same day, still
 * open, not already tied to a session. Matching on the DAY rather than asking
 * the mentor to pick one keeps logging a single form — they already told us who
 * and when — and the worst a wrong match can do is close a meeting that did in
 * fact happen that day.
 *
 * Skipped for a rescheduled session: nothing was delivered, so the meeting is
 * still owed an outcome.
 */
async function closeScheduledMeeting(
  tx: Prisma.TransactionClient,
  {
    studentId,
    mentorId,
    date,
    sessionId,
  }: { studentId: string; mentorId: string; date: Date; sessionId: string }
) {
  const from = dayStart(date);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const meeting = await tx.interview.findFirst({
    where: {
      studentId,
      mentorId,
      sessionId: null,
      status: {
        in: [
          INTERVIEW_STATUS.PROPOSED,
          INTERVIEW_STATUS.CONFIRMED,
          INTERVIEW_STATUS.DECLINED,
        ],
      },
      scheduledAt: { gte: from, lt: to },
    },
    orderBy: { scheduledAt: "asc" },
  });
  if (!meeting) return null;

  await tx.interview.update({
    where: { id: meeting.id },
    data: { status: INTERVIEW_STATUS.HELD, sessionId },
  });
  return meeting;
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
  mentorId: string
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
    return { error: "That task isn't one of yours for this student." };
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
  "studentProfileId",
  "programId",
  "assignmentId",
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

  const mentor = await requireActiveMentor();
  if (!mentor) {
    return bad("Only assigned mentors can log sessions.");
  }

  const studentProfileId = String(formData.get("studentProfileId") ?? "");
  const minutesParsed = parseMinutesField(formData.get("minutes"), {
    min: 0.01,
    label: "Minutes",
  });
  if ("error" in minutesParsed) return bad(minutesParsed.error, "minutes");
  const dateParsed = parseDateField(formData.get("date"));
  if ("error" in dateParsed) return bad(dateParsed.error, "date");
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
      "You aren't assigned to that student's program, so you can't log hours for them.",
      "studentProfileId"
    );
  }

  // WHICH program this meeting was for. A student may be enrolled in several,
  // and each holds its own time with its own deadline, so a session that could
  // not say which one it spent would spend the wrong one. The mentor is asked
  // only when the answer is genuinely more than one; with a single shared
  // program — which is nearly every meeting — the form fills it in silently.
  const reachable = await reachablePrograms(mentor.id, profile);
  const named = String(formData.get("programId") ?? "").trim();
  const programId = named
    ? reachable.find((p) => p.id === named)?.id
    : reachable.length === 1
      ? reachable[0].id
      : undefined;
  if (!programId) {
    return bad(
      named
        ? "You don't work in that program, or the student isn't in it."
        : reachable.length === 0
          ? "You aren't assigned to any program this student is in, so you can't log hours for them."
          : "This student is in more than one of your programs — pick which one this session was for.",
      "programId"
    );
  }
  const program = reachable.find((p) => p.id === programId)!;

  // Sessions draw down hours an admin allocated to THIS mentor in THIS
  // program — or, when the mentor holds none, the student's unassigned pool
  // there: those hours deliberately named no mentor yet, and logging is the act
  // that decides one. The logged hours are carved out of the pool into this
  // mentor's own allocation inside the transaction below, so every number
  // afterwards reads the same as if an admin had granted them directly.
  const allocation = await prisma.hourAllocation.findUnique({
    where: {
      studentId_programId_mentorId: {
        studentId: profile.id,
        programId,
        mentorId: mentor.id,
      },
    },
  });
  const pool = allocation
    ? null
    : await prisma.hourAllocation.findFirst({
        where: { studentId: profile.id, programId, mentorId: null },
      });

  // Whether the hours charge is the mentor's own answer to "Whose hours?", and
  // nothing else: it is NOT inferred from what the student happens to hold.
  // In-plan against an empty balance overdraws — warned, never blocked, exactly
  // as in-plan past a balance always has — because the alternative is a mentor
  // choosing between misreporting the meeting as extra and not logging it.

  // Deadlines are hard: once passed, the unused hours are forfeited and no
  // further sessions can be logged against this allocation. A rescheduled
  // meeting charges nothing, but recording one against expired hours would still
  // be recording work on a pool that is closed.
  //
  // Out-of-plan hours are exempt, and deliberately so: an expired deadline means
  // the student's remaining hours are gone, not that a mentor who kept helping
  // them afterwards has nowhere to record it.
  //
  // A student holding nothing at all has no deadline to be past: an expired
  // allocation is a positive statement that the time is over, where an absent
  // one is only an absence. The first closes in-plan logging; the second
  // overdraws.
  const source = withinPlan ? (allocation ?? pool) : null;
  if (source && source.deadline.getTime() < Date.now()) {
    return bad(
      `These hours expired on ${formatDate(source.deadline)} and can no longer be logged against. Ask an admin to extend the deadline, allocate new hours, or log this as extra hours.`,
      "timeKind"
    );
  }

  // Checked after reach, so a mentor who may not log for this student at all
  // hears that first rather than being told about a task they can't use.
  const resolved = await resolveGoal(
    formData.get("assignmentId"),
    profile.id,
    programId,
    mentor.id
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
      `That session is already logged — ${formatMinutes(minutesParsed.value)} with ${profile.user.name ?? profile.user.email} on ${formatDate(dateParsed.value)}. Correct it instead of logging it twice.`
    );
  }

  const staff = await staffIdsFor(programId);
  const mentorLabel = mentor.name ?? mentor.email;
  const studentName = profile.user.name ?? profile.user.email;
  // Said out loud only when the mentor had a choice to make. Confirming the
  // program back to somebody who was never asked about it is noise.
  const inProgram = reachable.length > 1 ? ` in ${program.name}` : "";

  const { sessionId, sync, carved, poolAfter, meeting } = await prisma.$transaction(async (tx) => {
    const session = await tx.session.create({
      data: {
        studentId: profile.id,
        programId,
        mentorId: mentor.id,
        assignmentId: goal?.id ?? null,
        minutes: minutesParsed.value,
        date: dateParsed.value,
        note,
        ...fields,
        ...timeKindFields(kind),
      },
    });

    // A meeting that was in the diary for that day has now happened, whoever
    // paid for it: it leaves the upcoming list and points at the hours it
    // became. A rescheduled session delivered nothing, so it retires nothing.
    const meeting = rescheduled
      ? null
      : await closeScheduledMeeting(tx, {
          studentId: profile.id,
          mentorId: mentor.id,
          date: dateParsed.value,
          sessionId: session.id,
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
            },
          });
        }
        // Both sides of the hand-off audited, so the allocation history reads
        // where the pool's hours went.
        await tx.hourAllotmentChange.createMany({
          data: [
            {
              studentId: profile.id,
              programId,
              mentorId: null,
              changedById: mentor.id,
              oldMinutes: available,
              newMinutes: poolAfter,
            },
            {
              studentId: profile.id,
              programId,
              mentorId: mentor.id,
              changedById: mentor.id,
              oldMinutes: mineBefore,
              newMinutes: mineAfter,
            },
          ],
        });
      }
    }

    // A named task that had no mentor yet: logging against it claims it.
    if (goal?.unassigned) {
      await tx.assignment.update({
        where: { id: goal.id },
        data: { mentorId: mentor.id },
      });
    }

    // Progress follows the hours: this may move the task to In progress, or
    // finish it outright if the logged total reached its limit. A session that
    // names no task moves nothing.
    const synced = goal ? await syncGoalProgress(tx, goal.id) : null;

    await notify(tx, {
      to: [profile.userId],
      type: NOTIFICATION_TYPES.SESSION_LOGGED,
      actorId: mentor.id,
      href: notificationHref.studentHome(),
      message: rescheduled
        ? `${mentorLabel} recorded that your ${formatMinutes(minutesParsed.value)} meeting on ${formatDate(dateParsed.value)}${forTask} was rescheduled. No time was charged.`
        : !withinPlan
          ? `${mentorLabel} logged ${formatDuration(minutesParsed.value)} extra hours on ${formatDate(dateParsed.value)}${toward} — work on top of your plan, so none of your time was used.`
          : state === ATTENDANCE.ABSENT
            ? `${mentorLabel} recorded a ${formatMinutes(minutesParsed.value)} no-show on ${formatDate(dateParsed.value)}${forTask}. Those hours were still deducted.`
            : `${mentorLabel} logged a ${formatMinutes(minutesParsed.value)} session on ${formatDate(dateParsed.value)}${toward}${state === ATTENDANCE.LATE ? ", which you came late to" : ""}.`,
    });

    // Staff watch delivery across every program, so a logged session is news
    // to them as much as to the student.
    await notify(tx, {
      to: staff,
      type: NOTIFICATION_TYPES.SESSION_LOGGED,
      actorId: mentor.id,
      href: notificationHref.adminStudent(profile.id),
      message:
        (rescheduled
          ? `${mentorLabel} rescheduled a ${formatMinutes(minutesParsed.value)} meeting with ${studentName} on ${formatDate(dateParsed.value)}${forTask} — no time charged.`
          : !withinPlan
            ? `${mentorLabel} logged ${formatMinutes(minutesParsed.value)} with ${studentName} on ${formatDate(dateParsed.value)}${toward} as EXTRA — outside the plan, so no allocation was charged.`
            : state === ATTENDANCE.ABSENT
              ? `${mentorLabel} recorded a ${formatMinutes(minutesParsed.value)} no-show for ${studentName} on ${formatDate(dateParsed.value)}${forTask}.`
              : `${mentorLabel} logged ${formatMinutes(minutesParsed.value)} with ${studentName} on ${formatDate(dateParsed.value)}${toward}${state === ATTENDANCE.LATE ? " (came late)" : ""}.`) +
        // The hand-off is news an admin would otherwise reconstruct from the
        // allocation history: the pool chose its mentor.
        (carved > 0
          ? ` The time came out of the unassigned pool (${formatDuration(poolAfter)} remaining in it).`
          : ""),
    });

    if (synced?.becameDone) {
      await notify(tx, {
        to: staff,
        type: NOTIFICATION_TYPES.GOAL_DONE,
        actorId: mentor.id,
        href: notificationHref.adminStudent(profile.id),
        message: `"${synced.purpose}" for ${studentName} is complete: ${formatMinutes(synced.loggedMinutes)} of ${formatMinutes(synced.minuteLimit ?? 0)} planned hours logged.`,
      });
    }
    return { sessionId: session.id, sync: synced, carved, poolAfter, meeting };
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
  // Tell the mentor what their own log just did to the task, so an automatic
  // status change is never a surprise they discover later.
  if (sync?.becameDone) {
    notes.push(
      `"${sync.purpose}" hit its ${formatMinutes(sync.minuteLimit ?? 0)} limit and is now marked done.`
    );
  } else if (sync?.changed) {
    notes.push(`"${sync.purpose}" is now in progress.`);
  }
  // The diary entry this closed, so an automatic tidy-up is never something the
  // mentor discovers later by finding it gone.
  if (meeting) {
    notes.push(
      `Your scheduled meeting on ${formatMeetingWhen(meeting.scheduledAt, meeting.hasTime)} is marked as held.`
    );
  }

  // Out-of-plan first: none of the balance arithmetic below applies to hours
  // that were never going to move a balance.
  let headline: string;
  if (!withinPlan) {
    headline = `Logged ${formatMinutes(minutesParsed.value)} with ${studentName}${inProgram} as extra time.`;
    notes.push(`On top of the plan, so their balance is unchanged.`);
  } else if (rescheduled) {
    headline = `Rescheduled meeting with ${studentName}${inProgram} recorded — no time charged.`;
    if (pool) {
      notes.push("Their unassigned pool is untouched.");
    } else if (allocation) {
      const left = await remainingWith(
        profile.id,
        programId,
        mentor.id,
        allocation.minutes
      );
      notes.push(`${formatDuration(left)} remaining with you.`);
    }
    // Nothing allocated means no balance to reassure anyone about — "0h
    // remaining with you" would read as a loss.
  } else if (pool) {
    // What the carve just did, in the mentor's terms: these hours are theirs
    // now, and here is what the pool still holds for whoever meets them next.
    const short = Number((minutesParsed.value - carved).toFixed(2));
    headline = `Logged ${formatMinutes(minutesParsed.value)} with ${studentName}${inProgram}.`;
    notes.push(
      short > 0
        ? `${formatDuration(carved)} unassigned minutes moved to you — the pool came up ${formatDuration(short)} short, so they are overdrawn with you.`
        : `${formatDuration(carved)} of their unassigned minutes moved to you; ${formatDuration(poolAfter)} remain in the pool.`
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
        ? `${formatDuration(remaining)} remaining with you.`
        : allocation
          ? `Heads up: they are now overdrawn by ${formatDuration(-remaining)} with you.`
          : // No allocation at all, so this overdraw isn't a balance run down —
            // it is time nobody has granted yet. Name the two ways out rather
            // than leaving a red number the mentor can't act on.
            `Heads up: no time is allocated to you for them, so they are overdrawn by ${formatDuration(-remaining)} with you. Ask an admin to allocate it, or correct this session to extra time.`
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
  const when = formatDate(session.date);
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
  const scope = await adminScope(actor);
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
    label: "Minutes",
  });
  if ("error" in minutesParsed) return { ok: false, error: minutesParsed.error };
  const dateParsed = parseDateField(formData.get("date"));
  if ("error" in dateParsed) return { ok: false, error: dateParsed.error };
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
  const change = `now ${formatMinutes(minutesParsed.value)} on ${formatDate(dateParsed.value)} (was ${formatMinutes(session.minutes)} on ${formatDate(session.date)})`;

  await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: session.id },
      data: {
        assignmentId,
        minutes: minutesParsed.value,
        date: dateParsed.value,
        note,
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

  revalidatePath("/", "layout");
  return { ok: true, message: "Session updated." };
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
      message: `${actorLabel} voided ${whose} ${formatMinutes(session.minutes)} session from ${formatDate(session.date)}. That time is back in the balance.`,
    });
    await notify(tx, {
      to: staff,
      type: NOTIFICATION_TYPES.SESSION_VOIDED,
      actorId: actor.id,
      href: notificationHref.adminStudent(session.studentId),
      message: `${actorLabel} voided ${whose} ${formatMinutes(session.minutes)} session with ${studentName} from ${formatDate(session.date)}; the hours went back.`,
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
export async function deleteSession(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  // Asked before the row is loaded, and deliberately: it is a fact about the
  // person, not about any session, so a mentor is pointed at the tool they do
  // have without a probe learning whether the id they guessed exists.
  if (!actor || scopeIsEmpty(await adminScope(actor))) {
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
  const what = `${formatMinutes(session.minutes)} session with ${mentorLabel} from ${formatDate(session.date)}`;
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
