import { AppShell } from "@/components/app-shell";
import { requirePlatformAdmin } from "@/lib/dal";

// Authenticated pages that read the database on every request. Never
// prerender them at build time — on Render the SQLite disk only exists at
// runtime, so build-time DB access would fail.
export const dynamic = "force-dynamic";

/**
 * Partner schools' feedback forms, for platform admins. Linked from nowhere
 * yet; reached by URL.
 *
 * Each page calls `requirePlatformAdmin` again on its own first line: Next
 * renders a layout and its page in PARALLEL, so a `notFound()` thrown here
 * alone would not stop the page running its queries (AGENTS.md "Gate every
 * page").
 */
export default async function PartnersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requirePlatformAdmin();
  return <AppShell user={user}>{children}</AppShell>;
}
