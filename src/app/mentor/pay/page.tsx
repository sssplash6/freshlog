import { EmptyState } from "@/components/ui/empty-state";
import { ExternalLink } from "@/components/ui/link";
import { PageTitle, READING_WIDTH, Section } from "@/components/ui/section";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { requireMentorAccess } from "@/lib/dal";
import { formatDuration, formatFullDate, toDateInputValue } from "@/lib/format";
import {
  formatCents,
  formatRate,
  monthLabel,
  monthOf,
  monthsPay,
  paidFrom,
  rateOn,
  rateSchedule,
} from "@/lib/pay";
import { mentorPay } from "@/lib/pay-data";
import { programToday } from "@/lib/when";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "My pay" };

/** Where a mentor files for pay. FreshWeek owns paying; Freshlog only counts. */
const FRESHWEEK_PAYROLL = "https://www.freshweek.org/payroll";

/**
 * A mentor's own rate and what their logged hours come to, month by month.
 *
 * Only ever their own: the gate is "can mentor", and the page reads the
 * signed-in person's id and nothing from the URL, so there is no address that
 * shows anybody else's pay. Read-only — a rate is set by a platform admin,
 * and a mentor who disagrees with it asks their department lead in FreshWeek.
 *
 * The figures are the ones FreshWeek's payroll is sent: same rows, same rules
 * (`lib/pay.ts`), so the amount here is the amount their request fills in with.
 */
export default async function MyPayPage() {
  const me = await requireMentorAccess();

  const { rates, payable } = await mentorPay(me.id);
  const todayText = programToday();
  const today = new Date(`${todayText}T00:00:00.000Z`);
  const from = paidFrom(rates);

  if (!from) {
    return (
      <div className={cn(READING_WIDTH, "space-y-4")}>
        <PageTitle title="My pay" />
        <EmptyState title="Not paid by the hour in Freshlog">
          No hourly rate is set for you. Ask your department lead in FreshWeek.
        </EmptyState>
      </div>
    );
  }

  const now = rateOn(rates, today);
  const schedule = rateSchedule(rates);
  const firstMonth = monthOf(toDateInputValue(from));
  // Empty while pay has not started yet.
  const months = monthsPay(payable, firstMonth, monthOf(todayText));
  const columns: Column[] = [
    { label: "Month" },
    { label: "Sessions", align: "right" },
    { label: "Hours", align: "right" },
    { label: "Amount", align: "right", emphasis: "key" },
  ];

  return (
    <div className={cn(READING_WIDTH, "space-y-4")}>
      <PageTitle
        title="My pay"
        subtitle={
          now
            ? `${formatRate(now.centsPerHour)} for every hour you log, since ${formatFullDate(now.effectiveFrom)}.`
            : `Your hourly pay starts on ${formatFullDate(from)}.`
        }
      />

      <p className="text-sm text-muted-fg">
        You file your pay request in FreshWeek, where these hours fill in by themselves.{" "}
        <ExternalLink href={FRESHWEEK_PAYROLL} variant="inline">
          Open FreshWeek payroll
        </ExternalLink>
      </p>

      <Section
        title="By month"
        eyebrow="Every active session from your first rate on, no-shows and extra time included."
      >
        {months.length === 0 ? (
          <EmptyState framed={false} title="No months yet">
            Your first paid month is {monthLabel(firstMonth)}.
          </EmptyState>
        ) : (
          <Table framed={false} columns={columns} label="Pay by month">
            {months.map((m) => (
              <Tr key={m.month}>
                <Td>{monthLabel(m.month)}</Td>
                <Td label="Sessions" align="right">{m.sessions}</Td>
                <Td label="Hours" align="right">{formatDuration(m.minutes)}</Td>
                <Td label="Amount" align="right" tone="key">{formatCents(m.cents)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>

      <Section
        title="Rate"
        count={schedule.length}
        eyebrow="Set by a platform admin. To change it, ask your department lead in FreshWeek."
      >
        <Table framed={false} columns={[{ label: "From" }, { label: "Per hour", align: "right" }]} label="Rate history">
          {[...schedule].reverse().map((r) => (
            <Tr key={r.id}>
              <Td>
                {formatFullDate(r.effectiveFrom)}
                {r.id === now?.id && <span className="text-muted-fg"> · current</span>}
                {r.effectiveFrom.getTime() > today.getTime() && <span className="text-muted-fg"> · upcoming</span>}
              </Td>
              <Td label="Per hour" align="right">{formatRate(r.centsPerHour)}</Td>
            </Tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}
