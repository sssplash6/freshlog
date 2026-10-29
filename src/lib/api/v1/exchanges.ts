import "server-only";

import type { ApiExchange } from "@/lib/api/v1/types";
import { scopeCovers, type AdminScope } from "@/lib/authz";
import { EXCHANGE_STATUS } from "@/lib/constants";
import type { ExchangeView } from "@/lib/exchanges";
import { toDateInputValue } from "@/lib/format";

const nameOf = (u: { name: string | null; email: string } | null | undefined) => (u ? (u.name ?? u.email) : null);

/**
 * Who may call an exchange off, as the student page asks it (`isParty` there,
 * the same three `assertExchangeParty` accepts): whoever sent them, and an
 * admin of either program.
 */
export function exchangeParty(e: Pick<ExchangeView, "sentById" | "fromProgramId" | "toProgramId">, userId: string, writeScope: AdminScope): boolean {
  return e.sentById === userId || scopeCovers(writeScope, e.fromProgramId) || scopeCovers(writeScope, e.toProgramId);
}

/**
 * One exchange as the website's exchange list draws it (`ExchangeList`): the
 * route, its cap and use-by day, Called off or Ran out, what the host has
 * allocated and on whom, what was completed, missed, remains, expired or went
 * out of plan, who sent it and why, and who called it off. `student` names them
 * where the list spans people (a program's), and is null on their own page.
 */
export function apiExchange(e: ExchangeView, opts: { canReturn: boolean; withStudent: boolean; now?: Date }): ApiExchange {
  const now = opts.now ?? new Date();
  const open = e.status === EXCHANGE_STATUS.OPEN;
  const f = e.figures;
  return {
    id: e.id,
    student: opts.withStudent ? { id: e.studentId, userId: e.student.userId, name: e.student.user.name ?? e.student.user.email } : null,
    from: e.fromProgram,
    to: e.toProgram,
    open,
    cap: f.cap,
    useBy: toDateInputValue(e.deadline),
    ranOut: open && e.deadline < now,
    allocated: f.allocated,
    unallocated: f.unallocated,
    holders: e.mentors.map((m) => nameOf(m.mentor) ?? "nobody yet"),
    // Completed excludes no-shows, the ledger's own definition, as the row's line says it.
    completed: f.used - f.missed,
    missed: f.missed,
    remaining: f.remaining,
    forfeited: f.forfeited,
    extra: f.extra,
    sentBy: nameOf(e.sentBy) ?? "Former user",
    note: e.note,
    returnedBy: open ? null : nameOf(e.returnedBy),
    returnNote: open ? null : e.returnNote,
    sessions: e.sessions.length,
    canReturn: open && opts.canReturn,
  };
}
