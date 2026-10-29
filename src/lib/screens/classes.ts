import { adminScope, scopeCovers } from "@/lib/authz";
import { CLASS_STATUS, monthKey, monthRange, monthTotals, reservedMinutes, shiftMonth } from "@/lib/class-schedule";
import { classProgramIds } from "@/lib/classes";
import { canActAsMentor } from "@/lib/constants";
import { formatDuration } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { mentorCaseload } from "@/lib/queries";
import { programWallClock } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

/*
 * The Classes page's data, moved unchanged from src/app/classes/page.tsx so the
 * API's Classes reads what the page shows: the programs that schedule classes
 * the reader works in, the month asked for, its diary, each student's hours,
 * and whom a mentor may book a class for. Null where the page is a 404.
 */
export async function classesView(viewer: User, wanted: string) {
  const programIds = await classProgramIds(viewer);
  if (programIds.length === 0) return null;

  const scope = await adminScope(viewer);
  const staffIds = programIds.filter((id) => scopeCovers(scope, id));
  const isMentor = canActAsMentor(viewer);

  const thisMonth = monthKey(programWallClock(new Date()));
  const month = monthRange(wanted) ? wanted : thisMonth;
  const range = monthRange(month)!;

  const rows = await prisma.scheduledClass.findMany({
    where: {
      startsAt: { gte: range.start, lt: range.end },
      OR: [
        { programId: { in: staffIds } },
        ...(isMentor ? [{ mentorId: viewer.id, programId: { in: programIds } }] : []),
      ],
    },
    include: {
      student: { include: { user: { select: { name: true, email: true } } } },
      mentor: { select: { id: true, name: true, email: true } },
      program: { select: { name: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  const totals = monthTotals(rows, range);
  const names = new Map(rows.map((r) => [r.studentId, r.student.user.name ?? r.student.user.email]));
  const students = [...totals.values()].sort((a, b) => b.total - a.total);
  const grand = students.reduce((sum, t) => sum + t.total, 0);

  // The picker: students this mentor holds live time with, in a program that
  // schedules, less whatever their booked classes already reserve.
  let targets: { value: string; label: string; hint: string }[] = [];
  if (isMentor) {
    const [caseload, booked] = await Promise.all([
      mentorCaseload(viewer.id),
      prisma.scheduledClass.findMany({
        where: { mentorId: viewer.id, status: CLASS_STATUS.SCHEDULED, programId: { in: programIds } },
        select: { studentId: true, programId: true, minutes: true, status: true },
      }),
    ]);
    const open = new Set(programIds);
    targets = caseload.students
      .filter((s) => open.has(s.program.id) && !s.expired && s.reach === "allocation")
      .map((s) => {
        const reserved = reservedMinutes(
          booked.filter((b) => b.studentId === s.profile.id && b.programId === s.program.id)
        );
        return { s, free: s.remaining - reserved };
      })
      .filter(({ free }) => free > 0)
      .map(({ s, free }) => ({
        value: `${s.profile.id}|${s.program.id}`,
        label: s.profile.user.name ?? s.profile.user.email,
        hint: `${s.program.name} · ${formatDuration(free)} unreserved`,
      }));
  }

  const prev = shiftMonth(month, -1)!;
  const next = shiftMonth(month, 1)!;

  const nowWall = programWallClock(new Date());
  return { programIds, staffIds, isMentor, thisMonth, month, range, rows, totals, names, students, grand, targets, prev, next, nowWall };
}

export type ClassesView = NonNullable<Awaited<ReturnType<typeof classesView>>>;
