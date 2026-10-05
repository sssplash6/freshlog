import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import {
  hasUnseenChangelog,
  isUnseen,
  readChangelog,
  splitItem,
  type ChangelogEntry,
} from "@/lib/changelog";
import { requireUser } from "@/lib/dal";
import { formatDate } from "@/lib/format";

import { FreshChip, MarkChangelogSeen } from "./seen";

/**
 * What changed, written for the person using the product.
 *
 * Every role reads it and nothing on it is scoped — it is not about a student
 * or a program — but the gate still goes on the first line: the layout's
 * redirect does not stop this function running (AGENTS.md, "Gate every page").
 */
export default async function ChangelogPage() {
  const user = await requireUser();
  const entries = await readChangelog();

  return (
    <div className="space-y-4">
      {hasUnseenChangelog(entries, user) && <MarkChangelogSeen />}

      <PageTitle
        title="What's new"
        subtitle={
          <>
            What we have added and fixed.{" "}
            <Link href="/bugs" className="text-brand underline underline-offset-2 hover:decoration-2">
              Bug reports
            </Link>
          </>
        }
      />

      {entries.length === 0 ? (
        <EmptyState title="No updates yet">Changes are posted here as they ship.</EmptyState>
      ) : (
        entries.map((entry) => (
          <Section
            key={entry.date}
            id={entry.date}
            title={
              <>
                {formatDate(new Date(`${entry.date}T00:00:00.000Z`))}{" "}
                <FreshChip fresh={isUnseen(entry, user)} />
              </>
            }
          >
            <div className="divide-y divide-line">
              <Items label="New" items={entry.new} />
              <Items label="Fixed" items={entry.fixed} />
            </div>
          </Section>
        ))
      )}
    </div>
  );
}

function Items({ label, items }: { label: string; items: ChangelogEntry["new"] }) {
  if (items.length === 0) return null;
  return (
    <div className="px-4 py-3 sm:px-5">
      <h3 className="text-[0.75rem] font-semibold uppercase tracking-wide text-muted-fg">
        {label}
        <span className="ml-1.5 font-medium tabular-nums">{items.length}</span>
      </h3>
      <ul className="mt-2 space-y-3">
        {items.map((item) => {
          const { headline, detail } = splitItem(item);
          return (
            <li key={item}>
              {headline && <p className="text-[0.9375rem] font-semibold text-ink">{headline}</p>}
              {detail && (
                <p
                  className={
                    headline
                      ? "mt-0.5 text-[0.875rem] leading-snug text-muted-fg"
                      : "text-[0.9375rem] text-ink"
                  }
                >
                  {detail}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
