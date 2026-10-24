import {
  archiveProgram,
  renameProgram,
  setProgramClassHours,
  setProgramHourBank,
  setProgramSchedulesClasses,
  setProgramStandardHours,
  setProgramTracksAdmissions,
  setProgramTracksPayment,
} from "@/lib/actions/programs";
import type { ActionState } from "@/lib/actions/shared";
import { isText } from "@/lib/api/v1/session-forms";
import type { ProgramEdit } from "@/lib/api/v1/types";

/**
 * A program's settings, one at a time, as the actions the website's Settings
 * page calls. Each field is its own action there, saved as it is changed, so
 * each is its own request here: a body naming two would be two writes with one
 * answer, and the second's refusal would hide whether the first was made.
 *
 * Booleans go as the website's checkboxes go: "on", or left out.
 */

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** The most days a standard grant may run (`setProgramStandardHours`). */
const STANDARD_DAYS_MAX = 1095;

/** Every field of `ProgramEdit`, so a field added there does not compile until it is here. */
type Field = ProgramEdit extends infer E ? (E extends unknown ? keyof E : never) : never;
const FIELDS: Record<Field, true> = {
  name: true,
  tracksPayment: true,
  hourBank: true,
  classHours: true,
  tracksAdmissions: true,
  schedulesClasses: true,
  standard: true,
  archived: true,
};

/** A standard grant's pair as it may be sent: both, or null for none. */
export function isStandard(value: unknown): value is { minutes: number; days: number } | null {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const { minutes, days } = value as Record<string, unknown>;
  return Number.isInteger(minutes) && (minutes as number) >= 1 && Number.isInteger(days) && (days as number) >= 1 && (days as number) <= STANDARD_DAYS_MAX;
}

/** The pair as the actions read it: both empty is "none". */
export function setStandard(form: FormData, standard: { minutes: number; days: number } | null) {
  form.set("minutes", standard ? String(standard.minutes) : "");
  form.set("days", standard ? String(standard.days) : "");
}

/**
 * The one change a body asks for: which action, its FormData, and whether it
 * turns admissions or scheduled classes on, which only a platform admin may.
 * `{ field }` names a bad value, and `{ count }` says the body named no
 * setting or more than one.
 */
export function programEditOf(
  programId: string,
  body: Record<string, unknown>
): { action: Action; form: FormData; platformOnly: boolean } | { field: string } | { count: number } {
  const named = Object.keys(body).filter((key): key is Field => key in FIELDS);
  if (named.length !== 1) return { count: named.length };
  const [field] = named;
  const value = body[field];
  const form = new FormData();
  form.set("programId", programId);
  const toggle = (action: Action, platformOnly = false) => {
    if (typeof value !== "boolean") return { field };
    if (value) form.set(field, "on");
    return { action, form, platformOnly: platformOnly && value };
  };
  switch (field) {
    case "name":
      if (!isText(value)) return { field };
      form.set("name", value);
      return { action: renameProgram, form, platformOnly: false };
    case "tracksPayment":
      return toggle(setProgramTracksPayment);
    case "hourBank":
      return toggle(setProgramHourBank);
    case "classHours":
      return toggle(setProgramClassHours);
    case "tracksAdmissions":
      return toggle(setProgramTracksAdmissions, true);
    case "schedulesClasses":
      return toggle(setProgramSchedulesClasses, true);
    case "standard":
      if (!isStandard(value)) return { field };
      setStandard(form, value);
      return { action: setProgramStandardHours, form, platformOnly: false };
    case "archived":
      if (typeof value !== "boolean") return { field };
      // `archiveProgram` restores on "true" and archives on anything else.
      if (!value) form.set("restore", "true");
      return { action: archiveProgram, form, platformOnly: false };
  }
}
