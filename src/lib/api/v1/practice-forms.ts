import { isText } from "@/lib/api/v1/session-forms";
import type { BookInterview, OfferSlot } from "@/lib/api/v1/types";
import { isDay } from "@/lib/api/v1/work-forms";
import { templateById } from "@/lib/interview-templates";
import { NOTES_MAX, parseMeetingUrl, parseSlotLength, parseSlotStart } from "@/lib/peer-interviews";

/**
 * Practice bodies as the FormData `lib/actions/interviews.ts` takes.
 *
 * The actions refuse a bad field without naming it. What is judged here is
 * judged by the same functions the actions call (`parseSlotStart`,
 * `parseSlotLength`, `parseMeetingUrl`), in their words, so the app can point
 * at the field; whatever needs the database (a clash, a booked time) is still
 * the action's to say.
 */

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `addInterviewSlot`'s FormData, or the first bad field with freshform's words for it. */
export function offerSlotForm(body: Record<string, unknown>, now: Date): FormData | { field: string; error: string } {
  const { day, time, minutes, meetingUrl } = body as Partial<Record<keyof OfferSlot, unknown>>;
  if (!isDay(day)) return { field: "day", error: "Pick a date." };
  if (!isText(time) || !TIME.test(time)) return { field: "time", error: "Pick a start time." };
  const start = parseSlotStart(day, time, now);
  // Passed, or too far ahead: both are about the day the time falls on.
  if ("error" in start) return { field: "day", error: start.error };
  if (typeof minutes !== "number" || !parseSlotLength(String(minutes))) {
    return { field: "minutes", error: "Pick how long the interview runs." };
  }
  if (meetingUrl !== undefined && meetingUrl !== null && !isText(meetingUrl)) {
    return { field: "meetingUrl", error: "Paste a meeting link that starts with https://." };
  }
  const link = parseMeetingUrl(meetingUrl ?? "");
  if ("error" in link) return { field: "meetingUrl", error: link.error };

  const form = new FormData();
  form.set("date", day);
  form.set("time", time);
  form.set("minutes", String(minutes));
  form.set("meetingUrl", link.value ?? "");
  return form;
}

/** `bookInterview`'s FormData, or the first bad field, in the action's words. */
export function bookForm(body: Record<string, unknown>): FormData | { field: string; error: string } {
  const { slot, template } = body as Partial<Record<keyof BookInterview, unknown>>;
  if (!isText(slot) || !slot) return { field: "slot", error: "Pick a time." };
  if (!isText(template) || !templateById(template)) {
    return { field: "template", error: "Pick what kind of interview to practise." };
  }
  const form = new FormData();
  form.set("slotId", slot);
  form.set("template", template);
  return form;
}

/** A body with nothing to read beyond the interview in the address. */
export const emptyForm = () => new FormData();

/** `saveInterviewNotes`'s FormData. Empty clears them. */
export function notesForm(body: Record<string, unknown> | null): FormData | { field: string; error: string } {
  const notes = body?.notes;
  if (!isText(notes) || notes.trim().length > NOTES_MAX) {
    return { field: "notes", error: `Notes can be up to ${NOTES_MAX} characters.` };
  }
  const form = new FormData();
  form.set("notes", notes);
  return form;
}
