import { PayRateForm } from "@/components/forms/pay-rate-form";
import { PersonCell } from "@/components/person-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import { canActAsMentor, ROLES, USER_STATUS } from "@/lib/constants";
import { requirePlatformAdmin } from "@/lib/dal";
import { formatDate, formatDuration } from "@/lib/format";
import {
  formatCents,
  formatRate,
  monthLabel,
  monthPay,
  rateDayBounds,
  rateOn,
  rateSchedule,
  shiftMonth,
  type MonthPay,
  type RateRow,
} from "@/lib/pay";
import { everyMentorPay } from "@/lib/pay-data";
import { prisma } from "@/lib/prisma";
import { programToday } from "@/lib/when";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Mentor pay" };

/**
 * What each mentor is paid per logged hour, and what that comes to.
 *
 * Platform admins only, and nobody else sees a rate anywhere in the app but
 * the mentor it belongs to (`/mentor/pay`). Freshlog sets rates and counts
 * hours; FreshWeek's payroll reads both through /api/payroll/v1 and is where
 * a mentor files for pay and is paid. So the figures here are what is owed by
 * the hours, not what has been paid.
 */

/** A month's hours and amount, in one cell. */
function MonthCell({ pay }: { pay: MonthPay | null }) {
  if (!pay) return <span className="text-muted-fg">—</span>;
  return (
    <span className="tabular-nums">
      {formatDuration(pay.minutes)}
      <span className="text-muted-fg"> · {formatCents(pay.cents)}</span>
    </span>
  );
}

/** Today's rate and since when, with the next one if it is already set. */
function RateCell({ rates, today }: { rates: RateRow[]; today: Date }) {
  if (rates.length === 0) return <span className="text-muted-fg">Not paid by the hour</span>;
  const now = rateOn(rates, today);
  const next = rateSchedule(rates).find((r) => r.effectiveFrom.getTime() > today.getTime());
  return (
    <span className="flex flex-col">
      {now ? (
        <span>
          <span className="font-semibold">{formatRate(now.centsPerHour)}</span>
          <span className="text-muted-fg"> since {formatDate(now.effectiveFrom)}</span>
        </span>
      ) : (
        <span className="text-muted-fg">No rate yet</span>
      )}
      {next && (
        <span className="text-xs text-muted-fg">
          {formatRate(next.centsPerHour)} from {formatDate(next.effectiveFrom)}
        </span>
      )}
    </span>
  );
}

export default async function MentorPayPage() {
  await requirePlatformAdmin();

  const todayText = programToday();
  const today = new Date(`${todayText}T00:00:00.000Z`);
  const thisMonth = todayText.slice(0, 7);
  const lastMonth = shiftMonth(thisMonth, -1);

  const [people, history, pay] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [{ isMentor: true }, { role: ROLES.MENTOR }, { payRates: { some: {} } }] },
      select: { id: true, name: true, email: true, role: true, isMentor: true, status: true, avatarUpdatedAt: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
    }),
    prisma.mentorPayRate.findMany({
      include: {
        mentor: { select: { id: true, name: true, email: true } },
        createdBy: { select: { name: true, email: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    everyMentorPay(),
  ]);

  // Whoever can mentor now, plus anybody who was ever given a rate: somebody
  // who left this month may still be owed for it.
  const roster = people.filter((p) => canActAsMentor(p) || pay.has(p.id));
  const pickable = roster.filter((p) => canActAsMentor(p) && p.status !== USER_STATUS.ARCHIVED);

  // A row that lost its day to a newer one never priced anything.
  const inForce = new Set<string>();
  for (const m of pay.values()) for (const r of rateSchedule(m.rates)) inForce.add(r.id);

  const { min, max } = rateDayBounds();
  const columns: Column[] = [
    { label: "Mentor" },
    { label: "Rate" },
    { label: monthLabel(thisMonth), align: "right" },
    { label: monthLabel(lastMonth), align: "right" },
  ];
  const historyColumns: Column[] = [
    { label: "Mentor" },
    { label: "Rate" },
    { label: "From" },
    { label: "Set by" },
  ];

  return (
    <div className="space-y-4">
      <PageTitle
        backHref="/settings/platform"
        backLabel="Platform"
        title="Mentor pay"
        subtitle="What each mentor is paid per logged hour. FreshWeek's payroll reads these hours and rates; mentors file for pay and are paid there."
      />

      <Section
        title="Set a rate"
        eyebrow="Only platform admins see rates; each mentor sees their own."
      >
        <PayRateForm
          mentors={pickable.map((p) => ({ value: p.id, label: p.name ?? p.email, hint: p.email }))}
          min={min}
          max={max}
          today={todayText}
        />
      </Section>

      <Section
        title="Mentors"
        count={roster.length}
        eyebrow="Payable hours: every active session from the first rate on, no-shows and extra time included."
      >
        {roster.length === 0 ? (
          <EmptyState framed={false} title="No mentors">
            Register a mentor first.
          </EmptyState>
        ) : (
          <Table framed={false} columns={columns} label="Mentors">
            {roster.map((p) => {
              const mine = pay.get(p.id);
              return (
                <Tr key={p.id}>
                  <Td>
                    <PersonCell person={p} href={`/mentors/${p.id}`} />
                  </Td>
                  <Td label="Rate">
                    <RateCell rates={mine?.rates ?? []} today={today} />
                  </Td>
                  <Td label={monthLabel(thisMonth)} align="right">
                    <MonthCell pay={mine ? monthPay(mine.payable, thisMonth) : null} />
                  </Td>
                  <Td label={monthLabel(lastMonth)} align="right">
                    <MonthCell pay={mine ? monthPay(mine.payable, lastMonth) : null} />
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Section>

      <Section
        title="Rate history"
        count={history.length}
        eyebrow="Rates are only ever added. A rate set again for the same day replaces the earlier one."
      >
        {history.length === 0 ? (
          <EmptyState framed={false} title="No rates set">
            Set a mentor&apos;s first rate above.
          </EmptyState>
        ) : (
          <Table framed={false} columns={historyColumns} label="Rate history">
            {history.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <PersonCell person={r.mentor} secondary={false} />
                </Td>
                <Td label="Rate">
                  <span className={inForce.has(r.id) ? "font-semibold" : "text-muted-fg line-through"}>
                    {formatRate(r.centsPerHour)}
                  </span>
                  {!inForce.has(r.id) && <span className="text-xs text-muted-fg"> replaced</span>}
                </Td>
                <Td label="From">{formatDate(r.effectiveFrom)}</Td>
                <Td label="Set by" tone="muted">
                  {r.createdBy.name ?? r.createdBy.email} · {formatDate(r.createdAt)}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
