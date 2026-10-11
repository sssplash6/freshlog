"use server";

import { revalidatePath } from "next/cache";

import { adminWriteScope, assertApplicationWrite, scopeCovers } from "@/lib/authz";
import {
  isEssayStage,
  isRound,
  parseIelts,
  parseOptionalText,
  parseSat,
  parseSupplementalWords,
  tidyUniversityName,
  universityKey,
  wordsLabel,
} from "@/lib/applications";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import type { ActionState } from "@/lib/actions/shared";

/**
 * University applications, written by the student's mentors in a program that
 * tracks them and by that program's admins — `applicationAccess` decides, and
 * every action here asks it before it reads anything it would echo back.
 *
 * No notifications and no ledger: a stage moving from Writing to Finalizing is
 * not news anybody is waiting on, and none of it moves hours.
 */

/** The student, with what the gate needs, or null for every kind of "no". */
function loadStudent(studentProfileId: string) {
  return prisma.studentProfile.findUnique({
    where: { id: studentProfileId },
    select: {
      id: true,
      enrollments: { select: { programId: true, exchangeId: true } },
    },
  });
}

function revalidateStudent(studentProfileId: string) {
  revalidatePath(`/students/${studentProfileId}`);
}

/** SAT, IELTS, school and GPA — saved together, each one clearable. */
export async function saveApplicationSnapshot(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  const studentProfileId = String(formData.get("studentProfileId") ?? "");
  const profile = await loadStudent(studentProfileId);
  const denied = await assertApplicationWrite(actor, profile);
  if (denied || !profile || !actor) return denied ?? { ok: false, error: "Sign in to do that." };

  const sat = parseSat(formData.get("sat"));
  if ("error" in sat) return { ok: false, error: sat.error, field: "sat" };
  const ielts = parseIelts(formData.get("ielts"));
  if ("error" in ielts) return { ok: false, error: ielts.error, field: "ielts" };
  const school = parseOptionalText(formData.get("school"), "School", 120);
  if ("error" in school) return { ok: false, error: school.error, field: "school" };
  const gpa = parseOptionalText(formData.get("gpa"), "GPA", 20);
  if ("error" in gpa) return { ok: false, error: gpa.error, field: "gpa" };

  const data = {
    sat: sat.value,
    ielts: ielts.value,
    school: school.value,
    gpa: gpa.value,
    updatedById: actor.id,
  };
  await prisma.studentApplication.upsert({
    where: { studentId: profile.id },
    create: { studentId: profile.id, ...data },
    update: data,
  });

  revalidateStudent(profile.id);
  return { ok: true, message: "Snapshot saved." };
}

/**
 * Move an essay to a stage: the motivational essay (`target` = "essay") or the
 * supplemental for one university on the student's list (`target` = that
 * row's id). Asked of the ROW's student, so a row id from another student's
 * list cannot be moved by somebody who may edit this one.
 */
export async function setEssayStage(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  const studentProfileId = String(formData.get("studentProfileId") ?? "");
  const target = String(formData.get("target") ?? "");
  const stage = String(formData.get("stage") ?? "");
  const profile = await loadStudent(studentProfileId);
  const denied = await assertApplicationWrite(actor, profile);
  if (denied || !profile || !actor) return denied ?? { ok: false, error: "Sign in to do that." };
  if (!isEssayStage(stage)) return { ok: false, error: "Pick one of the four stages." };

  if (target === "essay") {
    await prisma.studentApplication.upsert({
      where: { studentId: profile.id },
      create: { studentId: profile.id, essayStage: stage, updatedById: actor.id },
      update: { essayStage: stage, updatedById: actor.id },
    });
  } else {
    const { count } = await prisma.studentUniversity.updateMany({
      where: { id: target, studentId: profile.id },
      data: { essayStage: stage },
    });
    if (count === 0) return { ok: false, error: "That university isn't on their list any more." };
  }

  revalidateStudent(profile.id);
  return { ok: true };
}

/**
 * Put a university on the student's list.
 *
 * Either one already in the shared list (`universityId`), whose word count
 * comes with it, or a new one (`newName` + `words`) — which is how the count
 * is entered, once, for everybody after. A new name that matches one already
 * there, however it is capitalised, is that one: the count already saved
 * stands, and the reader is told so rather than having theirs silently
 * dropped.
 */
