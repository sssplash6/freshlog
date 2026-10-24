import { PartnerSessionForm } from "@/components/forms/partner-feedback-forms";

import { BackToChoice } from "../../back";
import { EmailStep, openPartner, passHolder, StepTitle } from "../../pass";

/** Rate a class session by its number; the student signs it with their name. */
export default async function PartnerSessionPage({ params }: { params: Promise<{ slug: string }> }) {
  const partner = await openPartner((await params).slug);
  const email = await passHolder(partner);
  if (!email) return <EmailStep partner={partner} />;

  return (
    <div className="space-y-4">
      <BackToChoice slug={partner.slug} />
      <StepTitle>Rate a session</StepTitle>
      <PartnerSessionForm slug={partner.slug} />
    </div>
  );
}
