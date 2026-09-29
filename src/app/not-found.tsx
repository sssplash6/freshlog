import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
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
        action={
          <Link href="/" className={buttonClasses("secondary", "md", "mt-2")}>
            Go home
          </Link>
        }
      >
        It doesn&apos;t exist — or isn&apos;t yours to see.
      </EmptyState>
    </div>
  );
}
