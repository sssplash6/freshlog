"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";
import { actsAs, capacityFrom, mayBook } from "@/lib/interview-partners";
import { templateById } from "@/lib/interview-templates";
import { notify } from "@/lib/notify";
import {
  FEEDBACK_EDIT_MINUTES,
  NOTES_MAX,
  answers,
  feedbackEditable,
  formatSlotWhen,
  givesFeedback,
  guideClosedAt,
  guideOpen,
  hasStarted,
  interviewsBase,
  overlaps,
  parseMeetingUrl,
  parseSlotLength,
  parseSlotStart,
  partOf,
  questionAt,
  sideOf,
} from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import type { ActionState } from "@/lib/actions/shared";

/**
 * Practising interviews: offering a time, booking somebody's, calling it off,
 * saying it happened, and keeping notes. Two students, or a mentor and a
 * student they have worked with (lib/interview-partners.ts).
 *
 * Every action asks the same two questions first — may this person practise
 * at all, and is the row theirs — and answers "not yours" and "does not exist"
 * with the same sentence, so an id cannot be used to learn what exists.
 */

/** Both sides' pages: either may be showing the interview that just changed. */
function revalidateInterviews(path = "") {
  revalidatePath(`/student/interviews${path}`, path ? undefined : "layout");
  revalidatePath(`/mentor/interviews${path}`, path ? undefined : "layout");
}

/** A signed-in user who may practise in some capacity, or null. */
async function participant() {
  const user = await getCurrentUser();
  if (!user || !(actsAs(user, "student") || actsAs(user, "mentor"))) return null;
  return { user };
}

const NOT_A_STUDENT: ActionState = {
  ok: false,
  error: "Only approved students and their mentors can practise interviews.",
};

/**
 * Everything already on this person's calendar that a new time must not
 * collide with: every time they have offered, booked or not, and every
 * interview they booked with somebody else.
 */
async function busyTimes(userId: string) {
  const [offered, booked] = await Promise.all([
    prisma.interviewSlot.findMany({
      where: { userId },
      select: { startsAt: true, minutes: true },
    }),
    prisma.peerInterview.findMany({
      where: { guestId: userId, completedAt: null },
      select: { slot: { select: { startsAt: true, minutes: true } } },
    }),
  ]);
  return [...offered, ...booked.map((b) => b.slot)];
}

/**
 * Offer a time to book: `as` "mentor" offers it to the mentor's students,
 * anything else to classmates.
 */
export async function addInterviewSlot(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await participant();
  if (!me) return NOT_A_STUDENT;
  const as = capacityFrom(formData.get("as"));
  if (!actsAs(me.user, as)) return NOT_A_STUDENT;

  const start = parseSlotStart(formData.get("date"), formData.get("time"), new Date());
  if ("error" in start) return { ok: false, error: start.error };
  const minutes = parseSlotLength(formData.get("minutes"));
  if (!minutes) return { ok: false, error: "Pick how long the interview runs." };
  const link = parseMeetingUrl(formData.get("meetingUrl"));
  if ("error" in link) return { ok: false, error: link.error };

  const slot = { startsAt: start.value, minutes };
  if ((await busyTimes(me.user.id)).some((t) => overlaps(t, slot))) {
    return { ok: false, error: "You already have something at that time." };
  }

  await prisma.interviewSlot.create({
    data: { userId: me.user.id, asMentor: as === "mentor", ...slot, meetingUrl: link.value },
  });

  revalidateInterviews();
  return { ok: true, message: `Offered ${formatSlotWhen(slot.startsAt)}.` };
}

/** Withdraw a time nobody has booked. A booked one is cancelled instead. */
export async function removeInterviewSlot(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await participant();
  if (!me) return NOT_A_STUDENT;

  const slotId = String(formData.get("slotId") ?? "");
  const slot = await prisma.interviewSlot.findUnique({
    where: { id: slotId },
    select: { userId: true, interview: { select: { id: true } } },
  });
  if (!slot || slot.userId !== me.user.id) {
    return { ok: false, error: "That time isn't one of yours." };
  }
  if (slot.interview) {
    return { ok: false, error: "Somebody booked this time. Cancel the interview instead." };
  }

  // Scoped to "still unbooked" in the write itself: a classmate may have booked
  // it between the read above and here, and their booking wins.
  const { count } = await prisma.interviewSlot.deleteMany({
    where: { id: slotId, userId: me.user.id, interview: null },
  });
  if (count === 0) {
    return { ok: false, error: "Somebody just booked this time. Cancel the interview instead." };
  }

  revalidateInterviews();
  return { ok: true, message: "Time removed." };
}

