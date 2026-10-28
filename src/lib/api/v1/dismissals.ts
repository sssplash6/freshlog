import "server-only";

import type { StatusKey } from "@/lib/api/v1/types";
import { canActAsMentor, ROLES } from "@/lib/constants";
import { STATUS_TYPES } from "@/lib/status";
import type { User } from "@/generated/prisma/client";

/**
 * Hiding a To do row, and showing it again: the body both routes read, and who
 * may send it.
 */

/**
 * The row a body names, or the field that is wrong.
 *
 * `dismissStatus` silently ignores a type it doesn't know, so the type is
 * checked here and the app is told. `subjectId` is `TodoRow.subject?.id ?? ""`,
 * so the empty string is a real answer, and a missing one is not.
 */
export function statusKeyFrom(body: unknown): StatusKey | { field: string } {
  const { type, subjectId } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof type !== "string" || !(STATUS_TYPES as readonly string[]).includes(type)) return { field: "type" };
  if (typeof subjectId !== "string") return { field: "subjectId" };
  return { type, subjectId };
}

/**
 * Whether this person's list can hide rows: the staff's and the mentor's can
 * (`Attention.dismissible`), a student's can't. `studentAttention` never reads
 * a dismissal, so one a student wrote would hide nothing.
 */
export async function mayDismiss(user: User): Promise<boolean> {
  return canActAsMentor(user) || user.role !== ROLES.STUDENT;
}
