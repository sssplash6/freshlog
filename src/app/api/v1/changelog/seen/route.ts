import { markChangelogSeen } from "@/lib/actions/changelog";
import { inactive, mayUse, noContent, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * "I have read what's new": `markChangelogSeen`, which records what the
 * changelog held. The app sends it once the page has shown, as the website
 * does after its page mounts, never on a prefetch.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  await markChangelogSeen();
  return noContent();
}
