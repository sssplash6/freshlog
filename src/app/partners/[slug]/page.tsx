import { notFound } from "next/navigation";

import { PartnerFeedbackView } from "@/components/partner-feedback-view";
import { LinkButton } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/section";
import { requirePlatformAdmin } from "@/lib/dal";
import type { SearchParams } from "@/lib/filters";
import { normalizeSlug } from "@/lib/partner-feedback";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Partner feedback" };

/**
 * A platform admin's read of one partner's feedback. The view itself is
 * shared with the school's own staff page (/f/<slug>/staff); what is this
 * page's alone is the gate, the way back to /partners, and Settings.
 */
export default async function PartnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requirePlatformAdmin();

  // An unknown slug and a malformed one are the same 404. A partner whose
  // form is off is still found: its feedback is still here to read.
  const slug = normalizeSlug((await params).slug);
  const partner = slug
    ? await prisma.feedbackPartner.findUnique({
        where: { slug },
        select: { id: true, slug: true, name: true, active: true },
      })
    : null;
  if (!partner) notFound();

  const basePath = `/partners/${partner.slug}`;

  return (
    <div className="space-y-4">
      <PartnerFeedbackView
        partner={partner}
        query={await searchParams}
        basePath={basePath}
        audience="admin"
        title={(standing) => (
          <PageTitle
            backHref="/partners"
            backLabel="Partners"
            title={partner.name}
            eyebrow={partner.active ? undefined : "Form switched off"}
            subtitle={standing}
            actions={
              <LinkButton href={`${basePath}/settings`} variant="secondary">
                Settings
              </LinkButton>
            }
          />
        )}
      />
    </div>
  );
}
