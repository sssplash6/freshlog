import { notFound } from "next/navigation";

import {
  CopyLink,
  PartnerDetailsForm,
  PartnerEmailsForm,
  PartnerMentorsForm,
} from "@/components/forms/partner-settings-forms";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { canActAsMentor, ROLES, USER_STATUS } from "@/lib/constants";
import { requirePlatformAdmin } from "@/lib/dal";
import { appUrl } from "@/lib/email/send";
import { normalizeSlug } from "@/lib/partner-feedback";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Partner settings" };

/**
 * Everything a partner's form needs before it is handed out: its name and
 * on/off, the three links, the students' emails, and the mentors to rate.
 *
 * The links are absolute because they are pasted into a Telegram group, where
 * a path means nothing.
 */
export default async function PartnerSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requirePlatformAdmin();

  const slug = normalizeSlug((await params).slug);
  const partner = slug
    ? await prisma.feedbackPartner.findUnique({
        where: { slug },
        select: {
          id: true,
          slug: true,
          name: true,
          active: true,
          students: { orderBy: { email: "asc" }, select: { id: true, email: true } },
          mentors: { select: { mentorId: true } },
        },
      })
    : null;
  if (!partner) notFound();

  const ticked = new Set(partner.mentors.map((m) => m.mentorId));

  // Only active users who may act as a mentor: what is listed is what a save
  // keeps. The role read is wider than `canActAsMentor` so the flag check stays
  // in one place, the filter below.
  const candidates = await prisma.user.findMany({
    where: {
      status: USER_STATUS.ACTIVE,
      role: { in: [ROLES.MENTOR, ROLES.ADMIN, ROLES.STUDENT] },
    },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, name: true, email: true, role: true, isMentor: true },
  });
  const mentors = candidates
    .filter(canActAsMentor)
    .map((u) => ({
      id: u.id,
      // Trimmed the way the public dropdown trims it, so "no name" here means
      // exactly what it means there.
      name: u.name?.trim() || null,
      email: u.email,
      ticked: ticked.has(u.id),
    }));

  const base = `${appUrl()}/f/${partner.slug}`;
  const links = [
    { label: "Start page", hint: "Students pick a mentor or a session.", url: base },
    { label: "Rate a mentor", hint: "Straight to the mentor form.", url: `${base}/mentor` },
    { label: "Rate a session", hint: "Straight to the session form.", url: `${base}/session` },
  ];

  return (
    <div className="space-y-4">
      <PageTitle
        backHref={`/partners/${partner.slug}`}
        backLabel={partner.name}
        title={`${partner.name} settings`}
      />

      <Section title="Details">
        <PartnerDetailsForm
          partnerId={partner.id}
          name={partner.name}
          active={partner.active}
        />
      </Section>

      <Section
        title="Links"
        caption={partner.active ? undefined : "The form is off; these links answer not found."}
      >
        <ul className="divide-y divide-line">
          {links.map((l) => (
            <li key={l.url} className="space-y-1 px-4 py-3 sm:px-5">
              <p className="text-body font-medium text-ink">{l.label}</p>
              <p className="text-xs text-muted-fg">{l.hint}</p>
              <CopyLink url={l.url} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Students" count={partner.students.length}>
        <PartnerEmailsForm partnerId={partner.id} emails={partner.students} />
      </Section>

      <Section title="Mentors" count={ticked.size}>
        {mentors.length === 0 ? (
          <EmptyState framed={false} title="No mentors">
            Nobody can act as a mentor yet.
          </EmptyState>
        ) : (
          <PartnerMentorsForm partnerId={partner.id} mentors={mentors} />
        )}
      </Section>
    </div>
  );
}
