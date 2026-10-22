import type { Metadata } from "next";

import { openPartner } from "./pass";

// Reads the pass cookie and the partner's lists on every request; never prerender.
export const dynamic = "force-dynamic";

/**
 * Inherited by all three pages. Never indexed: the link is handed out in a
 * Telegram group, and a search result for it would advertise a form to people
 * who are not on the list.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const partner = await openPartner((await params).slug);
  return {
    title: `${partner.name} feedback`,
    robots: { index: false, follow: false },
  };
}

/**
 * A partner school's feedback form, opened on a phone from a Telegram link.
 *
 * No AppShell, no nav, no account menu: the reader has no account and nothing
 * else here is theirs. One narrow column, and the school's name above it so
 * the student knows whose list they are being checked against.
 */
export default async function PartnerFeedbackLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const partner = await openPartner((await params).slug);

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
      <p className="mb-5 text-sm font-semibold text-muted-fg">{partner.name}</p>
      {children}
    </main>
  );
}