export async function addStudentUniversity(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  const studentProfileId = String(formData.get("studentProfileId") ?? "");
  const profile = await loadStudent(studentProfileId);
  const denied = await assertApplicationWrite(actor, profile);
  if (denied || !profile || !actor) return denied ?? { ok: false, error: "Sign in to do that." };

  const primary = String(formData.get("primary") ?? "") === "on";
  const rawRound = String(formData.get("round") ?? "");
  if (rawRound && !isRound(rawRound)) return { ok: false, error: "Pick ED, REA or EA, or none." };
  const round = primary && isRound(rawRound) ? rawRound : null;

  const universityId = String(formData.get("universityId") ?? "");
  let university: { id: string; name: string; supplementalWords: number };
  let note = "";
  if (universityId && universityId !== "new") {
    const found = await prisma.university.findUnique({ where: { id: universityId } });
    if (!found) return { ok: false, error: "Pick a university from the list." };
    university = found;
  } else {
    const name = tidyUniversityName(String(formData.get("newName") ?? ""));
    if (name.length < 2) return { ok: false, error: "Type the university's name.", field: "newName" };
    if (name.length > 120) return { ok: false, error: "That name is too long.", field: "newName" };
    const words = parseSupplementalWords(formData.get("words"));
    if ("error" in words) return { ok: false, error: words.error, field: "words" };

    const key = universityKey(name);
    const existing = await prisma.university.findUnique({ where: { nameKey: key } });
    if (existing) {
      university = existing;
      if (existing.supplementalWords !== words.value) {
        note = ` ${existing.name} was already saved with ${wordsLabel(existing.supplementalWords).toLowerCase()}, so that count stands.`;
      }
    } else {
      // A second mentor adding the same new name at the same moment loses the
      // unique key to the first, and takes the row the first one made.
      university = await prisma.university
        .create({
          data: { name, nameKey: key, supplementalWords: words.value, createdById: actor.id },
        })
        .catch(async (error) => {
          const raced = await prisma.university.findUnique({ where: { nameKey: key } });
          if (!raced) throw error;
          return raced;
        });
    }
  }

  const already = await prisma.studentUniversity.findUnique({
    where: { studentId_universityId: { studentId: profile.id, universityId: university.id } },
  });
  if (already) return { ok: false, error: `${university.name} is already on their list.` };

  await prisma.$transaction(async (tx) => {
    if (primary) {
      await tx.studentUniversity.updateMany({
        where: { studentId: profile.id, isPrimary: true },
        data: { isPrimary: false, round: null },
      });
    }
    await tx.studentUniversity.create({
      data: { studentId: profile.id, universityId: university.id, isPrimary: primary, round },
    });
  });

  revalidateStudent(profile.id);
  return {
    ok: true,
    message: `${university.name} added${primary ? " as their primary choice" : ""}.${note}`,
  };
}

/**
 * Make a university on the list the primary choice, with its round, or set
 * the primary's round. The previous primary, if any, becomes one of the
 * others and loses its round — a round belongs to the primary only.
 */
export async function setPrimaryUniversity(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  const studentProfileId = String(formData.get("studentProfileId") ?? "");
  const id = String(formData.get("id") ?? "");
  const profile = await loadStudent(studentProfileId);
  const denied = await assertApplicationWrite(actor, profile);
  if (denied || !profile) return denied ?? { ok: false, error: "Sign in to do that." };

  const rawRound = String(formData.get("round") ?? "");
  if (rawRound && !isRound(rawRound)) return { ok: false, error: "Pick ED, REA or EA, or none." };
  const round = isRound(rawRound) ? rawRound : null;

  const row = await prisma.studentUniversity.findFirst({
    where: { id, studentId: profile.id },
    include: { university: true },
  });
  if (!row) return { ok: false, error: "That university isn't on their list any more." };

  await prisma.$transaction([
    prisma.studentUniversity.updateMany({
      where: { studentId: profile.id, isPrimary: true, id: { not: row.id } },
      data: { isPrimary: false, round: null },
    }),
    prisma.studentUniversity.update({
      where: { id: row.id },
      data: { isPrimary: true, round },
    }),
  ]);

  revalidateStudent(profile.id);
  return {
    ok: true,
    message: `${row.university.name} is their primary choice${round ? ` (${round})` : ""}.`,
  };
}

/** Take a university off the student's list, with its supplemental's stage. */
export async function removeStudentUniversity(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  const studentProfileId = String(formData.get("studentProfileId") ?? "");
  const id = String(formData.get("id") ?? "");
  const profile = await loadStudent(studentProfileId);
  const denied = await assertApplicationWrite(actor, profile);
  if (denied || !profile) return denied ?? { ok: false, error: "Sign in to do that." };

  const row = await prisma.studentUniversity.findFirst({
    where: { id, studentId: profile.id },
    include: { university: true },
  });
  if (!row) return { ok: false, error: "That university isn't on their list any more." };

  await prisma.studentUniversity.delete({ where: { id: row.id } });

  revalidateStudent(profile.id);
  return { ok: true, message: `${row.university.name} removed from their list.` };
}

/**
 * Correct a university's supplemental word count — for every student who
 * lists it, since the count is the university's.
 *
 * An admin of a program that tracks applications, and nobody else: a mentor
 * picks the saved count, and a count any mentor could change would be one
 * mentor's typo on every student's page.
 */
export async function correctUniversityWords(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const scope = await adminWriteScope(actor);
  const tracked = await prisma.program.findMany({
    where: { tracksAdmissions: true },
    select: { id: true },
  });
  if (!tracked.some((p) => scopeCovers(scope, p.id))) {
    return { ok: false, error: "Only an admin of a program that tracks applications can correct a word count." };
  }

  const universityId = String(formData.get("universityId") ?? "");
  const university = await prisma.university.findUnique({ where: { id: universityId } });
  if (!university) return { ok: false, error: "That university isn't in the list." };

  const words = parseSupplementalWords(formData.get("words"));
  if ("error" in words) return { ok: false, error: words.error, field: "words" };
  if (words.value === university.supplementalWords) return { ok: true, message: "No change." };

  await prisma.university.update({
    where: { id: university.id },
    data: { supplementalWords: words.value },
  });

  // Every student page that lists it shows the new count.
  revalidatePath("/students/[id]", "page");
  return {
    ok: true,
    message: `${university.name}: ${wordsLabel(words.value).toLowerCase()}, for every student who lists it.`,
  };
}
