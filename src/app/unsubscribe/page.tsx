import Link from "next/link";

import { StandaloneCard } from "@/components/standalone-card";
import { buttonClasses } from "@/components/ui/button";

import { unsubscribeWeekly } from "@/lib/actions/email-prefs";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Unsubscribe" };

// Reads the database when confirming; never prerender.
export const dynamic = "force-dynamic";

/**
 * The one page in the app that a signed-out stranger may open, reached from the
 * footer of a weekly digest. Public by necessity — see PUBLIC_PATHS in
 * src/proxy.ts — and authorized by the signed token in the URL rather than a
 * session.
 *
 * The link only ARMS the opt-out; a button press performs it. Mail scanners and
 * link previewers fetch URLs in the background, and a GET that switched email
 * off would let a spam filter unsubscribe people who never clicked anything.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; t?: string; state?: string }>;
}) {
  const { u = "", t = "", state } = await searchParams;
  const armed = verifyUnsubscribeToken(u, t);

  const confirming = armed && !state;
  const title =
    state === "done"
      ? "You're unsubscribed"
      : state === "invalid" || !armed
        ? "This link has expired"
        : "Turn off weekly emails?";

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-canvas px-4 py-16">
      <StandaloneCard
        title={title}
        line={state === "done" ? "In-app reminders carry on." : undefined}
      >
        {confirming ? (
          <form action={unsubscribeWeekly} className="flex flex-wrap justify-center gap-2">
            <input type="hidden" name="u" value={u} />
            <input type="hidden" name="t" value={t} />
            <button type="submit" className={buttonClasses("primary")}>
              Turn them off
            </button>
            <Link href="/" className={buttonClasses("secondary")}>
              Keep them
            </Link>
          </form>
        ) : state === "done" ? (
          <Link href="/" className={buttonClasses("secondary")}>
            Go to freshlog
          </Link>
        ) : (
          // Straight to the switch when the link failed, rather than "sign in
          // and hunt for a setting". Sign-in brings them back here once they have.
          <Link href="/settings#notifications" className={buttonClasses("primary")}>
            Notification settings
          </Link>
        )}
      </StandaloneCard>
    </main>
  );
}
