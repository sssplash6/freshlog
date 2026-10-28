import "server-only";

import { isText } from "@/lib/api/v1/session-forms";
import type { AddStudents } from "@/lib/api/v1/types";
import { prisma } from "@/lib/prisma";
import type { Program } from "@/generated/prisma/client";

/**
 * Adding students from the freshlog app: the body as `createStudents`' FormData.
 *
 * The website's form sends every row as four repeated fields, which the action
 * reads by index (`getAll("email")[i]` with `getAll("firstName")[i]`), so the
 * rows are appended in order and a row with no folder link still sends an empty
 * one: a skipped field would pair the next row's link with this row's student.
 *
 * What the action would refuse without naming is judged here on its field: the
 * rows themselves, and the level and cohort the program needs. What it skips and
 * reports (an address already somebody's, a name of one word) stays its own, in
 * its message.
 */

/** The most rows one request may carry. */
export const MAX_ROWS = 200;

const ROW_FIELDS = ["email", "firstName", "lastName"] as const;

/** `createStudents`' FormData, or the first field that is not valid. */
export async function addStudentsForm(program: Program, body: Record<string, unknown>): Promise<FormData | { field: string } | { classHours: true }> {
  if (program.classHours) return { classHours: true };
  const { level: levelId, cohort: cohortId, rows } = body as Partial<Record<keyof AddStudents, unknown>>;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) return { field: "rows" };
  for (const [i, row] of rows.entries()) {
    if (typeof row !== "object" || row === null) return { field: `rows.${i}` };
    const fields = row as Record<string, unknown>;
    for (const field of ROW_FIELDS) {
      if (!isText(fields[field]) || !(fields[field] as string).trim()) return { field: `rows.${i}.${field}` };
    }
    if (fields.folderUrl !== undefined && !isText(fields.folderUrl)) return { field: `rows.${i}.folderUrl` };
  }

  // The enrollment as `resolveEnrollment` needs it: a level where the program
  // has levels, and a cohort where that level, or a program with no levels, has
  // cohorts.
  if (levelId !== undefined && !isText(levelId)) return { field: "level" };
  if (cohortId !== undefined && !isText(cohortId)) return { field: "cohort" };
  const [levels, cohorts] = await Promise.all([
    prisma.programLevel.findMany({ where: { programId: program.id }, select: { id: true } }),
    prisma.cohort.findMany({ where: { programId: program.id }, select: { id: true, levelId: true } }),
  ]);
  if (levels.length > 0 && !levels.some((l) => l.id === levelId)) return { field: "level" };
  if (levels.length === 0 && levelId !== undefined) return { field: "level" };
  const offered = cohorts.filter((c) => c.levelId === (levels.length > 0 ? levelId : null));
  if (offered.length > 0 && !offered.some((c) => c.id === cohortId)) return { field: "cohort" };
  if (offered.length === 0 && cohortId !== undefined) return { field: "cohort" };

  const form = new FormData();
  form.set("programId", program.id);
  if (isText(levelId)) form.set("levelId", levelId);
  if (isText(cohortId)) form.set("cohortId", cohortId);
  for (const row of rows as AddStudents["rows"]) {
    form.append("email", row.email);
    form.append("firstName", row.firstName);
    form.append("lastName", row.lastName);
    form.append("folderUrl", row.folderUrl ?? "");
  }
  return form;
}
