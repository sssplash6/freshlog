"use server";

import { revalidatePath } from "next/cache";

import { assertExchangeParty, assertExchangeSender } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { notify, notificationHref, staffIdsFor } from "@/lib/notify";
import { EXCHANGE_STATUS, NOTIFICATION_TYPES, PROGRAM_STATUS } from "@/lib/constants";
import { exchangeHasSessions } from "@/lib/exchanges";
import { formatDate, formatDuration } from "@/lib/format";
import {
  parseDateField,
  parseMinutesField,
  type ActionState,
} from "@/lib/actions/shared";

/**
 * Lending a student to another program, and taking it back.
 *
 * The arrangement this replaces happened over Telegram: a mentor in one program
 * asked a colleague in another to see one of their students for an afternoon,
 * and nothing in the app knew about it. The hours were logged in whichever
 * program somebody guessed, or not logged at all, and the student's own program
 * had no way to find out whether the help ever arrived.
 *
 * Two writes, and the shape of the feature is in which is which. SENDING is the
 * sending program's decision and takes effect immediately — the student is in
 * the host program from that moment, capped at the hours promised — because a
 * mentor who has to wait for two admins to agree goes back to Telegram.
 * RETURNING is either end's, and is refused the moment an hour has been
 * delivered: a placement can be called off, but history cannot.
 *
 * What neither of them does is move any hours. The cap is new time the sending
 * program promises; the host allocates it among its own mentors under the
 * ordinary rules, in `setMentorAllocation`, which is also where the cap is
 * enforced. There is deliberately no second ledger here to disagree with that
 * one.
 */

/** The form's own fields, echoed back so a failed send refills itself. */
const SEND_FIELDS = [
  "studentProfileId",
  "fromProgramId",
  "toProgramId",
  "minutes",
  "deadline",
  "note",
] as const;

function submitted(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of SEND_FIELDS) {
    const value = formData.get(name);
    if (value != null) values[name] = String(value);
  }
  return values;
}

/**
 * Send a student to another program for a capped number of hours.
 *
 * The student joins the host program as a visitor — a `StudentEnrollment` whose
 * `exchangeId` says so — which is what makes every gate in the app work without
 * being taught about exchanges: the host's admins can allocate, its mentors can
 * log, and the student sees their hours. What the flag stops is the host
 * treating them as one of their own, and what the cap stops is the host
 * allocating more than was promised.
 *
 * Sending again to the same program RAISES the cap rather than opening a second
 * placement. Two open exchanges between the same two programs for the same
 * student would be two caps over one ledger, and nothing could say which of them
 * a given hour spent.
 */
