import Link from "next/link";

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Support" };

/**
 * The support page the App Store listing links to, so it is public: see
 * PUBLIC_PATHS in src/proxy.ts.
 */
export default function SupportPage() {
  return (
    <main className="flex min-h-full flex-1 justify-center bg-canvas px-4 py-12">
      <article className="w-full max-w-2xl rounded-2xl bg-surface p-6 shadow-sm sm:p-8">
        <div className="text-base font-bold tracking-tight text-brand">freshlog</div>
        <h1 className="mt-4 text-figure-lg font-bold leading-tight tracking-[-0.01em] text-ink">
          Support
        </h1>

        <div className="mt-6 space-y-3 text-body leading-relaxed text-ink [&_h2]:pt-4 [&_h2]:text-base [&_h2]:font-semibold">
          <p>
            freshlog is the app of Freshman Academy&apos;s mentoring programs. For help,
            email{" "}
            <a href="mailto:tech@freshman.academy" className="font-medium text-brand underline">
              tech@freshman.academy
            </a>{" "}
            with the email address you sign in with and what happened.
          </p>

          <h2>Signing in</h2>
          <p>
            Sign in with the Google account your program knows. If freshlog says it is
            waiting for your program, your program staff still have to add you. If you
            signed in with the wrong account, sign out and choose another.
          </p>

          <h2>Something is broken</h2>
          <p>
            Use Report a bug in the app or on the website. A screenshot helps us see what
            you saw.
          </p>

          <h2>Deleting your account</h2>
          <p>
            In the app, open Account and tap Delete account. It is deleted within 30 days,
            and you can cancel until then.
          </p>

          <p className="pt-4">
            <Link href="/privacy" className="font-medium text-brand underline">
              Privacy policy
            </Link>
          </p>
        </div>
      </article>
    </main>
  );
}
