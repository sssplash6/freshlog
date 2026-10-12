import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLink } from "@/components/ui/link";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { fixedBugs, myBugReports } from "@/lib/bug-queries";
import {
  BUG_STATUS_LABELS,
  BUG_STATUS_SEVERITY,
  isBugStatus,
} from "@/lib/bugs";
import { requireUser } from "@/lib/dal";
import { formatDate } from "@/lib/format";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Bug reports" };

/**
 * Two lists with different readers' rights.
 *
 * "Your reports" is yours alone, in your own words. "Fixed" is everybody's, and
 * is the fix line only — the reporter's wording can name a student, so it is not
 * on this page and the query behind it does not select it.
 */
export default async function BugsPage() {
  const user = await requireUser();
  const [mine, fixed] = await Promise.all([myBugReports(user.id), fixedBugs()]);

  return (
    <div className="space-y-4">
      <PageTitle
        title="Bug reports"
        subtitle="What you have reported, and what we have fixed."
        actions={
          <div className="flex items-center gap-3">
            {user.platformAdmin && <ArrowLink href="/bugs/triage">Triage</ArrowLink>}
            <Link href="/bugs/new" className={buttonClasses()}>
              Report a bug
            </Link>
          </div>
        }
      />

      <Section title="Your reports" count={mine.length}>
        {mine.length === 0 ? (
          <EmptyState framed={false} title="No reports yet">
            Use Report a bug when something looks wrong.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <Link href={`/bugs/${r.id}`} className="font-medium text-ink hover:underline">
                    {r.title}
                  </Link>
                  <p className="text-xs text-muted-fg">Sent {formatDate(r.createdAt)}</p>
                </div>
                {isBugStatus(r.status) && (
                  <StatusChip severity={BUG_STATUS_SEVERITY[r.status]}>
                    {BUG_STATUS_LABELS[r.status]}
                  </StatusChip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Fixed" count={fixed.length}>
        {fixed.length === 0 ? (
          <EmptyState framed={false} title="Nothing fixed yet">
            Fixes are posted as they ship.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {fixed.map((f, i) => (
              <li key={i} className="space-y-1 px-4 py-3 sm:px-5">
                <p className="text-body text-ink">{f.resolution}</p>
                <p className="text-xs text-muted-fg">
                  {f.resolvedAt ? formatDate(f.resolvedAt) : null}
                  {f.changelogDate && (
                    <>
                      {f.resolvedAt ? " · " : null}
                      <Link href={`/changelog#${f.changelogDate}`} className="text-brand hover:underline">
                        In the changelog
                      </Link>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
