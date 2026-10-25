import "server-only";

import type { User } from "@/generated/prisma/client";
import type { ActionState } from "@/lib/actions/shared";
import { NOT_A_STUDENT, personOf, practiceStudent, slotTime, wallTime, type PracticeStudent } from "@/lib/api/v1/practice";
import { fromAction, refused } from "@/lib/api/v1/respond";
import type { ApiInterview, FeedbackText } from "@/lib/api/v1/types";
import {
  FEEDBACK_DISCUSS,
  FEEDBACK_PROMPTS,
  INTERVIEW_INTRO,
  INTERVIEW_RUBRIC,
  INTERVIEW_TURNS,
  templateById,
  templateName,
} from "@/lib/interview-templates";
import {
  feedbackEditable,
  feedbackEditableUntil,
  guideOpen,
  hasStarted,
  interviewPhase,
  sideOf,
} from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import { programToday } from "@/lib/when";

/**
 * One practice interview, for one of the two students in it: what
 * `/student/interviews/[id]` and its `live` page read, and what they let the
 * student do, as `can` flags built from `peer-interviews.ts`'s own rules.
 *
 * Only the reader's side is selected: their answers, their notes, their
 * feedback, draft or sent, and the partner's feedback once it is sent. The
 * partner's answers, notes and draft are never fetched, so no mapping below
 * could send them.
 *
 * Null, a 404, when the interview does not exist or the reader is not in it.
 */
export async function interviewFor({ profile }: PracticeStudent, id: string, now: Date = new Date()): Promise<ApiInterview | null> {
  const row = await prisma.peerInterview.findUnique({
    where: { id },
    select: {
      id: true,
      hostId: true,
      guestId: true,
      template: true,
      completedAt: true,
      absentId: true,
      hostNotes: true,
      guestNotes: true,
      slot: { select: { startsAt: true, minutes: true, meetingUrl: true } },
      host: { select: { user: { select: { id: true, name: true } } } },
      guest: { select: { user: { select: { id: true, name: true } } } },
      answers: {
        where: { studentId: profile.id },
        select: { questionIndex: true, question: true, text: true },
        orderBy: { questionIndex: "asc" },
      },
      feedback: {
        where: { OR: [{ fromId: profile.id }, { submittedAt: { not: null } }] },
        select: { fromId: true, summary: true, wentWell: true, toImprove: true, submittedAt: true },
      },
    },
  });
  const side = row ? sideOf(row, profile.id) : null;
  if (!row || !side) return null;

  const hosting = side === "host";
  const template = templateById(row.template);
  const phase = interviewPhase(row, now);
  const mine = row.feedback.find((f) => f.fromId === profile.id) ?? null;
  const theirs = row.feedback.find((f) => f.fromId !== profile.id && f.submittedAt !== null) ?? null;
  const sentAt = mine?.submittedAt ?? null;
  const open = !row.completedAt && !row.absentId;
  const editable = feedbackEditable(row.slot, sentAt, now, row.absentId);
  const text = (f: { summary: string | null; wentWell: string | null; toImprove: string | null }): FeedbackText => ({
    summary: f.summary ?? "",
    wentWell: f.wentWell ?? "",
    toImprove: f.toImprove ?? "",
  });

  return {
    id: row.id,
    when: slotTime(row.slot),
    partner: personOf(hosting ? row.guest.user : row.host.user),
    hosting,
    phase,
    sent: sentAt !== null,
    meetingUrl: row.slot.meetingUrl,
    template: {
      id: row.template,
      name: templateName(row.template),
      summary: template?.summary ?? "",
      questions: [...(template?.questions ?? [])],
    },
    answers: row.answers.map((a) => ({ index: a.questionIndex, question: a.question, text: a.text })),
    notes: (hosting ? row.hostNotes : row.guestNotes) ?? "",
    mine: mine && { ...text(mine), sent: sentAt !== null },
    theirs: theirs && text(theirs),
    absent: row.absentId ? (row.absentId === profile.id ? "me" : "partner") : null,
    // The day it was marked, on the program's calendar.
    completedOn: row.completedAt ? programToday(row.completedAt) : null,
    editableUntil: editable ? wallTime(feedbackEditableUntil(row.slot)) : null,
    can: {
      // The website offers Cancel until the interview is closed, after the start too.
      cancel: open,
      done: open && hasStarted(row.slot.startsAt, now),
      absent: open && hasStarted(row.slot.startsAt, now),
      guide: guideOpen(row.slot, sentAt, now, row.absentId),
      notes: row.completedAt !== null,
      editFeedback: editable,
    },
    guide: {
      intro: INTERVIEW_INTRO,
      rubric: INTERVIEW_RUBRIC.map((r) => ({ name: r.name, questions: [...r.questions] })),
      turns: INTERVIEW_TURNS,
      prompts: { ...FEEDBACK_PROMPTS },
      discuss: FEEDBACK_DISCUSS,
    },
  };
}

/** Whether `studentId` is one of the two students in interview `id`. */
async function inInterview(studentId: string, id: string): Promise<boolean> {
  const row = await prisma.peerInterview.findUnique({ where: { id }, select: { hostId: true, guestId: true } });
  return row !== null && sideOf(row, studentId) !== null;
}

/**
 * Everything one interview's write asks after the gate: an approved student,
 * in this interview (else the same 404 as a missing one), then the action with
 * `interviewId` and the route's own fields. `form` answers a bad field first.
 * `respond` is `fromAction` unless the action redirects when it works.
 */
export async function interviewWrite(
  user: User,
  id: string,
  form: FormData | { field: string; error: string },
  run: (form: FormData) => Promise<ActionState>,
  respond: (run: () => Promise<ActionState>) => Promise<Response> = async (go) => fromAction(await go())
): Promise<Response> {
  const me = await practiceStudent(user);
  if (!me) return refused(NOT_A_STUDENT, 403);
  if (!(await inInterview(me.profile.id, id))) return refused("Not found.", 404);
  if (!(form instanceof FormData)) return refused(form.error, 400, { field: form.field });
  form.set("interviewId", id);
  return respond(() => run(form));
}
