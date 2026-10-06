import Link from "next/link";

import { CheckIcon, SparklesIcon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/section";
import { cn } from "@/lib/cn";
import {
  hasUnseenChangelog,
  isUnseen,
  readChangelog,
  splitItem,
  type ChangelogEntry,
} from "@/lib/changelog";
import { ROLES } from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import { formatDate } from "@/lib/format";

import { FreshChip, MarkChangelogSeen } from "./seen";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "What's new" };

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
  const week = pastWeek(entries);
  // Bug reports are a staff tool, and a "51 fixed" figure in the hero tells a
  // student the app was broken rather than that it got better. The entries
  // themselves are not tagged by who they are for, so the whole log stays;
  // only the framing around it changes.
  const student = user.role === ROLES.STUDENT;

  return (
    <div className="space-y-4">
      {hasUnseenChangelog(entries, user) && <MarkChangelogSeen />}

      <PageTitle
        title="What's new"
        subtitle={
          student ? (
            "What we've added and improved."
          ) : (
            <>
              What we have added and fixed.{" "}
              <Link href="/bugs" className="text-brand underline underline-offset-2 hover:decoration-2">
                Bug reports
              </Link>
            </>
          )
        }
      />

      {entries.length === 0 ? (
        <EmptyState title="No updates yet">Changes are posted here as they ship.</EmptyState>
      ) : (
        <>
          {/* The week at a glance, before the detail: a reader who has been
              away can tell from the numbers whether it is worth scrolling. */}
          {/* Resting, so `shadow-sm` like every other card — `shadow-lg` is
              the height of a menu floating over the page. No ghost sparkle
              behind the figures, and the eyebrow in sentence case like every
              other eyebrow in the app. */}
          <section
            aria-label="This week"
            className="hero-brand relative overflow-hidden rounded-2xl p-5 shadow-sm sm:p-6"
          >
            <p className="text-xs font-medium opacity-80">Past seven days</p>
            <dl className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-4 sm:gap-x-10">
              <HeroFigure value={week.new} label="added" />
              {!student && <HeroFigure value={week.fixed} label="fixed" />}
              <div className="min-w-0 sm:ml-auto">
                <dt className="text-xs opacity-80">Last update</dt>
                <dd className="text-title font-semibold">
                  {formatDate(new Date(`${entries[0].date}T00:00:00.000Z`))}
                </dd>
              </div>
            </dl>
          </section>

          {/* A timeline: the line is the passage of days, the dot is a day,
              and the newest one is lit. The dot punches a gap in the line with
              a ring in the page's own colour. */}
          <ol className="ml-1.5 space-y-4 border-l border-line pl-5 sm:ml-2 sm:pl-8">
            {entries.map((entry, i) => {
              const fresh = isUnseen(entry, user);
              return (
                <li
                  key={entry.date}
                  id={entry.date}
                  className="deal-in relative min-w-0 scroll-mt-20"
                  style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-2 -left-[1.6rem] h-3 w-3 rounded-full ring-4 ring-canvas sm:-left-[2.35rem]",
                      i === 0
                        ? "bg-brand ring-4 ring-brand/20"
                        : "bg-line"
                    )}
                  />
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-3">
                    {/* The section-title size every `Section` uses (17px);
                        at 20px these read as a level of their own. */}
                    <h2 className="flex items-baseline gap-2 text-title font-semibold tracking-[-0.01em] text-ink">
                      {formatDate(new Date(`${entry.date}T00:00:00.000Z`))}
                      <FreshChip fresh={fresh} />
                    </h2>
                    <p className="text-xs text-muted-fg tabular-nums">
                      {summary(entry)}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "space-y-4 rounded-xl bg-surface p-3 shadow-sm sm:p-4",
                      i === 0 && "ring-1 ring-brand/25"
                    )}
                  >
                    <Items kind="new" items={entry.new} />
                    <Items kind="fixed" items={entry.fixed} />
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

const DAY_MS = 86_400_000;

/** What shipped in the seven days up to now, across every entry. */
function pastWeek(entries: ChangelogEntry[], now = Date.now()) {
  const since = now - 7 * DAY_MS;
  let added = 0;
  let fixed = 0;
  for (const e of entries) {
    if (new Date(`${e.date}T00:00:00.000Z`).getTime() < since) continue;
    added += e.new.length;
    fixed += e.fixed.length;
  }
  return { new: added, fixed };
}

function summary(entry: ChangelogEntry): string {
  const parts: string[] = [];
  if (entry.new.length) parts.push(`${entry.new.length} new`);
  if (entry.fixed.length) parts.push(`${entry.fixed.length} fixed`);
  return parts.join(" · ");
}

/** New is brand blue and fixed is teal: two hues so a long day scans by kind. */
const KIND = {
  new: { chip: "bg-brand-soft text-brand", label: "New", Icon: SparklesIcon },
  fixed: { chip: "bg-tone-teal-soft text-tone-teal-ink", label: "Fixed", Icon: CheckIcon },
} as const;

function HeroFigure({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      {/* 42px, the app's one lead size. It was 44/52px bold — a second,
          bigger lead than any page's own. */}
      <dd className="order-1 text-lead font-semibold leading-none tracking-[-0.025em] tabular-nums">
        {value}
      </dd>
      <dt className="order-2 text-title font-medium opacity-90">{label}</dt>
    </div>
  );
}

function Items({ kind, items }: { kind: "new" | "fixed"; items: ChangelogEntry["new"] }) {
  if (items.length === 0) return null;
  const { chip, label, Icon } = KIND[kind];
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-fg">
        <span className={cn("grid h-5 w-5 place-items-center rounded-full", chip)}>
          <Icon className="h-3 w-3" />
        </span>
        {label}
        <span className="font-medium tabular-nums">{items.length}</span>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => {
          const { headline, detail } = splitItem(item);
          return (
            <li key={item} className="min-w-0 rounded-lg bg-canvas/60 px-3 py-2.5">
              {headline && <p className="text-body font-semibold text-ink">{headline}</p>}
              {detail && (
                <p
                  className={
                    headline
                      ? "mt-0.5 text-sm leading-snug text-muted-fg"
                      : "text-body text-ink"
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
