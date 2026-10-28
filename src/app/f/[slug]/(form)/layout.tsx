import { openPartner } from "../pass";

/**
 * A partner school's feedback form, opened on a phone from a Telegram link.
 *
 * No AppShell, no nav, no account menu: the reader has no account and nothing
 * else here is theirs. One narrow column, and the school's name above it so
 * the student knows whose list they are being checked against.
 */
export default async function PartnerFormLayout({
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
