import "server-only";

import {
  partnerFeedbackSearch,
  readDateWindow,
  readParam,
  type SearchParams,
} from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type PartnerFilters = {
  kind?: "MENTOR" | "SESSION";
  mentorId?: string;
  session?: number;
  rating?: number;
  from?: Date;
  to?: Date;
  q?: string;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function readInt(raw: string, min: number, max: number): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= min && n <= max ? n : undefined;
}

/** `?kind=&mentor=&session=&rating=&q=&from=&to=` as filters; junk is dropped. */
export function readPartnerFilters(
  params: SearchParams,
  now: Date
): PartnerFilters {
  const kind = readParam(params, "kind");
  const mentor = readParam(params, "mentor");
  const q = readParam(params, "q");
  const window = readDateWindow(params, now);
  const session = readInt(readParam(params, "session"), 1, 999);
  const rating = readInt(readParam(params, "rating"), 1, 5);

  const f: PartnerFilters = {};
  if (kind === "MENTOR" || kind === "SESSION") f.kind = kind;
  if (mentor) f.mentorId = mentor;
  if (session !== undefined) f.session = session;
  if (rating !== undefined) f.rating = rating;
  if (window.from) f.from = window.from;
  if (window.to) f.to = window.to;
  if (q) f.q = q;
  return f;
}

/**
 * Always scoped to one partner. `q` is matched against the stored lowercase
 * email and the session name, through the same field list the search box's
 * placeholder is generated from (`partnerFeedbackSearch` in lib/filters.ts).
 */
export function partnerFeedbackWhere(
  partnerId: string,
  f: PartnerFilters
): Prisma.PartnerFeedbackWhereInput {
  const where: Prisma.PartnerFeedbackWhereInput = { partnerId };
  if (f.kind) where.kind = f.kind;
  if (f.mentorId) where.mentorId = f.mentorId;
  if (f.session !== undefined) where.sessionNumber = f.session;
  if (f.rating !== undefined) where.rating = f.rating;
  if (f.from || f.to) {
    where.createdAt = {
      ...(f.from ? { gte: f.from } : {}),
      ...(f.to ? { lte: f.to } : {}),
    };
  }
  const search = f.q ? partnerFeedbackSearch(f.q) : undefined;
  if (search) where.OR = search.OR;
  return where;
}

export async function partnerSummary(
  partnerId: string,
  f: PartnerFilters,
  now: Date = new Date()
): Promise<{
  total: number;
  average: number | null;
  lastWeek: number;
  byMentor: { mentorId: string; name: string; count: number; average: number }[];
  bySession: { sessionNumber: number; count: number; average: number }[];
}> {
  const where = partnerFeedbackWhere(partnerId, f);
  const [overall, lastWeek, mentors, sessions] = await Promise.all([
    prisma.partnerFeedback.aggregate({
      where,
      _count: { _all: true },
      _avg: { rating: true },
    }),
    prisma.partnerFeedback.count({
      where: {
        AND: [where, { createdAt: { gte: new Date(now.getTime() - WEEK_MS) } }],
      },
    }),
    prisma.partnerFeedback.groupBy({
      by: ["mentorId"],
      where: { AND: [where, { mentorId: { not: null } }] },
      _count: { _all: true },
      _avg: { rating: true },
    }),
    prisma.partnerFeedback.groupBy({
      by: ["sessionNumber"],
      where: { AND: [where, { sessionNumber: { not: null } }] },
      _count: { _all: true },
      _avg: { rating: true },
    }),
  ]);

  const users = await prisma.user.findMany({
    where: {
      id: { in: mentors.flatMap((m) => (m.mentorId ? [m.mentorId] : [])) },
    },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));

  const byMentor = mentors
    .flatMap((m) =>
      m.mentorId
        ? [
            {
              mentorId: m.mentorId,
              name: names.get(m.mentorId) ?? "Unknown mentor",
              count: m._count._all,
              average: m._avg.rating ?? 0,
            },
          ]
        : []
    )
    .sort((a, b) => a.average - b.average || b.count - a.count);

  const bySession = sessions
    .flatMap((s) =>
      s.sessionNumber !== null
        ? [
            {
              sessionNumber: s.sessionNumber,
              count: s._count._all,
              average: s._avg.rating ?? 0,
            },
          ]
        : []
    )
    .sort((a, b) => a.sessionNumber - b.sessionNumber);

  return {
    total: overall._count._all,
    average: overall._avg.rating,
    lastWeek,
    byMentor,
    bySession,
  };
}
