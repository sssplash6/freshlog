import Link from "next/link";

import { BugStatusMenu } from "@/components/forms/bug-status-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { TabLinks } from "@/components/ui/segmented";
import { StatusChip } from "@/components/ui/status-chip";
import { triageList, type TriageCard } from "@/lib/bug-queries";
import {
  BUG_KIND,
  BUG_SOURCE,
  BUG_STATUS_LABELS,
  BUG_STATUS_SEVERITY,
  OPEN_BUG_STATUSES,
  isBugStatus,
  readTriageFilter,
} from "@/lib/bugs";
import { requirePlatformAdmin } from "@/lib/dal";
import { readParam, type SearchParams } from "@/lib/filters";
import { formatDate } from "@/lib/format";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Triage" };

/** What a card says under its title: the kind, who sent it, when, and from where. */
function Meta({ card }: { card: TriageCard }) {
  return (
    <p className="text-xs text-muted-fg">
      {card.kind === BUG_KIND.FEATURE ? "Feature request" : "Bug"} · {card.reporterName} ·{" "}
      {formatDate(card.createdAt)}
      {card.source === BUG_SOURCE.TELEGRAM && " · Telegram"}
    </p>
  );
}

/**
 * Every bug report and feature request, from the app and from the team's
 * Telegram group, as a board: one column per open status, and what was
 * finished most recently underneath. Platform admins only — the gate is the
 * first line, and `triageList` refuses anybody else too.
 */
export default async function TriagePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requirePlatformAdmin();
  const filter = readTriageFilter(readParam(await searchParams, "kind"));
  const { open, finished } = await triageList(viewer, filter);

  return (
    <div className="space-y-4">
      <PageTitle
        backHref="/bugs"
        backLabel="Bug reports"
        title="Triage"
        subtitle="Bugs and feature requests, from the app and the Telegram group."
        actions={
          <TabLinks
            label="Kind"
            items={[
              { href: "/bugs/triage", label: "All" },
              { href: "/bugs/triage?kind=BUG", label: "Bugs" },
              { href: "/bugs/triage?kind=FEATURE", label: "Features" },
            ]}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {OPEN_BUG_STATUSES.map((status) => {
          const cards = open.filter((card) => card.status === status);
          return (
            <Section key={status} title={BUG_STATUS_LABELS[status]} count={cards.length}>
              {cards.length === 0 ? (
                <EmptyState framed={false} title={`No reports ${BUG_STATUS_LABELS[status].toLowerCase()}`}>
                  {status === "PENDING"
                    ? "New reports from the app and the group start here."
                    : "Move a card here from its status menu."}
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {cards.map((card) => (
                    <li key={card.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 space-y-0.5">
                        <Link href={`/bugs/${card.id}`} className="font-medium text-ink hover:underline">
                          {card.title}
                        </Link>
                        <Meta card={card} />
                      </div>
                      <BugStatusMenu id={card.id} status={status} title={card.title} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          );
        })}
      </div>

      <Section title="Recently finished" count={finished.length}>
        {finished.length === 0 ? (
          <EmptyState framed={false} title="Nothing finished yet">
            Reports marked Done or Won&apos;t do are listed under the board.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {finished.map((card) => (
              <li
                key={card.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
              >
                <div className="min-w-0">
                  <Link href={`/bugs/${card.id}`} className="font-medium text-ink hover:underline">
                    {card.title}
                  </Link>
                  <Meta card={card} />
                </div>
                {isBugStatus(card.status) && (
                  <StatusChip severity={BUG_STATUS_SEVERITY[card.status]}>
                    {BUG_STATUS_LABELS[card.status]}
                  </StatusChip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
