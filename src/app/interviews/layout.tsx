import { AppShell } from "@/components/app-shell";
import { requireAdminAccess } from "@/lib/dal";

// Authenticated, per-user pages that read the database on every request.
// Never prerender them at build time — on Render the SQLite disk only exists
// at runtime, so build-time DB access would fail.
export const dynamic = "force-dynamic";

export default async function InterviewsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdminAccess();
  return <AppShell user={user}>{children}</AppShell>;
}
