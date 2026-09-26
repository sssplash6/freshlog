import { AppShell } from "@/components/app-shell";
import { ROLES } from "@/lib/constants";
import { requireRole } from "@/lib/dal";

// Authenticated, per-user pages that read the database on every request.
// Never prerender them at build time — on Render the SQLite disk only exists
// at runtime, so build-time DB access would fail.
export const dynamic = "force-dynamic";

/**
 * The gate is on the PAGE and not here. Next renders a layout and its page in
 * parallel, so a redirect thrown here does not stop the page from running its
 * queries and streaming the result (`lib/dal.ts:33-43`).
 */
export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole(
    ROLES.ADMIN,
    ROLES.DEPT_LEADER,
    ROLES.SALES,
    ROLES.MENTOR
  );
  return <AppShell user={user}>{children}</AppShell>;
}
