import Link from "next/link";

import { ChevronRightIcon, UserIcon, UsersIcon } from "@/components/icons";
import { forgetPartnerEmail } from "@/lib/actions/partner-feedback";

import { EmailStep, openPartner, passHolder, StepTitle } from "./pass";

/**
 * The link a partner posts in its Telegram group: check in, then choose what
 * to rate. `/mentor` and `/session` links skip the choice; this is the one to
 * share when the group is asked for both.
 */
export default async function PartnerFeedbackPage({ params }: { params: Promise<{ slug: string }> }) {
  const partner = await openPartner((await params).slug);
  const email = await passHolder(partner);
  if (!email) return <EmailStep partner={partner} />;

  const base = `/f/${partner.slug}`;
  const choices = [
    { href: `${base}/mentor`, label: "Rate a mentor", icon: UserIcon },
    { href: `${base}/session`, label: "Rate a session", icon: UsersIcon },
  ];

  return (
    <div className="space-y-4">
      <StepTitle>What would you like to rate?</StepTitle>

      <ul className="space-y-3">
        {choices.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            {/* Whole-card targets: this is read on a phone, one thumb, from a
                chat app's in-app browser. */}
            <Link
              href={href}
              className="flex min-h-16 items-center gap-3 rounded-xl bg-surface px-4 py-3 text-body font-semibold text-ink shadow-sm transition-colors hover:bg-fill"
            >
              <Icon className="h-5 w-5 shrink-0 text-muted-fg" />
              <span className="min-w-0 flex-1">{label}</span>
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-fg" />
            </Link>
          </li>
        ))}
      </ul>

      {/* A shared phone, or the wrong address typed: drop the pass and the
          page re-renders on the email step (deleting a cookie in a server
          action refreshes the route in the same round trip). */}
      <form
        action={forgetPartnerEmail.bind(null, partner.slug)}
        className="flex flex-wrap items-center gap-x-2 text-sm text-muted-fg"
      >
        <span className="min-w-0 break-all">{email}</span>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center font-semibold text-brand hover:text-brand-dark"
        >
          Not you?
        </button>
      </form>
    </div>
  );
}
