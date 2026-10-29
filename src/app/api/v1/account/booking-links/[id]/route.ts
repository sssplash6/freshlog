import { setBookingLink } from "@/lib/actions/mentors";
import { bookingLinkForm, onField } from "@/lib/api/v1/account-forms";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * A mentor's booking link on one of their own pairings: `setBookingLink`,
 * https only, in its words. Somebody else's pairing and one that doesn't
 * exist are the same 404, checked before the action, which would answer the
 * first in words of its own.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { id } = await params;
  const mine = await prisma.mentorAssignment.findFirst({ where: { id, mentorId: user.id }, select: { id: true } });
  if (!mine) return refused("Not found.", 404);
  const form = bookingLinkForm(id, await bodyOf(request));
  if (!(form instanceof FormData)) return refused(form.error, 400, { field: form.field });
  return fromAction(onField(await setBookingLink(null, form), "url"));
}
