import { deleteStudent, setStudentEmail, setStudentFolder, setStudentName, setStudentTelegram } from "@/lib/actions/students";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, fromRedirectingAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import type { StudentDetailsEdit } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };
type Field = StudentDetailsEdit extends infer E ? (E extends unknown ? keyof E : never) : never;

/** Each detail, the website's action that changes it and the form field it reads. */
const DETAILS: Record<Field, [typeof setStudentName, string]> = {
  name: [setStudentName, "name"],
  email: [setStudentEmail, "email"],
  telegram: [setStudentTelegram, "telegramUsername"],
  folder: [setStudentFolder, "folderUrl"],
};

/**
 * One of a student's details, as the page's Details change it: one action a
 * field, so one field a request. Who may change which is the action's to say:
 * the name an admin of one of their programs or a mentor who reaches them, the
 * rest an admin; each refuses anybody else in its own words.
 */
export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const body = await bodyOf(request);
  if (!body) return refused("Send the change as JSON.", 400);
  const named = Object.keys(body).filter((key): key is Field => Object.hasOwn(DETAILS, key));
  if (named.length !== 1) return refused("Change one detail at a time.", 400);
  const [field] = named;
  const value = body[field];
  if (typeof value !== "string") return refused("That isn't a valid value.", 400, { field });
  const [action, formField] = DETAILS[field];
  const form = new FormData();
  form.set("studentProfileId", (await params).id);
  form.set(formField, value);
  return fromAction(await action(null, form));
}

/**
 * Removes a student added by mistake: the website's `deleteStudent`, an
 * admin's, which refuses once a session that counts was logged for them, and
 * redirects when it is done (`fromRedirectingAction`).
 */
export async function DELETE(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const form = new FormData();
  form.set("studentProfileId", (await params).id);
  return fromRedirectingAction(() => deleteStudent(null, form));
}
