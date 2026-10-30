import type { ActionState } from "@/lib/actions/shared";
import { isText } from "@/lib/api/v1/session-forms";
import type { BookingLinkText, DigestSwitch, NameText, NoticeCategory, NoticeSwitches, PushSwitch, SideSwitch, TelegramText } from "@/lib/api/v1/types";
import { NOTIFICATION_CATEGORY, ROLES } from "@/lib/constants";

/**
 * Account bodies as the FormData `lib/actions/profile.ts`, `email-prefs.ts` and
 * `mentors.ts` take. Only the shape is judged here; the words (a full name, a
 * handle, an https link) are the actions' own, in their words.
 */

type Bad = { field?: string; error: string };

/** `updateOwnName`'s FormData. */
export function nameForm(body: Record<string, unknown> | null): FormData | Bad {
  const { name } = (body ?? {}) as Partial<Record<keyof NameText, unknown>>;
  if (!isText(name)) return { field: "name", error: "Enter your full name." };
  const form = new FormData();
  form.set("name", name);
  return form;
}

/** `setOwnTelegram`'s FormData. */
export function telegramForm(body: Record<string, unknown> | null): FormData | Bad {
  const { telegram } = (body ?? {}) as Partial<Record<keyof TelegramText, unknown>>;
  if (!isText(telegram)) {
    return { field: "telegram", error: "Enter your Telegram username (5–32 letters, digits or underscores)." };
  }
  const form = new FormData();
  form.set("telegramUsername", telegram);
  return form;
}

/** A category from the address, or null when it isn't one. */
export function noticeCategory(raw: string): NoticeCategory | null {
  return (Object.values(NOTIFICATION_CATEGORY) as string[]).includes(raw) ? (raw as NoticeCategory) : null;
}

/** `setNotificationPreference`'s FormData: a checkbox is "on" or absent, as the page's form sends it. */
export function noticeForm(category: NoticeCategory, body: Record<string, unknown> | null): FormData | Bad {
  const { inApp, email } = (body ?? {}) as Partial<Record<keyof NoticeSwitches, unknown>>;
  if (typeof inApp !== "boolean") return { field: "inApp", error: "Say whether it shows in the app." };
  if (typeof email !== "boolean") return { field: "email", error: "Say whether it is emailed." };
  const form = new FormData();
  form.set("category", category);
  if (inApp) form.set("inApp", "on");
  if (email) form.set("email", "on");
  return form;
}

/** A category's Push switch, or the bad field. Push has no action of the website's: the route writes it. */
export function pushSwitch(body: Record<string, unknown> | null): { on: boolean } | Bad {
  const { on } = (body ?? {}) as Partial<Record<keyof PushSwitch, unknown>>;
  if (typeof on !== "boolean") return { field: "on", error: "Say whether it is pushed." };
  return { on };
}

/** `setWeeklyDigest`'s FormData. */
export function digestForm(body: Record<string, unknown> | null): FormData | Bad {
  const { on } = (body ?? {}) as Partial<Record<keyof DigestSwitch, unknown>>;
  if (typeof on !== "boolean") return { field: "on", error: "Say whether the weekly email is on." };
  const form = new FormData();
  if (on) form.set("weeklyDigest", "on");
  return form;
}

/**
 * `setProfile`'s FormData: the app's side as the website's lens. "mentor" is
 * the mentor lens; the other side is "admin", which for a student who mentors
 * is their student side, so a student sends "student" and staff send "admin".
 */
export function sideForm(user: { role: string }, body: Record<string, unknown> | null): FormData | Bad {
  const { side } = (body ?? {}) as Partial<Record<keyof SideSwitch, unknown>>;
  const other = user.role === ROLES.STUDENT ? "student" : "admin";
  if (side !== "mentor" && side !== other) return { field: "side", error: "Pick one of your two sides." };
  const form = new FormData();
  form.set("profile", side === "mentor" ? "mentor" : "admin");
  return form;
}

/** `setBookingLink`'s FormData, for one of the reader's own pairings. */
export function bookingLinkForm(assignment: string, body: Record<string, unknown> | null): FormData | Bad {
  const { url } = (body ?? {}) as Partial<Record<keyof BookingLinkText, unknown>>;
  if (!isText(url)) return { field: "url", error: "Enter a valid booking URL." };
  const form = new FormData();
  form.set("assignmentId", assignment);
  form.set("calendlyUrl", url);
  return form;
}

/**
 * A request's multipart body, or null when it isn't one. The bytes are the
 * action's to judge: it sniffs the format and checks the size itself.
 */
export async function multipartOf(request: Request): Promise<FormData | null> {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return null;
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

/**
 * An action's refusal pointed at the one field its form has. The account
 * actions each read a single input and say what is wrong with it without naming
 * it; the app shows the words under that input.
 */
export function onField(state: ActionState, field: string): ActionState {
  return state && !state.ok ? { ...state, field: state.field ?? field } : state;
}
