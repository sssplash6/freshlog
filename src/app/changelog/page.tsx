import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { hasUnseenChangelog, isUnseen, readChangelog, type ChangelogEntry } from "@/lib/changelog";
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

      <PageTitle title="What's new" subtitle="What we have added and fixed." />

      {entries.length === 0 ? (
        <EmptyState title="No updates yet">Changes are posted here as they ship.</EmptyState>
      ) : (
        entries.map((entry) => (
          <Section
            key={entry.date}
            title={
              <>
                {formatDate(new Date(`${entry.date}T00:00:00.000Z`))}{" "}
                <FreshChip fresh={isUnseen(entry, user)} />
              </>
            }
          >
            <div className="space-y-4 px-1">
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
    <div>
      <h3 className="text-[0.8125rem] font-semibold text-muted-fg">{label}</h3>
      <ul className="mt-1.5 list-disc space-y-1.5 pl-5 text-[0.9375rem] text-ink">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
