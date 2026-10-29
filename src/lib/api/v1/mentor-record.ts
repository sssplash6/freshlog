import "server-only";

import type { ApiMentorRecord, RecordPeriod } from "@/lib/api/v1/types";
import { nameOf, readerFor, SESSION_INCLUDE, toApiSession } from "@/lib/api/v1/sessions";
import { canManageMentor } from "@/lib/authz";
import { canActAsMentor, ROLES, USER_STATUS } from "@/lib/constants";
import type { SearchParams } from "@/lib/filters";
import { toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { mentorRecordView } from "@/lib/screens/mentor-record";
import { programToday } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

/**
 * The period as the page's tabs write it: `period=30d`, `period=all`, a typed
 * `from`–`to` (the Custom tab), or none for ninety days. The page's own
 * `mentorWindow` reads the rest of the params.
 */
export function recordPeriod(params: URLSearchParams): RecordPeriod {
  if (params.get("from") || params.get("to")) return "custom";
  const raw = params.get("period");
  return raw === "30d" || raw === "all" || raw === "custom" ? raw : "90d";
}

/** How many sessions the record lists, newest first, before All sessions. The page's `LOG_LIMIT`. */
const RECENT = 10;

/**
 * A mentor's record as /mentors/:id reads it (`mentorRecordView`, the page's
 * own read), or null for anybody who would get the page's card instead (a
 * student, a colleague) and for no such mentor alike.
 *
 * The page's gate, in its order: the mentor exists and can act as one, then
 * `isSelf || canManageMentor`. Every figure is narrowed to the reader's
 * programs, none for the mentor themselves. `query` is the page's own params:
 * `period`, `from`, `to`.
 */
export async function mentorRecordFor(viewer: User, id: string, query: SearchParams, now = new Date()): Promise<ApiMentorRecord | null> {
  const mentor = await prisma.user.findUnique({ where: { id } });
  if (!mentor || !canActAsMentor(mentor)) return null;
  const self = viewer.id === mentor.id;
  const manages = viewer.role !== ROLES.STUDENT && (await canManageMentor(viewer, mentor.id));
  if (!self && !manages) return null;

  const view = await mentorRecordView({ viewer, mentor, isSelf: self, edits: false, query, now });
  const students = [...view.students].sort((a, b) => (a.deadline?.getTime() ?? 0) - (b.deadline?.getTime() ?? 0));
  const reader = await readerFor(viewer);
  const recentIds = view.sessions.slice(0, RECENT).map((s) => s.id);
  const recentRows = recentIds.length > 0 ? await prisma.session.findMany({ where: { id: { in: recentIds } }, include: SESSION_INCLUDE }) : [];
  const byId = new Map(recentRows.map((row) => [row.id, row]));
  const program = (p: { id: string; name: string; colorIndex: number }) => ({ id: p.id, name: p.name, colorIndex: p.colorIndex });

  return {
    mentor: { id: mentor.id, name: nameOf(mentor), email: mentor.email },
    self,
    period: recordPeriod(new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])))),
    window: {
      label: view.win.label,
      from: view.win.from ? toDateInputValue(view.win.from) : null,
      to: view.win.to ? toDateInputValue(view.win.to) : null,
    },
    programs: view.pairings.map((a) => ({
      id: a.program.id,
      name: a.program.name,
      colorIndex: a.program.colorIndex,
      cohort: [a.level?.name, a.cohort?.name].filter(Boolean).join(" / ") || null,
      bookingLink: Boolean(a.calendlyUrl),
    })),
    time: { delivered: view.sum((r) => r.delivered), missed: view.sum((r) => r.missed), sessions: view.sum((r) => r.sessions) },
    // The page's program table: the ledger summed by program, whatever the window, and a row for each program the
    // header names with nothing in it yet.
    programTable: [
      ...view.ledger.map((row) => ({
        program: program(row),
        students: row.students,
        completed: row.completedAll,
        missed: row.missedAll,
        expired: row.forfeited,
        extra: row.extraAll,
        remaining: row.remaining,
        total: row.allocated,
      })),
      ...view.idle.map((row) => ({ program: program(row), students: 0, completed: 0, missed: 0, expired: 0, extra: 0, remaining: 0, total: 0, idle: true as const })),
    ],
    students: students.map((s) => ({
      student: { id: s.student.id, userId: s.student.user.id, name: nameOf(s.student.user) },
      program: program(s.program),
      completed: s.completed,
      missed: s.missed,
      remaining: s.remaining,
      forfeited: s.forfeited,
      allocated: s.allocated,
      useBy: s.deadline ? programToday(s.deadline) : null,
      pending: s.student.user.status === USER_STATUS.PENDING,
    })),
    recent: recentIds.flatMap((sid) => {
      const row = byId.get(sid);
      return row ? [toApiSession(reader, row, now)] : [];
    }),
    sessionCount: view.sessions.length,
    ratings:
      view.feedback._count > 0 && view.feedback._avg.rating != null ? { count: view.feedback._count, average: view.feedback._avg.rating } : null,
  };
}
