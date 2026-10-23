import { ATTENDANCE, SESSION_ANSWER, TIME_KIND } from "@/lib/constants";
import type {
  ApiSession,
  Attendance,
  SessionAnswerRequest,
  SessionEdit,
  StudentAnswer,
  TimeKind,
} from "@/lib/api/v1/types";

/**
 * A JSON body as the FormData the session actions take.
 *
 * The app writes through the actions the website uses (`editSession`,
 * `answerSession`), so what they accept and refuse is the website's, in its
 * words. They read every field as `String(formData.get(name) ?? "")`: a field
 * that is missing is an answer, and `String(null)` is the word "null". So no form
 * here holds a null or an undefined, and none ever names a mentor: the session
 * in the address decides whose it is.
 */

/*
 * The checks a body's fields are held to, here and in `logForm` (log.ts): one
 * set, so every body the app sends a session action is judged alike.
 */

/** True for a text. */
export const isText = (value: unknown): value is string => typeof value === "string";

/** True for a finite number. JSON has no Infinity, but a number too large for a double parses to one. */
export const isMinutes = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * True for one of `choices`, exactly as the contract spells it.
 *
 * `T` is never taken from the choices (`NoInfer`): it is the contract's type for
 * the field (`Attendance`, `TimeKind`, `StudentAnswer`), named at the call.
 * Without one it is `never` and no choice compiles; with one, a choice the
 * contract doesn't have doesn't compile either, so a value added to
 * constants.ts and not to the contract is caught here.
 */
export const isOneOf =
  <T extends string = never>(choices: readonly NoInfer<T>[]) =>
  (value: unknown): value is T =>
    isText(value) && (choices as readonly string[]).includes(value);

const isAnswer = isOneOf<StudentAnswer>(Object.values(SESSION_ANSWER));

/**
 * What each field of an edit has to be, in the order the contract lists them.
 *
 * The type and, for the three that are a choice, the choice. The action reads
 * an attendance or a kind it doesn't know as Attended or Plan and saves that, so
 * a typo here would rewrite a session without a word. Everything else is the
 * action's to judge, in the website's words: how long a session may be, which
 * days it may be on, what a note may say.
 *
 * Typed over `SessionEdit`'s own keys, so a field added to the contract does not
 * compile until it has a line here.
 */
const EDIT_FIELDS: { [Field in keyof SessionEdit]-?: (value: unknown) => boolean } = {
  day: isText,
  minutes: isMinutes,
  attendance: isOneOf<Attendance>(Object.values(ATTENDANCE)),
  kind: isOneOf<TimeKind>(Object.values(TIME_KIND)),
  note: (value) => value === null || isText(value),
  assignmentId: isText,
};

/**
 * The edit a body asks for, or the first of its fields that isn't a valid value.
 *
 * Only the six fields of `SessionEdit` are taken, so a body cannot reach another
 * session, a mentor or a status by naming them.
 */
export function editOf(body: Record<string, unknown>): { edit: SessionEdit } | { field: string } {
  const edit: Record<string, unknown> = {};
  for (const [field, isValid] of Object.entries(EDIT_FIELDS)) {
    const value = body[field];
    if (value === undefined) continue;
    if (!isValid(value)) return { field };
    edit[field] = value;
  }
  // Each value passed its own field's check above.
  return { edit: edit as SessionEdit };
}

/**
 * `editSession`'s FormData. It replaces every field, so each one the edit leaves
 * out is sent as the session has it now.
 *
 * Every field but the note comes from `current`, which reads the same to
 * everyone who may edit. The note does not. It is the mentor's write-up, and a
 * student who also administers the program, or runs the platform, may edit their
 * own session while `current.note` is null for them. Filled from that, an edit
 * of the minutes would erase a note they were never shown. So a note the edit
 * leaves out is `storedNote`, the row's own, which the route reads on the server
 * and which goes to the action and nowhere else.
 *
 * - `note: null` and `""` both clear the note, and are sent as `""`, which the
 *   action stores as none. A session without a note is sent one the same way.
 * - The action cannot take a plan item off a session: an empty `assignmentId`
 *   means "leave it". So the item it has is sent again, and a session with none
 *   is sent no field at all.
 */
export function editForm(current: ApiSession, edit: SessionEdit, storedNote: string | null): FormData {
  const form = new FormData();
  form.set("sessionId", current.id);
  form.set("minutes", String(edit.minutes ?? current.minutes));
  form.set("date", edit.day ?? current.day);
  form.set("attendance", edit.attendance ?? current.attendance);
  form.set("timeKind", edit.kind ?? current.kind);
  form.set("note", (edit.note === undefined ? storedNote : edit.note) ?? "");
  // An empty one names nothing, and the action reads it as "leave it": the item the session has is sent again.
  const assignmentId = edit.assignmentId || current.task?.id;
  if (assignmentId) form.set("assignmentId", assignmentId);
  return form;
}

/**
 * The answer a body gives, or the first of its fields that isn't a valid value.
 *
 * Only `answer` and `note` are taken. The website lets a student rate a session
 * they confirm; the app does not, so a rating in the body goes nowhere.
 */
export function answerOf(body: Record<string, unknown>): { request: SessionAnswerRequest } | { field: string } {
  const { answer, note } = body;
  if (!isAnswer(answer)) return { field: "answer" };
  if (note === undefined) return { request: { answer } };
  if (!isText(note)) return { field: "note" };
  return { request: { answer, note } };
}

/**
 * `answerSession`'s FormData: the session, the answer, and the student's words
 * when they gave some. No rating. A dispute with no words is the action's to
 * refuse, so an empty note is sent as it is.
 */
export function answerForm(sessionId: string, body: SessionAnswerRequest): FormData {
  const form = new FormData();
  form.set("sessionId", sessionId);
  form.set("answer", body.answer);
  if (typeof body.note === "string") form.set("studentNote", body.note);
  return form;
}
