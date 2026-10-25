import "server-only";

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PartnerEmailForm } from "@/components/forms/partner-feedback-forms";
import { activePartner, PASS_HOURS, passCookieName, readPass } from "@/lib/partner-feedback";
import { prisma } from "@/lib/prisma";

/**
 * What every page under /f/[slug] asks first, in one place.
 *
 * There is no user to gate on here — these students have no account — so the
 * gate is the partner itself: open, or the ordinary 404. Request-cached
 * because the layout and the page both ask, and Next renders them in
 * parallel; each still asks for itself (AGENTS.md "Gate every page").
 */
export const openPartner = cache(async (slug: string) => {
  const partner = await activePartner(slug);
  if (!partner) notFound();
  return partner;
});

type Partner = Awaited<ReturnType<typeof openPartner>>;

/**
 * The email this visitor may write as, or null for the email step.
 *
 * A valid pass is not enough on its own: an address taken off the list while
 * its 12-hour pass is still live would otherwise get a form it can no longer
 * submit. The action asks both again on submit; this only decides which step
 * to show. Always the row's slug, never the one typed in the URL.
 */
export async function passHolder(partner: Partner): Promise<string | null> {
  const jar = await cookies();
  const email = readPass(partner.slug, jar.get(passCookieName(partner.slug))?.value, new Date());
  if (!email) return null;
  const listed = await prisma.partnerStudent.findUnique({
    where: { partnerId_email: { partnerId: partner.id, email } },
    select: { id: true },
  });
  return listed ? email : null;
}

/**
 * The staff member reading /f/<slug>/staff, or null for its email step. The
 * same two questions as `passHolder` — a live pass, and still on the list —
 * asked of the staff cookie and the staff list. Asked on every visit: the page
 * is the only place this pass is ever used, so there is no later check to lean on.
 */
export async function staffHolder(partner: Partner): Promise<string | null> {
  const jar = await cookies();
  const email = readPass(
    partner.slug,
    jar.get(passCookieName(partner.slug, "staff"))?.value,
    new Date(),
    "staff"
  );
  if (!email) return null;
  const listed = await prisma.partnerStaff.findUnique({
    where: { partnerId_email: { partnerId: partner.id, email } },
    select: { id: true },
  });
  return listed ? email : null;
}

/** The one heading size these pages use: a page's h1 on a phone. */
export function StepTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="text-figure-lg font-bold leading-tight tracking-[-0.01em] text-ink">
      {children}
    </h1>
  );
}

/**
 * Step one, on whichever page the link opened. The pass is set for all of
 * /f/<slug>, so a /mentor link lands back on the mentor form once it is in.
 */
export function EmailStep({ partner }: { partner: Partner }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <StepTitle>Leave feedback</StepTitle>
        <p className="text-body leading-relaxed text-muted-fg">
          Enter the email {partner.name} has for you. This browser remembers it
          for {PASS_HOURS} hours.
        </p>
      </div>
      <PartnerEmailForm slug={partner.slug} />
    </div>
  );
}
