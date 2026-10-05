import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";

/**
 * Every notFound() lands here — a real 404, a program outside somebody's
 * grants, a student who is not theirs to see. The sentence deliberately
 * cannot tell those apart, because the gate's whole point is that "not
 * yours" and "does not exist" are the same page.
 *
 * It used to say so out loud — "isn't yours to see" — which read as an
 * accusation to somebody who had only followed an old link. Neutral now, and
 * wearing the wordmark like the other pages a visitor can land on without
 * the app around them (sign-in, unsubscribe): an inbox icon in an empty card
 * did not say which product this was.
 *
 * `/` is the way back: the root page redirects to whoever's home this reader
 * has, so this needs no per-role copy of that answer.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 text-center shadow-sm sm:p-7">
        <div className="text-base font-bold tracking-tight text-brand">freshlog</div>
        <h1 className="mt-4 text-[1.5rem] font-bold leading-tight tracking-[-0.01em] text-ink">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-muted-fg">
          The link may be old, or the page may have moved. Your home page has
          everything you need.
        </p>
        <Link href="/" className={buttonClasses("primary", "md", "mt-5")}>
          Go to your home page
        </Link>
      </div>
    </div>
  );
}
