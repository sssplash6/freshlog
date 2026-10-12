import Link from "next/link";

import { StandaloneCard } from "@/components/standalone-card";
import { buttonClasses } from "@/components/ui/button";

/**
 * Every notFound() lands here — a real 404, a program outside somebody's
 * grants, a student who is not theirs to see. The sentence deliberately
 * cannot tell those apart, because the gate's whole point is that "not
 * yours" and "does not exist" are the same page.
 *
 * It used to say so out loud — "isn't yours to see" — which read as an
 * accusation to somebody who had only followed an old link.
 *
 * `/` is the way back: the root page redirects to whoever's home this reader
 * has, so this needs no per-role copy of that answer.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <StandaloneCard title="Page not found" line="The link may be old.">
        <Link href="/" className={buttonClasses("primary")}>
          Home
        </Link>
      </StandaloneCard>
    </div>
  );
}
