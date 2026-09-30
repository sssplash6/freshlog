import "server-only";

import { adminScope, scopeProgramFilter } from "@/lib/authz";
import {
  CHARGED_SESSION,
  EXCHANGE_STATUS,
  SESSION_STATUS,
  canActAsMentor,
} from "@/lib/constants";
import { deadlinePassed } from "@/lib/deadlines";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { User } from "@/generated/prisma/client";

/**
 * A student one program lends to another, and the hours that come with them.
 *
 * The rule the rest of the app has to hold on to is that an exchange creates no
 * ledger of its own. The allocations and the sessions live in the HOST program,
 * where the work happens, keyed the way every other row is keyed — one program,
 * one mentor, one student. What the exchange adds is a CAP and a pair of names,
 * and `exchangeId` on those rows is what lets the sending program read exactly
 * them.
 *
 * So there is nothing here that sums hours a second time. `used` below is the
 * same `chargesAllocation` rule the hours engine applies, asked of a smaller set
 * of sessions; a figure on this page and a figure on the host program's page are
 * the same minutes counted once, seen from two sides.
 */

/** The least an allocation has to carry to be counted against a cap. */
type CountableAllocation = {
  mentorId: string | null;
  minutes: number;
  /** The grant's own use-by — expiry forfeits what is left on it. */
  deadline: Date;
};

/** The least a session has to carry to be drawn down from one. */
type CountableSession = {
  mentorId: string;
  minutes: number;
  attended: boolean;
  status: string;
  withinPlan: boolean;
};

export type ExchangeFigures = {
  /** What the sender promised. The host may allocate this much and no more. */
  cap: number;
  /** What the host has put on its mentors — at most the cap. */
  allocated: number;
  /** Promised and still on nobody. This is the host admin's job. */
  unallocated: number;
  /** Minutes drawn down: delivered and no-show alike, in plan. */
  used: number;
  /** The no-show subset of `used`. */
  missed: number;
  /** Logged out of plan: real work, charged to nothing, outside every total. */
  extra: number;
  /** Unused minutes lost to a passed deadline — the same rule `allocationSummary` applies. */
  forfeited: number;
  /**
   * Allocated and not yet spent — and not yet lost. Expired grants write this
   * down to their overdraw, so a placement that ran out never claims the
   * minutes it is no longer holding are still spendable. Negative is an
   * overdraw, as everywhere.
   */
  remaining: number;
};

/**
 * The figures, from the rows. Pure, so both ends read the same arithmetic
 * and a test can state it without a database.
 *
 * `now` arrives rather than being read from the clock — the same rule
 * `ViewerContext` holds everywhere else, so a page's figures cannot disagree
 * with each other about what today is.
 */
export function exchangeFigures(
  cap: number,
  allocations: readonly CountableAllocation[],
  sessions: readonly CountableSession[],
  now: number = Date.now()
): ExchangeFigures {
  const allocated = allocations.reduce((sum, a) => sum + a.minutes, 0);
  const charged = sessions.filter(
    (s) => s.status === CHARGED_SESSION.status && s.withinPlan
  );
  const used = charged.reduce((sum, s) => sum + s.minutes, 0);
  const missed = charged
    .filter((s) => !s.attended)
    .reduce((sum, s) => sum + s.minutes, 0);
  const extra = sessions
    .filter((s) => s.status === SESSION_STATUS.ACTIVE && !s.withinPlan)
    .reduce((sum, s) => sum + s.minutes, 0);

  // Forfeiture is per grant, against ITS deadline — an allocation is unique
  // per (student, program, mentor), so each row's unused minutes lapse on
  // their own date, exactly as `allocationSummary` computes it.
  const usedByMentor = new Map<string, number>();
  for (const s of charged) {
    usedByMentor.set(s.mentorId, (usedByMentor.get(s.mentorId) ?? 0) + s.minutes);
  }
  let forfeited = 0;
  for (const a of allocations) {
    if (!deadlinePassed(a.deadline, now)) continue;
    const spentByMentor = a.mentorId ? (usedByMentor.get(a.mentorId) ?? 0) : 0;
    forfeited += Math.max(0, a.minutes - spentByMentor);
  }

  return {
    cap,
    allocated,
    // Never negative: the actions refuse to allocate past the cap, and a cap
    // lowered afterwards would otherwise read as time waiting to be given out.
    unallocated: Math.max(0, cap - allocated),
    used,
    missed,
    extra,
    forfeited,
    remaining: allocated - used - forfeited,
  };
}

