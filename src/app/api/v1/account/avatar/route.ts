import { removeOwnAvatar, setOwnAvatar } from "@/lib/actions/profile";
import { multipartOf, onField } from "@/lib/api/v1/account-forms";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Replace your picture: `setOwnAvatar`, with the request's multipart body as
 * the form it reads ("avatar", one file). The app resizes first, as the
 * browser does, but the action judges the bytes either way.
 */
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const form = await multipartOf(request);
  if (!form) return refused("Send the picture as multipart/form-data.", 400, { field: "avatar" });
  return fromAction(onField(await setOwnAvatar(form), "avatar"));
}

/** Back to the initials: `removeOwnAvatar`. */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  return fromAction(await removeOwnAvatar());
}