/**
 * Book somebody's time, with the template the two of you will practise. `as`
 * "mentor" books one of the mentor's students; anything else books as a
 * student — a classmate's time, or one of their mentors'.
 *
 * The slot's unique key on `PeerInterview.slotId` is what makes a time
 * bookable once: two students pressing Book together both pass every check
 * below, and exactly one of them gets the row.
 */
export async function bookInterview(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await participant();
  if (!me) return NOT_A_STUDENT;
  const as = capacityFrom(formData.get("as"));
  if (!actsAs(me.user, as)) return NOT_A_STUDENT;

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
      asMentor: true,
      interview: { select: { id: true } },
      user: { select: { id: true, name: true, role: true, status: true, isMentor: true } },
    },
  });

  // One sentence for "no such time" and "a time you may not see".
  const unavailable: ActionState = {
    ok: false,
    error: "That time isn't available any more. Pick another.",
  };
  if (!slot || slot.interview) return unavailable;
  if (slot.user.id === me.user.id) {
    return { ok: false, error: "That's one of your own times." };
  }
  if (hasStarted(slot.startsAt, new Date())) return unavailable;
  if (!(await mayBook(me.user, as, slot))) return unavailable;

  if ((await busyTimes(me.user.id)).some((t) => overlaps(t, slot))) {
    return { ok: false, error: "You already have something at that time." };
  }

  // The mentor side, if there is one: whoever offered a mentor's time, or
  // the mentor booking a student's.
  const mentorId = slot.asMentor ? slot.user.id : as === "mentor" ? me.user.id : null;

  let interviewId: string;
  try {
    interviewId = await prisma.$transaction(async (tx) => {
      const created = await tx.peerInterview.create({
        data: {
          slotId: slot.id,
          hostId: slot.user.id,
          guestId: me.user.id,
          mentorId,
          template: template.id,
        },
        select: { id: true, mentorId: true },
      });
      await notify(tx, {
        to: [slot.user.id],
        type: NOTIFICATION_TYPES.PEER_INTERVIEW_BOOKED,
        message: `${me.user.name ?? "A classmate"} booked your ${formatSlotWhen(slot.startsAt)} time for a ${template.name} practice interview.`,
        href: `${interviewsBase(created, slot.user.id)}/${created.id}`,
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
  revalidateInterviews();
  redirect(`${interviewsBase({ mentorId }, me.user.id)}/${interviewId}`);
}

/** One of the two sides' interview, with what the actions below need. */
async function myInterview(userId: string, interviewId: string) {
  const interview = await prisma.peerInterview.findUnique({
    where: { id: interviewId },
    select: {
      id: true,
      hostId: true,
      guestId: true,
      mentorId: true,
      completedAt: true,
      absentId: true,
      template: true,
      slot: { select: { startsAt: true, minutes: true } },
      host: { select: { id: true, name: true } },
      guest: { select: { id: true, name: true } },
    },
  });
  if (!interview) return null;
  const side = sideOf(interview, userId);
  return side ? { interview, side, part: partOf(interview, userId) } : null;
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
  const me = await participant();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.user.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview, side } = found;
  if (interview.completedAt) {
    return { ok: false, error: "This interview is already marked done." };
  }
  if (interview.absentId) return ALREADY_ABSENT;

  const other = side === "host" ? interview.guest.id : interview.host.id;
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
      href: interviewsBase(interview, other),
      actorId: me.user.id,
    });
    return true;
  });
  if (!cancelled) {
    return { ok: false, error: "This interview is already closed." };
  }

  // The interview's own page is gone with the row.
  revalidateInterviews();
  redirect(interviewsBase(interview, me.user.id));
}

/** Say the interview happened. Either student may; once is enough. */
export async function markInterviewDone(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await participant();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.user.id, String(formData.get("interviewId") ?? ""));
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

  revalidateInterviews();
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
  const me = await participant();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.user.id, String(formData.get("interviewId") ?? ""));
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
      to: [absent.id],
      type: NOTIFICATION_TYPES.PEER_INTERVIEW_ABSENT,
      message: `${me.user.name ?? "Your classmate"} marked you absent from the practice interview on ${formatSlotWhen(interview.slot.startsAt)}.`,
      href: `${interviewsBase(interview, absent.id)}/${interview.id}`,
      actorId: me.user.id,
    });
    return true;
  });
  if (!marked) {
    return { ok: false, error: "This interview was just closed. Reload to see how." };
  }

  revalidateInterviews();
  return { ok: true, message: `Marked ${absent.name ?? "your partner"} absent.` };
}

