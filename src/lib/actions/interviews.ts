"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
import { NOTIFICATION_TYPES, ROLES, USER_STATUS } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";
import { templateById } from "@/lib/interview-templates";
import { notify } from "@/lib/notify";
import {
  FEEDBACK_EDIT_MINUTES,
  NOTES_MAX,
  areClassmates,
  feedbackEditable,
  formatSlotWhen,
  guideOpen,
  hasStarted,
  overlaps,
  parseMeetingUrl,
  parseSlotLength,
  parseSlotStart,
  questionAt,
  sideOf,
} from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import type { ActionState } from "@/lib/actions/shared";

/**
 * Students practising interviews on each other: offering a time, booking a
 * classmate's, calling it off, saying it happened, and keeping notes.
 *
 * Every action asks the same two questions first — is this an approved student,
 * and is the row theirs — and answers "not yours" and "does not exist" with the
 * same sentence, so an id cannot be used to learn what exists.
 */

const INTERVIEWS = "/student/interviews";

/** An approved student and their own enrollments, or null. */
async function activeStudent() {
  const user = await getCurrentUser();
  if (!user || user.role !== ROLES.STUDENT) return null;
  if (user.status !== USER_STATUS.ACTIVE) return null;
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      enrollments: { select: { programId: true, exchangeId: true } },
    },
  });
  return profile ? { user, profile } : null;
}

const NOT_A_STUDENT: ActionState = {
  ok: false,
  error: "Only approved students can practise interviews.",
};

/**
 * Everything already on this student's calendar that a new time must not
 * collide with: every time they have offered, booked or not, and every
 * interview they booked with somebody else.
 */
async function busyTimes(studentId: string) {
  const [offered, booked] = await Promise.all([
    prisma.interviewSlot.findMany({
      where: { studentId },
      select: { startsAt: true, minutes: true },
    }),
    prisma.peerInterview.findMany({
      where: { guestId: studentId, completedAt: null },
      select: { slot: { select: { startsAt: true, minutes: true } } },
    }),
  ]);
  return [...offered, ...booked.map((b) => b.slot)];
}

/** Offer a time for a classmate to book. */
export async function addInterviewSlot(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;

  const start = parseSlotStart(formData.get("date"), formData.get("time"), new Date());
  if ("error" in start) return { ok: false, error: start.error };
  const minutes = parseSlotLength(formData.get("minutes"));
  if (!minutes) return { ok: false, error: "Pick how long the interview runs." };
  const link = parseMeetingUrl(formData.get("meetingUrl"));
  if ("error" in link) return { ok: false, error: link.error };

  const slot = { startsAt: start.value, minutes };
  if ((await busyTimes(me.profile.id)).some((t) => overlaps(t, slot))) {
    return { ok: false, error: "You already have something at that time." };
  }

  await prisma.interviewSlot.create({
    data: { studentId: me.profile.id, ...slot, meetingUrl: link.value },
  });

  revalidatePath(INTERVIEWS, "layout");
  return { ok: true, message: `Offered ${formatSlotWhen(slot.startsAt)}.` };
}

/** Withdraw a time nobody has booked. A booked one is cancelled instead. */
export async function removeInterviewSlot(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;

  const slotId = String(formData.get("slotId") ?? "");
  const slot = await prisma.interviewSlot.findUnique({
    where: { id: slotId },
    select: { studentId: true, interview: { select: { id: true } } },
  });
  if (!slot || slot.studentId !== me.profile.id) {
    return { ok: false, error: "That time isn't one of yours." };
  }
  if (slot.interview) {
    return { ok: false, error: "A classmate booked this time. Cancel the interview instead." };
  }

  // Scoped to "still unbooked" in the write itself: a classmate may have booked
  // it between the read above and here, and their booking wins.
  const { count } = await prisma.interviewSlot.deleteMany({
    where: { id: slotId, studentId: me.profile.id, interview: null },
  });
  if (count === 0) {
    return { ok: false, error: "A classmate just booked this time. Cancel the interview instead." };
  }

  revalidatePath(INTERVIEWS, "layout");
  return { ok: true, message: "Time removed." };
}

/**
 * Book a classmate's time, with the template the two of you will practise.
 *
 * The slot's unique key on `PeerInterview.slotId` is what makes a time
 * bookable once: two students pressing Book together both pass every check
 * below, and exactly one of them gets the row.
 */
