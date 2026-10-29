import { scheduleClass } from "@/lib/actions/classes";
import { bodyOf } from "@/lib/api/v1/body";
import { classesFor } from "@/lib/api/v1/classes";
import { fromAction, inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import type { ClassBooking } from "@/lib/api/v1/types";
import { isDay } from "@/lib/api/v1/work-forms";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The class diary for a month (`?month=YYYY-MM`, this one when none or a bad
 * one is asked), as the website's Classes page reads it. A 404 to anybody the
 * page is one to: nobody can learn from outside that a department schedules
 * classes.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const classes = await classesFor(user, new URL(request.url).searchParams.get("month") ?? "");
  if (!classes) return refused("Not found.", 404);
  return ok(classes);
}

/**
 * Books a class (`scheduleClass`): a mentor, for one of their students, out of
 * the time the student holds with them; refused past the unreserved time or
 * over another class, in the action's words.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { student, program, day, time, minutes, topic } = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof ClassBooking, unknown>>;
  const field =
    typeof student !== "string" || !student
      ? "student"
      : typeof program !== "string" || !program
        ? "program"
        : !isDay(day)
          ? "day"
          : typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)
            ? "time"
            : !Number.isInteger(minutes)
              ? "minutes"
              : topic !== undefined && typeof topic !== "string"
                ? "topic"
                : null;
  if (field) return refused("That isn't a valid value.", 400, { field });
  const form = new FormData();
  form.set("studentId", student as string);
  form.set("programId", program as string);
  form.set("date", day as string);
  form.set("time", time as string);
  form.set("minutes", String(minutes));
  form.set("topic", typeof topic === "string" ? topic : "");
  return fromAction(await scheduleClass(null, form));
}
