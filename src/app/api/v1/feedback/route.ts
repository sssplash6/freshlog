import { submitMentorFeedback } from "@/lib/actions/feedback";
import { bodyOf } from "@/lib/api/v1/body";
import { ratingsFor } from "@/lib/api/v1/ratings";
import { fromAction, inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { isText } from "@/lib/api/v1/session-forms";
import type { RateMentor } from "@/lib/api/v1/types";
import { ROLES } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** The words `submitMentorFeedback` uses for anybody who isn't a student. */
const NOT_A_STUDENT = "Only students can leave mentor feedback.";

const studentOf = async (userId: string) =>
  prisma.studentProfile.findUnique({ where: { userId }, select: { id: true } });

/** A student's ratings: who they may rate, and what they have sent. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const profile = user.role === ROLES.STUDENT ? await studentOf(user.id) : null;
  if (!profile) return refused(NOT_A_STUDENT, 403);
  return ok(await ratingsFor(profile.id));
}

/**
 * Rate a mentor: `submitMentorFeedback`, which keeps each one as a report of
 * its own and refuses a mentor the student doesn't work with, in its words.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { mentor, rating, comment } = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof RateMentor, unknown>>;
  if (!isText(mentor) || !mentor) return refused("Pick one of your mentors.", 400, { field: "mentor" });
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return refused("Pick a rating from 1 to 5.", 400, { field: "rating" });
  }
  if (comment !== undefined && comment !== null && !isText(comment)) return refused("Write the comment as text.", 400, { field: "comment" });
  const form = new FormData();
  form.set("mentorId", mentor);
  form.set("rating", String(rating));
  form.set("comment", comment ?? "");
  return fromAction(await submitMentorFeedback(null, form));
}
