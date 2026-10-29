import "server-only";

import { NOT_YOUR_PROGRAM } from "@/lib/api/v1/admin-gates";
import { refused } from "@/lib/api/v1/respond";
import type { Reader } from "@/lib/api/v1/sessions";
import { isText } from "@/lib/api/v1/session-forms";
import type { MentorBatchRegistration, MentorCard, MentorEdit, MentorEditRequest, MentorRegistration } from "@/lib/api/v1/types";
import { programOptionsFor } from "@/lib/api/v1/programs";
import { nameOf } from "@/lib/api/v1/sessions";
import { canAdministerMentor, scopeCovers } from "@/lib/authz";
import { canActAsMentor, ROLES, USER_STATUS } from "@/lib/constants";
import { allocationSummary, canBookOn } from "@/lib/hours";
import { assignmentsForStudentWhere, mentorAssignments } from "@/lib/queries";
import type { User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Registering a mentor from the freshlog app: the body as `createMentor`'s
 * FormData, with every target the body names gated before the action is asked.
 *
 * The action gates each target's program too, but answers a program outside
 * the reader's scope and a level that does not exist in different words, both
 * as a 400. So each target's program is found first: a target outside what the
 * reader reads is a 404, as a missing one is, and one they read and may not
 * change is a 403.
 */

type Target = MentorRegistration["targets"][number];

/** The program a target is in, or null when it names nothing there is. */
async function programOfTarget(target: Target): Promise<string | null> {
  if ("program" in target) return (await prisma.program.findUnique({ where: { id: target.program }, select: { id: true } }))?.id ?? null;
  if ("level" in target) return (await prisma.programLevel.findUnique({ where: { id: target.level }, select: { programId: true } }))?.programId ?? null;
  return (await prisma.cohort.findUnique({ where: { id: target.cohort }, select: { programId: true } }))?.programId ?? null;
}

/** One target as the body may give it: one of its three keys, naming an id. */
function isTarget(value: unknown): value is Target {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && ["program", "level", "cohort"].includes(keys[0]) && isText((value as Record<string, unknown>)[keys[0]]);
}

const bad = (field: string) => refused("That isn't a valid value.", 400, { field });

/**
 * Every target onto `form` as the website's picker writes it (`p:`, `l:`,
 * `c:`), or the answer to give instead: a target outside what the reader reads
 * is a 404, as a missing one is, and one they read and may not change a 403.
 */
async function appendTargets(reader: Reader, targets: unknown, form: FormData, allowNone = false): Promise<Response | null> {
  if (!Array.isArray(targets) || (!allowNone && targets.length === 0) || !targets.every(isTarget)) return bad("targets");
  for (const target of targets) {
    const programId = await programOfTarget(target);
    if (!programId || !scopeCovers(reader.read, programId)) return refused("Not found.", 404);
    if (!scopeCovers(reader.write, programId)) return refused(NOT_YOUR_PROGRAM, 403);
    form.append("targets", "program" in target ? `p:${target.program}` : "level" in target ? `l:${target.level}` : `c:${target.cohort}`);
  }
  return null;
}

/** `createMentor`'s FormData, or the answer to give instead: a bad field, or a target that is not the reader's. */
export async function registrationForm(reader: Reader, body: Record<string, unknown>): Promise<FormData | Response> {
  const { firstName, lastName, email, targets } = body as Partial<Record<keyof MentorRegistration, unknown>>;
  if (!isText(firstName) || !firstName.trim()) return bad("firstName");
  if (!isText(lastName) || !lastName.trim()) return bad("lastName");
  if (!isText(email) || !email.trim()) return bad("email");
  const form = new FormData();
  const refusal = await appendTargets(reader, targets, form);
  if (refusal) return refusal;
  form.set("email", email);
  form.set("firstName", firstName);
  form.set("lastName", lastName);
  return form;
}

/**
 * `createMentors`' FormData, the website's "several at once": each row's email
 * and names, into the same programs. A row the action can't take (a bad
 * address, one name, somebody already here) it skips and names, so the rows are
 * only checked for their type here.
 */
export async function batchRegistrationForm(reader: Reader, body: Record<string, unknown>): Promise<FormData | Response> {
  const { mentors, targets } = body as Partial<Record<keyof MentorBatchRegistration, unknown>>;
  const isRow = (row: unknown) =>
    typeof row === "object" && row !== null && ["email", "firstName", "lastName"].every((key) => isText((row as Record<string, unknown>)[key]));
  if (!Array.isArray(mentors) || mentors.length === 0 || mentors.length > 200 || !mentors.every(isRow)) return bad("mentors");
  const form = new FormData();
  const refusal = await appendTargets(reader, targets, form);
  if (refusal) return refusal;
  for (const row of mentors as MentorBatchRegistration["mentors"]) {
    form.append("email", row.email);
    form.append("firstName", row.firstName);
    form.append("lastName", row.lastName);
  }
  return form;
}

/** A pairing as a target of the website's picker: its cohort, else its level, else the program. */
const targetOfPairing = (a: { programId: string; levelId: string | null; cohortId: string | null }): MentorRegistration["targets"][number] =>
  a.cohortId ? { cohort: a.cohortId } : a.levelId ? { level: a.levelId } : { program: a.programId };

/**
 * What the website's Edit fold on a mentor's page offers an admin who may change
 * them (`canAdministerMentor`): their name and email, which only a platform
 * admin may change, where they work in the reader's programs, and those
 * programs to pick from. Null for anybody else, and for no such mentor alike.
 */
export async function mentorEditFor(reader: Reader, id: string): Promise<MentorEdit | null> {
  const mentor = await prisma.user.findUnique({ where: { id }, include: { mentorAssignments: true } });
  if (!mentor || !canActAsMentor(mentor) || reader.user.role === ROLES.STUDENT) return null;
  if (!(await canAdministerMentor(reader.user, mentor.id))) return null;
  return {
    name: mentor.name ?? "",
    email: mentor.email,
    canEditDetails: reader.user.platformAdmin,
    // The picker is built from the reader's programs: a pairing elsewhere draws no row, and the save leaves it be.
    targets: mentor.mentorAssignments.filter((a) => scopeCovers(reader.write, a.programId)).map(targetOfPairing),
    programs: await programOptionsFor(reader),
  };
}

/**
 * `updateMentor`'s FormData: the mentor, their name and email (as they are,
 * where the body leaves them out), and their pairings in the reader's programs
 * (as they are, where it leaves them out; none parks them unassigned there).
 * The action keeps a pairing outside the reader's programs, and lets only a
 * platform admin move the name or email.
 */
export async function mentorEditForm(reader: Reader, id: string, body: Record<string, unknown>): Promise<FormData | Response> {
  const edit = await mentorEditFor(reader, id);
  if (!edit) return refused("Not found.", 404);
  const { name, email, targets } = body as Partial<Record<keyof MentorEditRequest, unknown>>;
  if (name !== undefined && !isText(name)) return bad("name");
  if (email !== undefined && !isText(email)) return bad("email");
  const form = new FormData();
  form.set("mentorId", id);
  form.set("name", (name as string | undefined) ?? edit.name);
  form.set("email", (email as string | undefined) ?? edit.email);
  const refusal = await appendTargets(reader, targets === undefined ? edit.targets : targets, form, true);
  if (refusal) return refusal;
  return form;
}

/**
 * A mentor's card, as the website's `/mentors/[id]` gives somebody who doesn't
 * manage them (`MentorCard` on the page):
 *
 * - **a student**, whose account is active: the mentor's pairings that reach
 *   them (`assignmentsForStudentWhere`), each with Book only where the student
 *   still holds time with them there they can book on (`canBookOn`), else the
 *   mentor's email;
 * - **another mentor**: the mentor's pairings in the programs the reader works
 *   in, each with Book or the email.
 *
 * Null when none reaches them, and for no such mentor alike.
 */
export async function mentorCardFor(viewer: User, id: string): Promise<MentorCard | null> {
  const mentor = await prisma.user.findUnique({ where: { id } });
  if (!mentor || !canActAsMentor(mentor) || viewer.id === mentor.id) return null;
  let visible: Awaited<ReturnType<typeof mentorAssignments>>;
  let bookableIn: Set<string> | null = null;
  if (viewer.role === ROLES.STUDENT) {
    const profile = await prisma.studentProfile.findUnique({
      where: { userId: viewer.id },
      include: { enrollments: { select: { programId: true, levelId: true, cohortId: true } } },
    });
    if (!profile || viewer.status !== USER_STATUS.ACTIVE) return null;
    const [pairings, hours] = await Promise.all([
      prisma.mentorAssignment.findMany({
        where: { mentorId: mentor.id, ...assignmentsForStudentWhere(profile) },
        include: { program: true, cohort: true, level: true },
        orderBy: { createdAt: "asc" },
      }),
      allocationSummary(profile.id),
    ]);
    visible = pairings;
    bookableIn = new Set(hours.perMentor.flatMap((h) => (h.mentor?.id === mentor.id && canBookOn(h) ? [h.program.id] : [])));
  } else {
    if (!canActAsMentor(viewer)) return null;
    const mine = await prisma.mentorAssignment.findMany({ where: { mentorId: viewer.id }, select: { programId: true } });
    const shared = new Set(mine.map((a) => a.programId));
    visible = (await mentorAssignments(mentor.id)).filter((a) => shared.has(a.programId));
  }
  if (visible.length === 0) return null;
  return {
    mentor: { id: mentor.id, name: nameOf(mentor), email: mentor.email },
    pairings: visible.map((a) => ({
      id: a.id,
      program: { id: a.program.id, name: a.program.name, colorIndex: a.program.colorIndex },
      label: [a.program.name, a.level?.name, a.cohort?.name].filter(Boolean).join(" / "),
      bookingUrl: a.calendlyUrl && (!bookableIn || bookableIn.has(a.programId)) ? a.calendlyUrl : null,
    })),
  };
}
