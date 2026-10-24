import { PartnerEmailForm } from "@/components/forms/partner-feedback-forms";
import { PartnerFeedbackView } from "@/components/partner-feedback-view";
import { PageTitle } from "@/components/ui/section";
import { forgetPartnerStaffEmail } from "@/lib/actions/partner-feedback";
import type { SearchParams } from "@/lib/filters";
import { PASS_HOURS } from "@/lib/partner-feedback";

import { openPartner, staffHolder, StepTitle } from "../pass";

/**
 * What a partner school's own staff see: every rating their students left,
 * read-only, with the same summary and filters our admins have
 * (`PartnerFeedbackView`). Reached by link, gated by the partner's staff list
 * — a list of its own, so a student's email, and a student's pass, open
 * nothing here.
 *
 * The gate runs first, on every visit, before any feedback is read
 * (AGENTS.md "Gate every page"): an open partner, then a staff pass for an
 * address still on the list. Switching the form off closes this page too —
 * one switch, "off", means the partner's links answer as if they did not exist.
 */
export default async function PartnerStaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const partner = await openPartner((await params).slug);
  const email = await staffHolder(partner);

  if (!email) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <p className="text-sm font-semibold text-muted-fg">{partner.name}</p>
        <div className="space-y-2">
          <StepTitle>Student feedback</StepTitle>
          <p className="text-body leading-relaxed text-muted-fg">
            For {partner.name} staff. Enter your work email; this browser
            remembers it for {PASS_HOURS} hours.
          </p>
        </div>
        <PartnerEmailForm slug={partner.slug} purpose="staff" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PartnerFeedbackView
        partner={partner}
        query={await searchParams}
        basePath={`/f/${partner.slug}/staff`}
        audience="staff"
        title={(standing) => (
          <PageTitle
            title={`${partner.name} student feedback`}
            subtitle={standing}
            actions={
              // A shared office computer: drop the pass and the page falls
              // back to the email step in the same round trip.
              <form
                action={forgetPartnerStaffEmail.bind(null, partner.slug)}
                className="flex flex-wrap items-center justify-end gap-x-2 text-sm text-muted-fg"
              >
                <span className="min-w-0 break-all">{email}</span>
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center font-semibold text-brand hover:text-brand-dark"
                >
                  Not you?
                </button>
              </form>
            }
          />
        )}
      />
    </div>
  );
}