export async function sendOnExchange(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const values = submitted(formData);
  const bad = (error: string, field?: string): ActionState => ({
    ok: false,
    error,
    ...(field ? { field } : {}),
    values,
  });

  const actor = await getCurrentUser();
  if (!actor) return bad("Sign in to do that.");

  const profileId = String(formData.get("studentProfileId") ?? "");
  const profile = await prisma.studentProfile.findUnique({
    where: { id: profileId },
    include: {
      user: true,
      enrollments: { include: { program: true } },
    },
  });
  if (!profile) return bad("Student not found.", "studentProfileId");

  // WHICH of the student's programs is doing the lending. Named by the form;
  // filled in silently when they study in only one, the same way a session's
  // program is.
  //
  // Their OWN programs only. A student who is already visiting somewhere is not
  // that program's to lend onward: the hours there are capped by the program
  // that sent them, and a second placement hanging off the first would spend a
  // promise its own sender never made. It is also what keeps the shortcut
  // honest — a student in one program plus one visit is still a student in one
  // program, and should not be asked which.
  const own = profile.enrollments.filter((e) => !e.exchangeId);
  const namedFrom = String(formData.get("fromProgramId") ?? "").trim();
  const from = namedFrom
    ? own.find((e) => e.programId === namedFrom)
    : own.length === 1
      ? own[0]
      : undefined;
  if (!from) {
    return bad(
      own.length > 1
        ? "Pick which of their programs is sending them."
        : "That student doesn't study in that program.",
      "fromProgramId"
    );
  }

  const denied = await assertExchangeSender(actor, { enrollments: own }, from.programId);
  if (denied) return { ...denied, values };

  const toProgramId = String(formData.get("toProgramId") ?? "").trim();
  const to = await prisma.program.findUnique({ where: { id: toProgramId } });
  if (!to) return bad("Pick the program to send them to.", "toProgramId");
  if (to.id === from.programId) {
    return bad("They are already in that program.", "toProgramId");
  }
  if (to.status === PROGRAM_STATUS.ARCHIVED) {
    return bad(`${to.name} is archived, so it can't take students.`, "toProgramId");
  }
  // A student already enrolled there needs no exchange: that program's admins
  // can grant them hours directly, and a visitor's cap over a member's ledger
  // would be a limit on time the host had granted out of its own.
  const already = profile.enrollments.find((e) => e.programId === to.id);
  if (already && !already.exchangeId) {
    return bad(
      `They already study in ${to.name}, so its admins can allocate time for them directly.`,
      "toProgramId"
    );
  }

  const parsedMinutes = parseMinutesField(formData.get("minutes"), {
    min: 1,
    label: "Minutes",
  });
  if ("error" in parsedMinutes) return bad(parsedMinutes.error, "minutes");

  // A use-by date, for the same reason every allocation has one: hours with no
  // end are hours nobody ever settles. It caps the host's own deadlines too.
  const parsedDeadline = parseDateField(formData.get("deadline"));
  if ("error" in parsedDeadline) {
    return bad("Pick the date these hours must be used by.", "deadline");
  }
  const deadline = parsedDeadline.value;

  const note = String(formData.get("note") ?? "").trim() || null;
  if (note && note.length > 500) {
    return bad("Keep the note under 500 characters.", "note");
  }

  const open = await prisma.programExchange.findFirst({
    where: {
      studentId: profile.id,
      fromProgramId: from.programId,
      toProgramId: to.id,
      status: EXCHANGE_STATUS.OPEN,
    },
  });

  const studentName = profile.user.name ?? profile.user.email;
  const senderLabel = actor.name ?? actor.email;
  const staff = await staffIdsFor(to.id);
  const homeStaff = await staffIdsFor(from.programId);
  const cap = (open?.minutes ?? 0) + parsedMinutes.value;
  // Hours already promised must never be shortened by a later top-up aimed at
  // nearer work — the rule `setMentorAllocation` follows for its own pools.
  const useBy = open && open.deadline > deadline ? open.deadline : deadline;

  const exchange = await prisma.$transaction(async (tx) => {
    const row = open
      ? await tx.programExchange.update({
          where: { id: open.id },
          data: {
            minutes: cap,
            deadline: useBy,
            // The newest reason replaces the old one only when there is one:
            // a top-up with nothing to say leaves the original standing.
            ...(note ? { note } : {}),
          },
        })
      : await tx.programExchange.create({
          data: {
            studentId: profile.id,
            fromProgramId: from.programId,
            toProgramId: to.id,
            minutes: parsedMinutes.value,
            deadline,
            note,
            sentById: actor.id,
          },
        });

    if (!open) {
      // The membership that makes every existing gate work. No cohort: a
      // visitor belongs to the program, not to a class inside it, and the
      // cohorted program's own rosters read them as program-wide.
      await tx.studentEnrollment.create({
        data: {
          studentId: profile.id,
          programId: to.id,
          createdById: actor.id,
          exchangeId: row.id,
        },
      });
    }

    await notify(tx, {
      to: staff,
      type: NOTIFICATION_TYPES.EXCHANGE_SENT,
      actorId: actor.id,
      href: notificationHref.adminStudent(profile.id),
      message: open
        ? `${senderLabel} raised ${studentName}'s exchange from ${from.program.name} by ${formatDuration(parsedMinutes.value)} — ${formatDuration(cap)} in all, to use by ${formatDate(useBy)}. Allocate it to a mentor.`
        : `${senderLabel} sent ${studentName} from ${from.program.name} for ${formatDuration(parsedMinutes.value)}, to use by ${formatDate(deadline)}. Allocate the time to a mentor here.${note ? ` "${note}"` : ""}`,
    });

    // The sending program's own admins hear it too: their mentor committed
    // their program's name to a placement, and they are the ones a host admin
    // will ask about it.
    await notify(tx, {
      to: homeStaff,
      type: NOTIFICATION_TYPES.EXCHANGE_SENT,
      actorId: actor.id,
      href: notificationHref.adminStudent(profile.id),
      message: `${senderLabel} sent ${studentName} to ${to.name} for ${formatDuration(parsedMinutes.value)}, to use by ${formatDate(useBy)}. Their sessions there show on this student's page.`,
    });

    await notify(tx, {
      to: [profile.userId],
      type: NOTIFICATION_TYPES.EXCHANGE_SENT,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `${senderLabel} arranged up to ${formatDuration(parsedMinutes.value)} for you with ${to.name}, to use by ${formatDate(useBy)}. Their team will say who you'll be working with.${note ? ` "${note}"` : ""}`,
    });

    return row;
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: open
      ? `${studentName}'s exchange with ${to.name} is now ${formatDuration(cap)}, to use by ${formatDate(useBy)}. Their admins allocate it.`
      : `${studentName} was sent to ${to.name} for ${formatDuration(parsedMinutes.value)}, to use by ${formatDate(deadline)}. Their admins allocate it to a mentor.`,
    receipt: {
      id: exchange.id,
      headline: `${formatDuration(parsedMinutes.value)} sent to ${to.name}`,
      notes: [
        `${to.name}'s admins were asked to put the time on a mentor.`,
        `Every session they log shows on this student's page in ${from.program.name} too.`,
      ],
      subject: { kind: "student", id: profile.id, name: studentName },
    },
  };
}

/**
 * Call an exchange off — the host declining it, or the sender withdrawing it.
 *
 * Refused once a single session has been logged under it. What has been
 * delivered is history in both programs, and a placement that produced hours
 * cannot be made not to have happened; the honest end for a spent exchange is
 * simply that nothing more is allocated against it.
 *
 * Everything the placement created goes: the visitor's membership, the hours
 * the host had put on its mentors and the tasks those hours bought. None of it
 * can have been used — no sessions, checked here — and leaving a stranded
 * allocation in the host program would be time nobody could spend and nobody
 * could explain.
 */
export async function returnExchange(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const id = String(formData.get("exchangeId") ?? "");
  const exchange = await prisma.programExchange.findUnique({
    where: { id },
    include: {
      student: { include: { user: true } },
      fromProgram: true,
      toProgram: true,
      sentBy: true,
      enrollment: true,
    },
  });
  if (!exchange) return { ok: false, error: "Exchange not found." };

  const denied = await assertExchangeParty(actor, exchange);
  if (denied) return denied;

  if (exchange.status !== EXCHANGE_STATUS.OPEN) {
    return { ok: true, message: "That exchange was already returned." };
  }
  if (await exchangeHasSessions(exchange.id)) {
    return {
      ok: false,
      error: `Time has already been logged in ${exchange.toProgram.name} under this exchange, so it's history rather than an arrangement. Void those sessions first if it truly must go.`,
    };
  }

  const note = String(formData.get("note") ?? "").trim() || null;
  const studentName = exchange.student.user.name ?? exchange.student.user.email;
  const actorLabel = actor.name ?? actor.email;
  const [hostStaff, homeStaff] = await Promise.all([
    staffIdsFor(exchange.toProgramId),
    staffIdsFor(exchange.fromProgramId),
  ]);

  await prisma.$transaction(async (tx) => {
    const scoped = {
      studentId: exchange.studentId,
      programId: exchange.toProgramId,
    };
    // The grants go back; their trail stays. Each allocation being deleted gets
    // a terminal change row down to zero, so the host program's History keeps
    // saying what was granted and when it was called off rather than losing
    // every row that mentioned the visit.
    const outgoing = await tx.hourAllocation.findMany({
      where: { exchangeId: exchange.id },
      select: { mentorId: true, minutes: true },
    });
    const removals = outgoing
      .filter((a) => a.minutes > 0)
      .map((a) => ({
        studentId: exchange.studentId,
        programId: exchange.toProgramId,
        mentorId: a.mentorId,
        changedById: actor.id,
        oldMinutes: a.minutes,
        newMinutes: 0,
      }));
    if (removals.length > 0) {
      await tx.hourAllotmentChange.createMany({ data: removals });
    }
    // The tasks were budgeted out of hours that are going back.
    await tx.assignment.deleteMany({ where: scoped });
    await tx.hourAllocation.deleteMany({ where: { exchangeId: exchange.id } });
    if (exchange.enrollment) {
      await tx.studentEnrollment.delete({ where: { id: exchange.enrollment.id } });
    }
    await tx.programExchange.update({
      where: { id: exchange.id },
      data: {
        status: EXCHANGE_STATUS.RETURNED,
        returnedById: actor.id,
        returnedAt: new Date(),
        returnNote: note,
      },
    });

    await notify(tx, {
      to: [exchange.sentById, ...homeStaff, ...hostStaff],
      type: NOTIFICATION_TYPES.EXCHANGE_RETURNED,
      actorId: actor.id,
      href: notificationHref.adminStudent(exchange.studentId),
      message: `${actorLabel} called off ${studentName}'s exchange between ${exchange.fromProgram.name} and ${exchange.toProgram.name}. No time was logged against it.${note ? ` "${note}"` : ""}`,
    });

    await notify(tx, {
      to: [exchange.student.userId],
      type: NOTIFICATION_TYPES.EXCHANGE_RETURNED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `The time arranged for you with ${exchange.toProgram.name} is off. Your hours in ${exchange.fromProgram.name} are unchanged.${note ? ` "${note}"` : ""}`,
    });
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `${studentName}'s exchange with ${exchange.toProgram.name} was called off. ${exchange.sentBy.name ?? exchange.sentBy.email} was told.`,
  };
}
