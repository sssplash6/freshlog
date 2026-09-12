import Link from "next/link";

import { unsubscribeWeekly } from "@/lib/actions/email-prefs";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";

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
          "It may have been broken by your email client, or it may be from before a security change. Sign in and use the toggle on your notifications page instead.",
      }
    ) : (
      { title: "Turn off weekly summary emails?", blurb: "" }
    );

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-canvas px-4 py-16">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="h-[0.1875rem] w-full bg-accent" aria-hidden="true" />
        <div className="p-6 sm:p-7">
          <div className="text-[0.9375rem] font-bold text-brand">freshlog</div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">
            {body.title}
          </h1>

          {armed && !state ? (
            <>
              <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-muted-fg">
                You&apos;ll stop getting the Monday email about time you&apos;ve
                used and time still to book. Deadline reminders inside the app
                carry on.
              </p>
              <form action={unsubscribeWeekly} className="mt-5 flex flex-wrap gap-2">
                <input type="hidden" name="u" value={u} />
                <input type="hidden" name="t" value={t} />
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-medium text-on-brand transition-colors hover:bg-brand-dark"
                >
                  Turn them off
                </button>
                <Link
                  href="/"
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-4 text-sm font-medium text-muted-fg transition-colors hover:text-ink"
                >
                  Keep them
                </Link>
              </form>
            </>
          ) : (
            <>
              <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-muted-fg">
                {body.blurb}
              </p>
              <Link
                href="/"
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-4 text-sm font-medium text-muted-fg transition-colors hover:text-ink"
              >
                Go to freshlog
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
