import { redirect } from "next/navigation";

import { Callout } from "@/components/ui/callout";
import { SubmitButton } from "@/components/ui/submit-button";
import { signIn } from "@/lib/auth";
import { getCurrentUser } from "@/lib/dal";
import { homeFor, profileOf } from "@/lib/profile";

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
    <main className="flex flex-1 items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 text-sm font-semibold uppercase tracking-widest text-brand">
            Freshman Academy
          </div>
          <h1 className="text-2xl font-bold text-ink">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-fg">
            Sign in to see your mentoring time and book your next session.
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
            variant="secondary"
            pendingText="Opening Google…"
            className="w-full gap-3 py-3 text-[0.9375rem] text-ink"
          >
            <GoogleIcon />
            Continue with Google
          </SubmitButton>
        </form>

        <p className="mt-4 text-center text-xs text-muted-fg">
          Students: use the email your program registered. Mentors: use your
          @freshman.academy account.
        </p>
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
