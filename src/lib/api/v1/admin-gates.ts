import { refused } from "@/lib/api/v1/respond";
import type { Reader } from "@/lib/api/v1/sessions";
import { isText } from "@/lib/api/v1/session-forms";
import { scopeCovers } from "@/lib/authz";

/** `assertProgramScope`'s own words, for a program the reader reads and may not change. */
export const NOT_YOUR_PROGRAM = "You don't administer that program.";

/**
 * The answer for a write a body aims at one program, before the action is
 * asked: a 404 outside the read scope, exactly as for a program that does not
 * exist, and a 403 inside it for a reader who may not change it. Null when the
 * reader may write it.
 *
 * The actions refuse both with a 400 (`fromAction`), and several word "missing"
 * and "not yours" differently, so the route has to answer first.
 */
export function programRefusal(reader: Reader, programId: unknown, field = "program"): Response | null {
  if (!isText(programId) || !programId) return refused("That isn't a valid value.", 400, { field });
  if (!scopeCovers(reader.read, programId)) return refused("Not found.", 404);
  if (!scopeCovers(reader.write, programId)) return refused(NOT_YOUR_PROGRAM, 403);
  return null;
}
