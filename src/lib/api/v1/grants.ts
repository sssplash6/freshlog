import "server-only";

import type { ManagedStudent } from "@/lib/api/v1/admin-student";
import { nameOf, type Reader } from "@/lib/api/v1/sessions";
import type { GrantOptions } from "@/lib/api/v1/types";
import { scopeCovers, scopeProgramFilter, staffLevel } from "@/lib/authz";
import { ASSIGNMENT_PROGRESS } from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";
import { bankRemaining, pastHours } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { studentLedger } from "@/lib/queries";
import { programToday } from "@/lib/when";

/**
 * What the grant sheet offers, read as the website's `/students/[id]/allocate`
 * reads it for its form: the student's programs the reader may change, each
 * with what a grant there asks for, the mentors of those programs, and the
 * open plan items a grant's hours may be for.
 *
 * The write scope throughout, never the read: a program a Leader grant reads
 * must not be offered as somewhere to grant.
 */
export async function grantOptionsFor(reader: Reader, profile: ManagedStudent, now: Date = new Date()): Promise<GrantOptions> {
  const enrollments = profile.enrollments.filter((e) => scopeCovers(reader.write, e.programId));
  const visible = enrollments.map((e) => e.programId);
  const programIds = scopeProgramFilter(reader.write);

  const [mentors, ledger, banks] = await Promise.all([
    prisma.user.findMany({
      where: {
        OR: [{ role: "MENTOR" }, { isMentor: true }],
        ...(programIds ? { mentorAssignments: { some: { programId: { in: [...programIds] } } } } : {}),
      },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, email: true, mentorAssignments: { select: { programId: true } } },
    }),
    studentLedger(profile.id, visible),
    prisma.hourAllocation.findMany({ where: { studentId: profile.id, isBank: true, programId: { in: visible } } }),
  ]);

  const programs = await Promise.all(
    enrollments.map(async (e) => {
      const p = e.program;
      const bankRow = banks.find((b) => b.programId === p.id);
      // A bank is changed by the program's admins only; the write scope says so today, and `staffLevel` is the action's own question.
      const bankAllowed = p.hourBank && (await staffLevel(reader.user, p.id)) === "ADMIN";
      const past = bankAllowed && !bankRow ? await pastHours(prisma, profile.id, p.id) : null;
      // The level's pair where it has one, else the program's: what joining gives.
      const minutes = e.level?.standardMinutes ?? p.standardMinutes;
      const days = e.level?.standardDays ?? p.standardDays;
      return {
        id: p.id,
        name: p.name,
        colorIndex: p.colorIndex,
        // A bank program asks for no payment: its hours are one balance.
        tracksPayment: p.tracksPayment && !p.hourBank,
        bankAllowed,
        bank: bankRow ? { left: await bankRemaining(prisma, bankRow), deadline: toDateInputValue(bankRow.deadline) } : null,
        askPast: !!past && (past.allocated > 0 || past.logged > 0),
        standard: minutes != null && days != null ? { minutes, days } : null,
      };
    })
  );

  return {
    programs,
    mentors: mentors.map((m) => ({
      mentor: { id: m.id, name: nameOf(m) },
      programIds: [...new Set(m.mentorAssignments.map((a) => a.programId).filter((id) => scopeCovers(reader.write, id)))],
    })),
    openPlan: ledger.assignments
      .filter((a) => a.progress !== ASSIGNMENT_PROGRESS.DONE)
      .map((a) => ({ id: a.id, programId: a.programId, mentorId: a.mentorId, purpose: a.purpose, logged: a.loggedMinutes, limit: a.minuteLimit })),
    today: programToday(now),
  };
}