/** Save this student's own notes. The other student never reads them. */
export async function saveInterviewNotes(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await participant();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.user.id, String(formData.get("interviewId") ?? ""));
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

  revalidateInterviews(`/${interview.id}`);
  return { ok: true, message: "Notes saved." };
}

/** This student's own feedback row on an interview, if they have started one. */
async function myFeedback(interviewId: string, userId: string) {
  return prisma.interviewFeedback.findUnique({
    where: { interviewId_fromId: { interviewId, fromId: userId } },
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
  const me = await participant();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.user.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview, part } = found;
  if (!answers(part)) return { ok: false, error: "The student answers. You ask the questions." };

  const mine = await myFeedback(interview.id, me.user.id);
  const closedAt = guideClosedAt(part, mine?.submittedAt ?? null, interview.completedAt);
  if (!guideOpen(interview.slot, closedAt, new Date(), interview.absentId)) return GUIDE_CLOSED;

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
      interviewId_userId_questionIndex: {
        interviewId: interview.id,
        userId: me.user.id,
        questionIndex,
      },
    },
    create: { interviewId: interview.id, userId: me.user.id, questionIndex, question, text },
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
  const me = await participant();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.user.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview } = found;
  if (!givesFeedback(found.part)) {
    return { ok: false, error: "Your mentor writes the feedback in this interview." };
  }

  const mine = await myFeedback(interview.id, me.user.id);
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
    where: { interviewId_fromId: { interviewId: interview.id, fromId: me.user.id } },
    create: { interviewId: interview.id, fromId: me.user.id },
    update: {},
  });
  const { count } = await prisma.interviewFeedback.updateMany({
    where: { interviewId: interview.id, fromId: me.user.id, submittedAt: null },
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
  const me = await participant();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.user.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview, side } = found;
  if (!givesFeedback(found.part)) {
    return { ok: false, error: "Your mentor writes the feedback in this interview." };
  }

  const mine = await myFeedback(interview.id, me.user.id);
  if (!guideOpen(interview.slot, mine?.submittedAt ?? null, new Date(), interview.absentId)) return GUIDE_CLOSED;

  const read = readFeedback(formData);
  if ("error" in read) return { ok: false, error: read.error };
  if (!read.value.summary || !read.value.wentWell || !read.value.toImprove) {
    return { ok: false, error: "Fill in all three boxes before you submit.", values: read.value };
  }

  const other = side === "host" ? interview.guest : interview.host;
  const now = new Date();
  const submitted = await prisma.$transaction(async (tx) => {
    await tx.interviewFeedback.upsert({
      where: { interviewId_fromId: { interviewId: interview.id, fromId: me.user.id } },
      create: { interviewId: interview.id, fromId: me.user.id },
      update: {},
    });
    // The lock is this filter: a second submit racing the first finds
    // submittedAt already set and changes nothing.
    const { count } = await tx.interviewFeedback.updateMany({
      where: { interviewId: interview.id, fromId: me.user.id, submittedAt: null },
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
      href: `${interviewsBase(interview, other.id)}/${interview.id}`,
      actorId: me.user.id,
    });
    return true;
  });
  if (!submitted) return GUIDE_CLOSED;

  revalidateInterviews();
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
  const me = await participant();
  if (!me) return NOT_A_STUDENT;
  const found = await myInterview(me.user.id, String(formData.get("interviewId") ?? ""));
  if (!found) return NOT_YOURS;
  const { interview } = found;
  if (!givesFeedback(found.part)) {
    return { ok: false, error: "Your mentor writes the feedback in this interview." };
  }

  const closed: ActionState = {
    ok: false,
    error: `Feedback can be changed until ${FEEDBACK_EDIT_MINUTES} minutes after the interview ends.`,
  };
  const mine = await myFeedback(interview.id, me.user.id);
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
    where: { interviewId: interview.id, fromId: me.user.id, submittedAt: { not: null } },
    data: read.value,
  });
  if (count === 0) return closed;

  revalidateInterviews(`/${interview.id}`);
  return { ok: true, message: "Feedback updated." };
}
