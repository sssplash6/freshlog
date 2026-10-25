import type { Metadata } from "next";

import { openPartner } from "./pass";

// Reads the pass cookie and the partner's lists on every request; never prerender.
export const dynamic = "force-dynamic";

/**
 * Inherited by every page under /f/<slug>. Never indexed: the link is handed
 * out in a Telegram group, and a search result for it would advertise a form
 * to people who are not on the list.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const partner = await openPartner((await params).slug);
  return {
    title: `${partner.name} feedback`,
    robots: { index: false, follow: false },
  };
}

/**
 * The gate only. The frame is each side's own: the students' form is one
 * narrow column for a phone ((form)/layout.tsx), the staff's view is a wide
 * page of tables (staff/layout.tsx), and a layout here would force one shape
 * on both.
 */
export default async function PartnerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  await openPartner((await params).slug);
  return children;
}
