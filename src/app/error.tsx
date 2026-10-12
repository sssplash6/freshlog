"use client";

import { ErrorState } from "@/components/error-state";

/**
 * The only route error boundary in the app, and it sits ABOVE the shell on
 * purpose.
 *
 * There were five, one per route tree, each a near-identical wrapper differing
 * in a title and a home link. They were also in the wrong place: a boundary
 * inside `/admin` renders inside `AppShell`, and the shell now reads the
 * database itself — the lens cookie, the unread count, the grants behind the
 * nav. When the shell is what threw, a boundary underneath it can only try to
 * paint the shell again and throw again. Hoisting it above every layout means
 * the one thing guaranteed to render is the one thing that says what happened.
 *
 * "Back to safety" goes to `/`, which is a server redirect to whoever's home
 * this reader has — so one boundary needs no per-tree copy of that answer.
 * `global-error.tsx` is the layer below this one: it catches the root layout
 * itself, and replaces it.
 */
export default function SectionError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    // The shell is gone at this point, and with it the padding every page used
    // to inherit — so this supplies its own rather than running flush to the
    // edges of a 390px screen.
    <div className="flex flex-1 flex-col justify-center px-4">
      <ErrorState
        error={error}
        retry={unstable_retry}
        title="This page didn’t load"
        home="/"
      />
    </div>
  );
}
