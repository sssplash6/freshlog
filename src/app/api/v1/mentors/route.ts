import { createMentor } from "@/lib/actions/mentors";
import { bodyOf } from "@/lib/api/v1/body";
import { registrationForm } from "@/lib/api/v1/mentors";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

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
  const form = await registrationForm(await readerFor(user), body);
  if (form instanceof Response) return form;
  return fromAction(await createMentor(null, form));
}
