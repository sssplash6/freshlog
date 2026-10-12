import { ChevronRightIcon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/section";
import { cn } from "@/lib/cn";
import {
  hasUnseenChangelog,
  readChangelog,
  splitItem,
  type ChangelogEntry,
} from "@/lib/changelog";
import { inStudentLens } from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import { formatDate } from "@/lib/format";
import { profileOf } from "@/lib/profile";

import { MarkChangelogSeen } from "./seen";
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
  // A "51 fixed" figure in the hero tells a student the app was broken rather
  // than that it got better. The entries themselves are not tagged by who they
  // are for, so the whole log stays; only the hero changes.
  const student = inStudentLens(user, await profileOf(user));

  return (
    <div className="space-y-4">
      {hasUnseenChangelog(entries, user) && <MarkChangelogSeen />}

      <PageTitle title="What's new" />

      {entries.length === 0 ? (
        <EmptyState title="No updates yet" />
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
              <HeroFigure value={week.new} label="new" />
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
              const heading = (
                <>
                  <h2 className="text-title font-semibold tracking-[-0.01em] text-ink">
                    {formatDate(new Date(`${entry.date}T00:00:00.000Z`))}
                  </h2>
                  <p className="text-xs text-muted-fg tabular-nums">{summary(entry)}</p>
                </>
              );
              const body = (
                <div className="space-y-4 rounded-xl bg-surface p-3 shadow-sm sm:p-4">
                  <Items label="New" items={entry.new} />
                  <Items label="Fixed" items={entry.fixed} />
                </div>
              );
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
                      i === 0 ? "bg-brand" : "bg-line"
                    )}
                  />
                  {/* The three newest days are open; older ones fold to their
                      date and counts. The page was one 6,000-pixel scroll of
                      two-column cards (October 2026 audit), and nobody who
                      opens "What's new" is reading March. */}
                  {i < OPEN_DAYS ? (
                    <>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-3">
                        {heading}
                      </div>
                      {body}
                    </>
                  ) : (
                    <details className="group/day">
                      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 pb-3 [&::-webkit-details-marker]:hidden">
                        {heading}
                        <ChevronRightIcon className="h-4 w-4 shrink-0 self-center text-muted-fg transition-transform group-open/day:rotate-90" />
                      </summary>
                      {body}
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

/** How many of the newest days start open; the rest fold. */
const OPEN_DAYS = 3;

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

/** One kind of change for a day: a plain heading and plain rows. The day's
 *  counts are beside its date, so the heading does not repeat them. */
function Items({ label, items }: { label: string; items: ChangelogEntry["new"] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-muted-fg">{label}</h3>
      <ul className="space-y-2">
        {items.map((item) => {
          const { headline, detail } = splitItem(item);
          return (
            <li key={item} className="min-w-0">
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
