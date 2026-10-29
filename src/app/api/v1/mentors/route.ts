import { createMentor, createMentors } from "@/lib/actions/mentors";
import { bodyOf } from "@/lib/api/v1/body";
import { mentorListFor } from "@/lib/api/v1/mentor-list";
import { batchRegistrationForm, registrationForm } from "@/lib/api/v1/mentors";
import { fromAction, inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { scopeIsEmpty } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The admin's Mentors list (`?page=&program=&status=unassigned&link=missing&q=`),
 * as /mentors reads it, in the reader's programs. Anybody with no admin grant
 * is a 404, as for the admin's home.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const reader = await readerFor(user);
  if (scopeIsEmpty(reader.read)) return refused("Not found.", 404);
  return ok(await mentorListFor(reader, Object.fromEntries(new URL(request.url).searchParams)));
}

/**
 * Registers a mentor where the body says they work, through the website's
 * `createMentor`. Nobody is emailed: they sign in with Google. No id comes back.
 * Every target is gated first (`registrationForm`).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const body = await bodyOf(request);
  if (!body) return refused("Send the mentor as JSON.", 400);
  const reader = await readerFor(user);
  // `mentors`: the website's "several at once", into the same programs.
  if ("mentors" in body) {
    const batch = await batchRegistrationForm(reader, body);
    if (batch instanceof Response) return batch;
    return fromAction(await createMentors(null, batch));
  }
  const form = await registrationForm(reader, body);
  if (form instanceof Response) return form;
  return fromAction(await createMentor(null, form));
}
