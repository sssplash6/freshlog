import Link from "next/link";

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

  const body =
    state === "done" ? (
      {
        title: "You're unsubscribed",
        blurb:
          "No more weekly summary emails. Your time and deadlines are unchanged — you can still see them any time by signing in.",
      }
    ) : state === "invalid" || !armed ? (
      {
        title: "This link isn't valid",
        blurb:
          "It may have been broken by your email client, or it may be from before a security change. You can turn the weekly summary off in your settings instead.",
      }
    ) : (
      { title: "Turn off weekly summary emails?", blurb: "" }
    );

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-canvas px-4 py-16">
      {/* No coloured rule across the top: orange means hours in this app, and
          a stripe of it on an email preference page meant nothing. */}
      {/* Centred text, like sign-in and the not-found page: the three pages
          a visitor reaches without the app around them read as one family. */}
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-surface text-center shadow-sm">
        <div className="p-6 sm:p-7">
          <div className="text-base font-bold tracking-tight text-brand">freshlog</div>
          <h1 className="mt-4 text-figure-lg font-bold leading-tight tracking-[-0.01em] text-ink">
            {body.title}
          </h1>

          {armed && !state ? (
            <>
              <p className="mt-2.5 text-body leading-relaxed text-muted-fg">
                You&apos;ll stop getting the Monday email about time you&apos;ve
                used and time still to book. Deadline reminders inside the app
                carry on.
              </p>
              <form action={unsubscribeWeekly} className="mt-5 flex flex-wrap justify-center gap-2">
                <input type="hidden" name="u" value={u} />
                <input type="hidden" name="t" value={t} />
                <button type="submit" className={buttonClasses("primary")}>
                  Turn them off
                </button>
                <Link href="/" className={buttonClasses("secondary")}>
                  Keep them
                </Link>
              </form>
            </>
          ) : (
            <>
              <p className="mt-2.5 text-body leading-relaxed text-muted-fg">
                {body.blurb}
              </p>
              {/* Straight to the switch when the link failed, rather than
                  "sign in and hunt for a setting". Sign-in brings them back
                  here once they have. */}
              {state === "done" ? (
                <Link href="/" className={buttonClasses("secondary", "md", "mt-5")}>
                  Go to freshlog
                </Link>
              ) : (
                <Link
                  href="/settings#notifications"
                  className={buttonClasses("primary", "md", "mt-5")}
                >
                  Open notification settings
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