/** Everything an exchange is, to whichever end is reading it. */
export type ExchangeView = Awaited<ReturnType<typeof loadExchanges>>[number];

const EXCHANGE_INCLUDE = {
  student: { include: { user: true } },
  fromProgram: { select: { id: true, name: true } },
  toProgram: { select: { id: true, name: true } },
  sentBy: true,
  returnedBy: true,
  allocations: { include: { mentor: true } },
  sessions: {
    include: {
      mentor: true,
      program: true,
      assignment: { select: { id: true, purpose: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  },
} satisfies Prisma.ProgramExchangeInclude;

/**
 * Exchanges matching a `where`, each with its figures and its log.
 *
 * One loader, used by both ends and by the attention list, because "how much of
 * this is left" must not have two implementations that disagree — the reason
 * `allocationSummary` is also one function serving five pages.
 */
async function loadExchanges(where: Prisma.ProgramExchangeWhereInput) {
  const rows = await prisma.programExchange.findMany({
    where,
    include: EXCHANGE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  const now = Date.now();
  return rows.map((e) => {
    const figures = exchangeFigures(e.minutes, e.allocations, e.sessions, now);
    // Who in the host program holds the time, and what each of them has spent.
    // The host's own page reads this off `allocationSummary`; the SENDING
    // program cannot, because that would mean asking about a student inside a
    // program it does not administer, so the same breakdown is assembled here
    // out of the rows this exchange owns.
    const byMentor = new Map<
      string,
      {
        mentor: (typeof e.allocations)[number]["mentor"];
        allocated: number;
        used: number;
      }
    >();
    for (const a of e.allocations) {
      const key = a.mentorId ?? "";
      const held = byMentor.get(key);
      if (held) held.allocated += a.minutes;
      else byMentor.set(key, { mentor: a.mentor, allocated: a.minutes, used: 0 });
    }
    for (const s of e.sessions) {
      if (s.status !== SESSION_STATUS.ACTIVE || !s.withinPlan) continue;
      const held = byMentor.get(s.mentorId);
      if (held) held.used += s.minutes;
      // A host mentor who logged without holding a grant of their own is real
      // — a mentor in a program may log with anybody in it — so they get a row
      // of their own rather than being dropped out of the breakdown.
      else byMentor.set(s.mentorId, { mentor: s.mentor, allocated: 0, used: s.minutes });
    }

    return {
      ...e,
      figures,
      mentors: [...byMentor.values()].sort(
        (a, b) =>
          (a.mentor?.name ?? a.mentor?.email ?? "").localeCompare(
            b.mentor?.name ?? b.mentor?.email ?? ""
          )
      ),
    };
  });
}

/**
 * The exchanges one reader may see for one student, both directions.
 *
 * Three ways in, and each is a program somebody already administers or works
 * in:
 *
 *   host   an admin of the program the student was sent TO, or a mentor who
 *          works there. They are the ones who allocate and deliver it.
 *   home   an admin of the program that sent them. This is the whole point of
 *          the feature — the sending program watches the hours it promised —
 *          and it is the ONE place a program reads rows that belong to another
 *          program's ledger. It reaches exactly this exchange's rows.
 *   sender the mentor who sent them, wherever they now work.
 *
 * It is deliberately not "any mentor who reaches the student": a mentor in a
 * third program has nothing to do with a placement between the other two.
 */
export async function visibleExchanges(
  user: User,
  profile: { id: string }
): Promise<ExchangeView[]> {
  const programIds = scopeProgramFilter(await adminScope(user));
  const paired = canActAsMentor(user)
    ? await prisma.mentorAssignment.findMany({
        where: { mentorId: user.id },
        select: { programId: true },
      })
    : [];
  // A platform admin's scope is every program, which `undefined` says. Adding
  // the pairings to it would narrow nothing and cost a second branch.
  const reach = programIds
    ? [...new Set([...programIds, ...paired.map((p) => p.programId)])]
    : undefined;

  return loadExchanges({
    studentId: profile.id,
    ...(reach
      ? {
          OR: [
            { fromProgramId: { in: reach } },
            { toProgramId: { in: reach } },
            { sentById: user.id },
          ],
        }
      : {}),
  });
}

/** One program's exchanges: who it took in, and who it lent out. */
export async function programExchanges(programId: string): Promise<{
  hosted: ExchangeView[];
  sent: ExchangeView[];
}> {
  const rows = await loadExchanges({
    status: EXCHANGE_STATUS.OPEN,
    OR: [{ toProgramId: programId }, { fromProgramId: programId }],
  });
  return {
    hosted: rows.filter((e) => e.toProgramId === programId),
    sent: rows.filter((e) => e.fromProgramId === programId),
  };
}

/**
 * Open exchanges whose hours nobody holds yet — the host admin's job, and the
 * sender's news.
 *
 * `programIds` undefined is a platform admin: every program, the same
 * convention `FilterScope.programIds` uses everywhere else.
 */
export async function unallocatedExchanges(opts: {
  /** Hosted by one of these programs. */
  hostedBy?: readonly string[];
  /** Or sent by this person, whichever program took them. */
  sentBy?: string;
}): Promise<ExchangeView[]> {
  const rows = await loadExchanges({
    status: EXCHANGE_STATUS.OPEN,
    ...(opts.sentBy ? { sentById: opts.sentBy } : {}),
    ...(opts.hostedBy ? { toProgramId: { in: [...opts.hostedBy] } } : {}),
  });
  return rows.filter((e) => e.figures.unallocated > 0);
}

/**
 * Minutes already allocated under an exchange, optionally ignoring one row —
 * the allocation being edited, whose old total must not be counted against its
 * own new one.
 *
 * Takes a client so the cap can be re-read INSIDE the transaction that writes:
 * two admins allocating at once would otherwise both pass a check made before
 * either wrote.
 */
export async function allocatedUnder(
  db: {
    hourAllocation: {
      aggregate: (args: {
        where: { exchangeId: string; id?: { not: string } };
        _sum: { minutes: true };
      }) => Promise<{ _sum: { minutes: number | null } }>;
    };
  },
  exchangeId: string,
  exceptAllocationId?: string
): Promise<number> {
  const sum = await db.hourAllocation.aggregate({
    where: {
      exchangeId,
      ...(exceptAllocationId ? { id: { not: exceptAllocationId } } : {}),
    },
    _sum: { minutes: true },
  });
  return sum._sum.minutes ?? 0;
}

/**
 * The cap, refused from inside a transaction.
 *
 * A thrown error rather than a returned refusal because it happens after the
 * write has begun: the only correct thing to do with a grant that would spend
 * hours nobody promised is to unwind the whole transaction, and the only way
 * out of a Prisma transaction callback is to throw. `setMentorAllocation`
 * catches it and answers the admin in the same sentence its pre-check uses.
 */
export class ExchangeCapExceeded extends Error {
  constructor(
    readonly spare: number,
    readonly cap: number
  ) {
    super(`Exchange cap of ${cap} minutes would be exceeded.`);
    this.name = "ExchangeCapExceeded";
  }
}

/** Has anything been logged under this exchange? Returning is refused if so. */
export async function exchangeHasSessions(exchangeId: string): Promise<boolean> {
  const logged = await prisma.session.findFirst({
    where: { exchangeId },
    select: { id: true },
  });
  return logged !== null;
}

/**
 * The open exchange, if any, on which this program has lent this student out.
 *
 * Only a student's own programs lend, so the sending program is the one thing
 * an open placement cannot outlive: move the student out of it, or unenroll
 * them, and the host is left with a visitor whose sender no longer has them —
 * a cap nobody holds and a return that goes nowhere. Both actions ask this
 * first and refuse until the exchange is returned.
 */
export async function openExchangeFrom(studentId: string, programId: string) {
  return prisma.programExchange.findFirst({
    where: { studentId, fromProgramId: programId, status: EXCHANGE_STATUS.OPEN },
    include: { toProgram: { select: { name: true } } },
  });
}