export async function bookInterview(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;

  const template = templateById(String(formData.get("template") ?? ""));
  if (!template) return { ok: false, error: "Pick what kind of interview to practise." };

  const slotId = String(formData.get("slotId") ?? "");
  if (!slotId) return { ok: false, error: "Pick a time." };
  const slot = await prisma.interviewSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      startsAt: true,
      minutes: true,
      interview: { select: { id: true } },
      student: {
        select: {
          id: true,
          user: { select: { id: true, name: true, status: true } },
          enrollments: { select: { programId: true, exchangeId: true } },
        },
      },
    },
  });

  // One sentence for "no such time" and "a time you may not see".
  const unavailable: ActionState = {
    ok: false,
    error: "That time isn't available any more. Pick another.",
  };
  if (!slot || slot.interview) return unavailable;
  if (slot.student.id === me.profile.id) {
    return { ok: false, error: "That's one of your own times." };
  }
  if (slot.student.user.status !== USER_STATUS.ACTIVE) return unavailable;
  if (!areClassmates(me.profile.enrollments, slot.student.enrollments)) return unavailable;
  if (hasStarted(slot.startsAt, new Date())) return unavailable;

  if ((await busyTimes(me.profile.id)).some((t) => overlaps(t, slot))) {
    return { ok: false, error: "You already have something at that time." };
  }

  let interviewId: string;
  try {
    interviewId = await prisma.$transaction(async (tx) => {
      const created = await tx.peerInterview.create({
        data: {
          slotId: slot.id,
          hostId: slot.student.id,
          guestId: me.profile.id,
          template: template.id,
        },
        select: { id: true },
      });
      await notify(tx, {
        to: [slot.student.user.id],
        type: NOTIFICATION_TYPES.PEER_INTERVIEW_BOOKED,
        message: `${me.user.name ?? "A classmate"} booked your ${formatSlotWhen(slot.startsAt)} time for a ${template.name} practice interview.`,
        href: `${INTERVIEWS}/${created.id}`,
        actorId: me.user.id,
      });
      return created.id;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return unavailable;
    }
    throw error;
  }

  // Straight to the interview: its page is where the questions and the
  // controls for it live, and the classmate's page no longer offers the time.
  revalidatePath(INTERVIEWS, "layout");
  redirect(`${INTERVIEWS}/${interviewId}`);
}

/** One of the two students' interview, with what the actions below need. */
async function myInterview(studentId: string, interviewId: string) {
  const interview = await prisma.peerInterview.findUnique({
    where: { id: interviewId },
    select: {
      id: true,
      hostId: true,
      guestId: true,
      completedAt: true,
      absentId: true,
      template: true,
      slot: { select: { startsAt: true, minutes: true } },
      host: { select: { user: { select: { id: true, name: true } } } },
      guest: { select: { user: { select: { id: true, name: true } } } },
    },
  });
  if (!interview) return null;
  const side = sideOf(interview, studentId);
  return side ? { interview, side } : null;
}

const NOT_YOURS: ActionState = {
  ok: false,
  error: "That interview isn't one of yours.",
};

const ALREADY_ABSENT: ActionState = {
  ok: false,
  error: "Your partner was marked absent, so this interview is closed.",
};

/**
 * Call off an interview that has not been marked done. The time goes back to
 * being open, and the other student is told.
 */
export async function cancelInterview(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.profile.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview, side } = found;
  if (interview.completedAt) {
    return { ok: false, error: "This interview is already marked done." };
  }
  if (interview.absentId) return ALREADY_ABSENT;

  const other = side === "host" ? interview.guest.user.id : interview.host.user.id;
  // Scoped to "still not completed" in the delete itself: the partner may have
  // submitted their feedback (which completes the interview) between the read
  // above and here, and that submission must not be cascaded away.
  const cancelled = await prisma.$transaction(async (tx) => {
    const { count } = await tx.peerInterview.deleteMany({
      where: { id: interview.id, completedAt: null, absentId: null },
    });
    if (count === 0) return false;
    await notify(tx, {
      to: [other],
      type: NOTIFICATION_TYPES.PEER_INTERVIEW_CANCELLED,
      message: `${me.user.name ?? "Your classmate"} cancelled the practice interview on ${formatSlotWhen(interview.slot.startsAt)}.`,
      href: INTERVIEWS,
      actorId: me.user.id,
    });
    return true;
  });
  if (!cancelled) {
    return { ok: false, error: "This interview is already closed." };
  }

  // The interview's own page is gone with the row.
  revalidatePath(INTERVIEWS, "layout");
  redirect(INTERVIEWS);
}

/** Say the interview happened. Either student may; once is enough. */
export async function markInterviewDone(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.profile.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview } = found;
  if (!hasStarted(interview.slot.startsAt, new Date())) {
    return { ok: false, error: "You can mark it done once the interview has started." };
  }
  if (interview.absentId) return ALREADY_ABSENT;

  // `completedAt: null` in the filter: the other student may have got there
  // first, and the first moment is the one kept. `absentId: null` keeps the two
  // outcomes apart if a partner marked absence in the meantime.
  await prisma.peerInterview.updateMany({
    where: { id: interview.id, completedAt: null, absentId: null },
    data: { completedAt: new Date() },
  });

  revalidatePath(INTERVIEWS, "layout");
  return { ok: true, message: "Marked as completed." };
}

