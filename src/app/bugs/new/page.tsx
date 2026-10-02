import { ReportBugForm } from "@/components/forms/bug-report-form";
import { PageTitle } from "@/components/ui/section";
import { sanitizePagePath } from "@/lib/bugs";
import { requireUser } from "@/lib/dal";
import { readParam, type SearchParams } from "@/lib/filters";

export default async function NewBugPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const from = sanitizePagePath(readParam(await searchParams, "from"));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle
        backHref="/bugs"
        backLabel="Bug reports"
        title="Report a bug"
        subtitle="Only you and the people fixing it can read your report."
      />
      <ReportBugForm from={from} />
    </div>
  );
}
