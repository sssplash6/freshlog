import Link from "next/link";

import { FlagIcon } from "@/components/icons";

/**
 * The way to tell the school about a mentor, as the biggest thing on Home —
 * in the top-right, under the profile picture, half a column wide from `sm` up.
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
      className="press sheen flex h-14 w-full items-center justify-center gap-2.5 sm:w-80 rounded-xl bg-brand text-title font-semibold text-on-brand shadow-lg transition-colors hover:bg-brand-dark"
    >
      <FlagIcon className="h-5 w-5" />
      Report a mentor
    </Link>
  );
}
