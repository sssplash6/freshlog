import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/dal";

export const dynamic = "force-dynamic";

/**
 * Classes: the diary, for the programs that schedule them. Like Sessions, the
 * layout asks only for a signed-in reader and the page gates on what it needs.
 */
export default async function ClassesLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
