import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/dal";

// Authenticated, per-user, and reads the database on every request.
export const dynamic = "force-dynamic";

export default async function BugsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
