import { PartnerMentorForm } from "@/components/forms/partner-feedback-forms";
import { prisma } from "@/lib/prisma";

import { BackToChoice } from "../back";
import { EmailStep, openPartner, passHolder, StepTitle } from "../pass";

/** Rate one of the mentors this partner has ticked. */
export default async function PartnerMentorPage({ params }: { params: Promise<{ slug: string }> }) {
  const partner = await openPartner((await params).slug);
  const email = await passHolder(partner);
  if (!email) return <EmailStep partner={partner} />;

  const ticked = await prisma.partnerMentor.findMany({
    where: { partnerId: partner.id },
    select: { mentor: { select: { id: true, name: true, email: true } } },
  });
  // The name the rest of the app prints for a mentor, the email where they
  // never gave one.
  const mentors = ticked
    .map(({ mentor }) => ({ id: mentor.id, label: mentor.name ?? mentor.email }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-4">
      <BackToChoice slug={partner.slug} />
      <StepTitle>Rate a mentor</StepTitle>
      {mentors.length > 0 ? (
        <PartnerMentorForm slug={partner.slug} mentors={mentors} />
      ) : (
        <p className="text-body leading-relaxed text-muted-fg">
          {partner.name} hasn&apos;t listed any mentors to rate yet.
        </p>
      )}
    </div>
  );
}