/**
 * Say the partner did not join. Once the interview has started and neither
 * student has called it done, either one may name the other absent — never
 * themself. It closes the interview for both without completing it, and the
 * absent student is told.
 */
export async function markPartnerAbsent(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.profile.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview, side } = found;
  if (!hasStarted(interview.slot.startsAt, new Date())) {
    return { ok: false, error: "You can mark your partner absent once the interview has started." };
  }
  if (interview.completedAt) {
    return { ok: false, error: "This interview is already marked done." };
  }
  if (interview.absentId) return ALREADY_ABSENT;

  const absent = side === "host" ? interview.guest : interview.host;
  const absentId = side === "host" ? interview.guestId : interview.hostId;

  // Scoped to "still open" in the write itself: the partner may have marked it
  // done, or marked you absent, between the read above and here, and whichever
  // landed first is the outcome.
  const marked = await prisma.$transaction(async (tx) => {
    const { count } = await tx.peerInterview.updateMany({
      where: { id: interview.id, completedAt: null, absentId: null },
      data: { absentId },
    });
    if (count === 0) return false;
    await notify(tx, {
      to: [absent.user.id],
      type: NOTIFICATION_TYPES.PEER_INTERVIEW_ABSENT,
      message: `${me.user.name ?? "Your classmate"} marked you absent from the practice interview on ${formatSlotWhen(interview.slot.startsAt)}.`,
      href: `${INTERVIEWS}/${interview.id}`,
      actorId: me.user.id,
    });
    return true;
  });
  if (!marked) {
    return { ok: false, error: "This interview was just closed. Reload to see how." };
  }

  revalidatePath(INTERVIEWS, "layout");
  return { ok: true, message: `Marked ${absent.user.name ?? "your partner"} absent.` };
}

/** Save this student's own notes. The other student never reads them. */
export async function saveInterviewNotes(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.profile.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview, side } = found;
  if (!interview.completedAt) {
    return { ok: false, error: "Mark the interview done first." };
  }

  const notes = String(formData.get("notes") ?? "").trim();
  if (notes.length > NOTES_MAX) {
    return {
      ok: false,
      error: `Notes can be up to ${NOTES_MAX} characters.`,
      values: { notes },
    };
  }

  await prisma.peerInterview.update({
    where: { id: interview.id },
    data: side === "host" ? { hostNotes: notes || null } : { guestNotes: notes || null },
  });

  revalidatePath(`${INTERVIEWS}/${interview.id}`);
  return { ok: true, message: "Notes saved." };
}

/** This student's own feedback row on an interview, if they have started one. */
async function myFeedback(interviewId: string, studentId: string) {
  return prisma.interviewFeedback.findUnique({
    where: { interviewId_fromId: { interviewId, fromId: studentId } },
    select: { submittedAt: true },
  });
}

const GUIDE_CLOSED: ActionState = {
  ok: false,
  error: "The guide opens at the start time and closes once you submit your feedback.",
};

/**
 * Save this student's own answer to one question. Called as the box loses
 * focus, so it is an upsert: the latest text wins, and the question's wording
 * is copied in the first time.
 */
export async function saveInterviewAnswer(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.profile.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview } = found;

  const mine = await myFeedback(interview.id, me.profile.id);
  if (!guideOpen(interview.slot, mine?.submittedAt ?? null, new Date(), interview.absentId)) return GUIDE_CLOSED;

  const rawIndex = String(formData.get("questionIndex") ?? "");
  const notAQuestion: ActionState = { ok: false, error: "That question isn't in this interview." };
  if (!/^\d+$/.test(rawIndex)) return notAQuestion;
  const questionIndex = Number(rawIndex);
  const question = questionAt(templateById(interview.template), questionIndex);
  if (question === null) return notAQuestion;

  const text = String(formData.get("text") ?? "").trim();
  if (text.length > NOTES_MAX) {
    return { ok: false, error: `An answer can be up to ${NOTES_MAX} characters.` };
  }

  await prisma.interviewAnswer.upsert({
    where: {
      interviewId_studentId_questionIndex: {
        interviewId: interview.id,
        studentId: me.profile.id,
        questionIndex,
      },
    },
    create: { interviewId: interview.id, studentId: me.profile.id, questionIndex, question, text },
    update: { text },
  });
  return { ok: true, message: "Saved." };
}

/** The three feedback boxes, trimmed, or the sentence refusing them. */
function readFeedback(
  formData: FormData
): { value: { summary: string; wentWell: string; toImprove: string } } | { error: string } {
  const value = {
    summary: String(formData.get("summary") ?? "").trim(),
    wentWell: String(formData.get("wentWell") ?? "").trim(),
    toImprove: String(formData.get("toImprove") ?? "").trim(),
  };
  if (Object.values(value).some((v) => v.length > NOTES_MAX)) {
    return { error: `Each box can be up to ${NOTES_MAX} characters.` };
  }
  return { value };
}

