import { redirect } from "next/navigation";

import { Callout } from "@/components/ui/callout";
import { SubmitButton } from "@/components/ui/submit-button";
import { signIn } from "@/lib/auth";
import { getCurrentUser } from "@/lib/dal";
import { homeFor, profileOf } from "@/lib/profile";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in" };

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "Something blocked your sign-in. Students can sign up with any Google account; mentors must use their @freshman.academy account.",
  Configuration: "Sign-in is misconfigured. Please contact the site admin.",
  Default: "Something went wrong signing you in. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Send genuinely signed-in people to their own home. This is a VERIFIED
  // check, not the cookie-presence one the proxy used to do: a user whose
  // cookie no longer decrypts must be able to reach this form and sign in
  // again, which overwrites the bad cookie.
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user, await profileOf(user)));

  const { error } = await searchParams;
  const errorMessage = error
    ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default)
    : null;

  return (
    <main className="relative isolate flex flex-1 items-center justify-center overflow-hidden bg-canvas p-6">
      {/* The page glow, drawn larger: this is the one screen with nothing else
          on it, so the pools of brand blue and hours orange can be seen whole.
          Held to 16% and 12% so the card's grey caption stays above AA. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(38rem_28rem_at_50%_42%,color-mix(in_oklab,var(--color-brand)_15%,transparent),transparent_70%),radial-gradient(30rem_22rem_at_78%_88%,color-mix(in_oklab,var(--color-accent)_12%,transparent),transparent_70%)]"
      />
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 shadow-lg">
        {/* The product's name as a mark, at a size that reads as one — the
            20px nav wordmark was the smallest thing on a screen that has
            nothing else to show. The school's name is how the product is
            introduced, not a second brand beside it. And "Sign in", not
            "Welcome back": most people reaching this screen for the first
            time are students who have never been here. */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="text-display font-bold leading-none tracking-[-0.03em] text-brand">
            freshlog
          </div>
          <div className="mt-2 text-xs font-medium text-muted-fg">
            by Freshman Academy
          </div>
          <h1 className="mt-7 text-figure-lg font-bold leading-tight tracking-[-0.02em] text-ink">
            Sign in
          </h1>
          <p className="mt-2 text-body text-muted-fg">
            See how much time you have with your mentors, book your next
            session and keep track of your tasks.
          </p>
        </div>

        {errorMessage && (
          <Callout tone="danger" className="mb-4">
            {errorMessage}
          </Callout>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <SubmitButton
            variant="ghost"
            pendingText="Opening Google…"
            className="w-full gap-3 bg-surface text-ink shadow-sm ring-1 ring-line hover:bg-canvas"
          >
            <GoogleIcon />
            Continue with Google
          </SubmitButton>
        </form>

        {/* Students first: they are most of the people who sign in, and the
            one rule that trips them up is which Google account to use. */}
        <p className="mt-4 text-center text-xs text-muted-fg">
          Use the Google account your school has on file for you.
          <span className="mt-1 block">
            Mentors: sign in with your @freshman.academy account.
          </span>
        </p>

        {/* Only when the server was started with DEV_LOGIN=1 (`npm run
            start:local`); the route behind it also refuses anything but a
            localhost request. A plain <a>, because the route answers with a
            Set-Cookie redirect the client router must not intercept. */}
        {process.env.DEV_LOGIN === "1" && (
          <a
            href="/api/dev-login"
            className="mt-4 block text-center text-xs font-medium text-brand hover:underline"
          >
            Local sign-in (dev only)
          </a>
        )}
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}
