import Link from "next/link";

import { FlagIcon } from "@/components/icons";

/**
 * The way to tell the school about a mentor, on Home — in the top-right, under the
 * profile picture, a slim red button from `sm` up.
 *
 * It used to be a "Feedback" tab at the end of the bottom bar: a word that did
 * not say what it was for, among three that did, and a star icon on a page that
 * was titled "Rate a mentor". A student with something to say about their
 * mentor — the reason the page exists — had to guess which of the two names was
 * theirs. Now it is a full-width brand button, tall, with a flag, saying
 * exactly what it does (October 2026, at the owner's ask: "very obvious and
 * attractive thing to press").
 */
export function ReportMentorButton() {
  return (
    <Link
      href="/student/feedback"
      transitionTypes={["nav-forward"]}
      className="press flex h-10 w-full items-center justify-center gap-2 sm:w-56 rounded-lg bg-danger text-sm font-semibold text-on-danger shadow-sm transition hover:brightness-90"
    >
      <FlagIcon className="h-4 w-4" />
      Report a mentor
    </Link>
  );
}
