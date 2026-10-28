/**
 * A partner school's staff reading their students' feedback. Still no
 * AppShell — they have no account here either — but a page of tables, read at
 * a desk as often as on a phone, so the app's own width rather than the
 * students' narrow column.
 */
export default function PartnerStaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
      {children}
    </main>
  );
}