/** Save a feedback draft. Only its author reads it until it is submitted. */
export async function saveInterviewFeedback(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.profile.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview } = found;

  const mine = await myFeedback(interview.id, me.profile.id);
  if (!guideOpen(interview.slot, mine?.submittedAt ?? null, new Date(), interview.absentId)) return GUIDE_CLOSED;

  const read = readFeedback(formData);
  if ("error" in read) return { ok: false, error: read.error };
  const fields = {
    summary: read.value.summary || null,
    wentWell: read.value.wentWell || null,
    toImprove: read.value.toImprove || null,
  };

  // Create the row if missing, then write only while it is unsubmitted: a
  // submit in another tab between the check above and here stays as sent.
  await prisma.interviewFeedback.upsert({
    where: { interviewId_fromId: { interviewId: interview.id, fromId: me.profile.id } },
    create: { interviewId: interview.id, fromId: me.profile.id },
    update: {},
  });
  const { count } = await prisma.interviewFeedback.updateMany({
    where: { interviewId: interview.id, fromId: me.profile.id, submittedAt: null },
    data: fields,
  });
  if (count === 0) return GUIDE_CLOSED;
  return { ok: true, message: "Draft saved." };
}

/**
 * Hand the feedback to the partner. Final: the row is locked, the interview is
 * completed if the partner has not already, and the partner is told.
 */
export async function submitInterviewFeedback(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.profile.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview, side } = found;

  const mine = await myFeedback(interview.id, me.profile.id);
  if (!guideOpen(interview.slot, mine?.submittedAt ?? null, new Date(), interview.absentId)) return GUIDE_CLOSED;

  const read = readFeedback(formData);
  if ("error" in read) return { ok: false, error: read.error };
  if (!read.value.summary || !read.value.wentWell || !read.value.toImprove) {
    return { ok: false, error: "Fill in all three boxes before you submit.", values: read.value };
  }

  const other = side === "host" ? interview.guest.user : interview.host.user;
  const now = new Date();
  const submitted = await prisma.$transaction(async (tx) => {
    await tx.interviewFeedback.upsert({
      where: { interviewId_fromId: { interviewId: interview.id, fromId: me.profile.id } },
      create: { interviewId: interview.id, fromId: me.profile.id },
      update: {},
    });
    // The lock is this filter: a second submit racing the first finds
    // submittedAt already set and changes nothing.
    const { count } = await tx.interviewFeedback.updateMany({
      where: { interviewId: interview.id, fromId: me.profile.id, submittedAt: null },
      data: { ...read.value, submittedAt: now },
    });
    if (count === 0) return false;
    await tx.peerInterview.updateMany({
      where: { id: interview.id, completedAt: null },
      data: { completedAt: now },
    });
    await notify(tx, {
      to: [other.id],
      type: NOTIFICATION_TYPES.PEER_INTERVIEW_FEEDBACK,
      message: `${me.user.name ?? "Your classmate"} sent you feedback on your practice interview.`,
      href: `${INTERVIEWS}/${interview.id}`,
      actorId: me.user.id,
    });
    return true;
  });
  if (!submitted) return GUIDE_CLOSED;

  revalidatePath(INTERVIEWS, "layout");
  return { ok: true, message: "Feedback sent." };
}

/**
 * Change feedback already sent, while the edit window is open — until
 * FEEDBACK_EDIT_MINUTES after the interview's scheduled end. The partner reads
 * the new wording in place; they were told once when it was sent, and are not
 * told again for a correction.
 */
export async function editInterviewFeedback(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await activeStudent();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.profile.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview } = found;

  const closed: ActionState = {
    ok: false,
    error: `Feedback can be changed until ${FEEDBACK_EDIT_MINUTES} minutes after the interview ends.`,
  };
  const mine = await myFeedback(interview.id, me.profile.id);
  if (!feedbackEditable(interview.slot, mine?.submittedAt ?? null, new Date(), interview.absentId)) {
    return closed;
  }

  const read = readFeedback(formData);
  if ("error" in read) return { ok: false, error: read.error };
  if (!read.value.summary || !read.value.wentWell || !read.value.toImprove) {
    return { ok: false, error: "Fill in all three boxes before you save.", values: read.value };
  }

  // Only a sent row: a draft is changed through the guide, never here.
  const { count } = await prisma.interviewFeedback.updateMany({
    where: { interviewId: interview.id, fromId: me.profile.id, submittedAt: { not: null } },
    data: read.value,
  });
  if (count === 0) return closed;

  revalidatePath(`${INTERVIEWS}/${interview.id}`);
  return { ok: true, message: "Feedback updated." };
}
