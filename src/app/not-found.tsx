import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";

/**
 * Every notFound() lands here — a real 404, a program outside somebody's
 * grants, a student who is not theirs to see. The sentence deliberately
 * cannot tell those apart, because the gate's whole point is that "not
 * yours" and "does not exist" are the same page.
 *
 * `/` is the way back: the root page redirects to whoever's home this reader
 * has, so this needs no per-role copy of that answer.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <EmptyState
        title="No such page"
        framed
        className="w-full max-w-md"
      >
        It doesn&apos;t exist — or isn&apos;t yours to see.
        <Link
          href="/"
          className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink transition-colors hover:border-brand/40 hover:text-brand"
        >
          Go home
        </Link>
      </EmptyState>
    </div>
  );
}
