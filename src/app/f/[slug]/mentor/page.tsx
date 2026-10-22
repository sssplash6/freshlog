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
    select: { mentor: { select: { id: true, name: true } } },
  });
  // By name only, and a mentor with none is left out. Not the app's usual
  // `name ?? email`: this page is public, and a staff address has no place on
  // it. A blank Google name is stored as null, and an invited mentor who never
  // signed in may have none.
  const mentors = ticked
    .flatMap(({ mentor }) => {
      const label = mentor.name?.trim();
      return label ? [{ id: mentor.id, label }] : [];
    })
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
