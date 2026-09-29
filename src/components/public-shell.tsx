import pkg from "../../package.json";
import { BrandWordmark } from "@/components/brand-wordmark";
import { LogOutIcon } from "@/components/icons";
import { PageTransition } from "@/components/page-transition";
import { signOut } from "@/lib/auth";
import type { User } from "@/generated/prisma/client";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

/**
 * The shell for a reader who has nowhere to go yet: a wordmark, and a way out.
 *
 * It wraps the sign-in page and the three states where the app is still
 * deciding who somebody is — a self-signed-up student waiting for approval, a
 * mentor waiting to be placed in a program, and anyone part-way through
 * onboarding.
 *
 * No nav, and that is the whole point. Every one of those readers has exactly
 * one page they are allowed to be on, so a nav bar here is four links that
 * bounce them straight back to where they already are; `book/page.tsx` had a
 * "Back to your hours" link that did precisely that. A shell that offers
 * nothing is a smaller lie than a shell that offers what it cannot deliver.
 *
 * Sign out stays, because it is the one thing that always works, and because
 * "wrong Google account" is the single most likely reason somebody is stuck on
 * one of these pages at all.
 */
export function PublicShell({
  user,
  children,
}: {
  /** Absent on /login, where there is nobody to sign out. */
  user?: User | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-line/60 bg-surface/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex min-h-16 max-w-2xl items-center justify-between gap-3 px-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
          <BrandWordmark version={pkg.version} />
          {user && (
            <form action={signOutAction} className="flex items-center gap-2">
              <span className="hidden min-w-0 truncate text-sm text-muted-fg sm:inline">
                {user.email}
              </span>
              <button
                type="submit"
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-[0.9375rem] font-medium text-brand transition-colors hover:bg-fill"
              >
                <LogOutIcon className="h-4 w-4" />
                Sign out
              </button>
            </form>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  );
}
