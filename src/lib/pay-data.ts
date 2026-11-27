import "server-only";

import { SESSION_STATUS } from "@/lib/constants";
import { paidFrom, payableSessions, type RateRow, type SessionForPay } from "@/lib/pay";
import type { PayableSession } from "@/lib/payroll-api/contract";
import { prisma } from "@/lib/prisma";

/**
 * A mentor's rates and payable sessions, read from the database.
 *
 * The pricing rules are `lib/pay.ts`'s; this only fetches what they need. The
 * payroll API, the admin's Mentor pay page and the mentor's own My pay page all
 * read through here, so the figure a mentor sees is the figure FreshWeek is
 * sent.
 *
 * NOT A GATE. Pay is confidential: every caller decides first who may see it.
 */

/** Every rate row of one mentor, in no particular order — `pay.ts` orders. */
export async function ratesOf(mentorId: string): Promise<RateRow[]> {
  return prisma.mentorPayRate.findMany({
    where: { mentorId },
    select: { id: true, centsPerHour: true, effectiveFrom: true, createdAt: true },
  });
}

/** The student as the contract names them: their name, or their email. */
function studentLabel(user: { name: string | null; email: string }): string {
  return user.name?.trim() || user.email;
}

/**
 * The sessions that could be payable for these rates. Narrowed in the query to
 * what the rules would keep anyway — ACTIVE, with minutes, from the first
 * rate's day — and filtered again by `payableSessions`, which is the rule.
 */
async function candidateSessions(
  mentorIds: string[],
  from: Date
): Promise<(SessionForPay & { mentorId: string })[]> {
  const rows = await prisma.session.findMany({
    where: {
      mentorId: { in: mentorIds },
      status: SESSION_STATUS.ACTIVE,
      minutes: { gt: 0 },
      date: { gte: from },
    },
    select: {
      id: true,
      mentorId: true,
      date: true,
      createdAt: true,
      minutes: true,
      status: true,
      attended: true,
      withinPlan: true,
      studentAnswer: true,
      student: { select: { user: { select: { name: true, email: true } } } },
      program: { select: { name: true } },
    },
  });
  return rows.map(({ student, program, ...s }) => ({
    ...s,
    student: studentLabel(student.user),
    program: program.name,
  }));
}

export type MentorPay = { rates: RateRow[]; payable: PayableSession[] };

/** One mentor's rates and every session they are paid for. */
export async function mentorPay(mentorId: string): Promise<MentorPay> {
  const rates = await ratesOf(mentorId);
  const from = paidFrom(rates);
  if (!from) return { rates, payable: [] };
  return { rates, payable: payableSessions(rates, await candidateSessions([mentorId], from)) };
}

/**
 * Every mentor who has a rate, each with their rates and payable sessions, in
 * two queries however many there are.
 */
export async function everyMentorPay(): Promise<
  Map<string, MentorPay & { mentor: { id: string; name: string | null; email: string } }>
> {
  const rows = await prisma.mentorPayRate.findMany({
    select: {
      id: true,
      centsPerHour: true,
      effectiveFrom: true,
      createdAt: true,
      mentor: { select: { id: true, name: true, email: true } },
    },
  });
  const byMentor = new Map<
    string,
    MentorPay & { mentor: { id: string; name: string | null; email: string } }
  >();
  for (const { mentor, ...rate } of rows) {
    const held = byMentor.get(mentor.id) ?? { mentor, rates: [], payable: [] };
    held.rates.push(rate);
    byMentor.set(mentor.id, held);
  }
  if (byMentor.size === 0) return byMentor;

  // One query from the earliest first rate; each mentor's own first rate is
  // then applied by `payableSessions`.
  const earliest = new Date(
    Math.min(...[...byMentor.values()].map((m) => paidFrom(m.rates)!.getTime()))
  );
  const sessions = await candidateSessions([...byMentor.keys()], earliest);
  const sessionsOf = new Map<string, SessionForPay[]>();
  for (const s of sessions) {
    const list = sessionsOf.get(s.mentorId) ?? [];
    list.push(s);
    sessionsOf.set(s.mentorId, list);
  }
  for (const [id, m] of byMentor) {
    m.payable = payableSessions(m.rates, sessionsOf.get(id) ?? []);
  }
  return byMentor;
}
