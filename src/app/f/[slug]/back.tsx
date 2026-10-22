import Link from "next/link";

import { ChevronLeftIcon } from "@/components/icons";

/**
 * Back to the choice, for a student whose link opened the other form. Not
 * PageTitle's back row: that one hides under `sm` for the app's phone top
 * bar, and these pages have no top bar to lift it into.
 */
export function BackToChoice({ slug }: { slug: string }) {
  return (
    <Link
      href={`/f/${slug}`}
      className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand hover:text-brand-dark"
    >
      <ChevronLeftIcon className="h-4 w-4" />
      Back
    </Link>
  );
}
