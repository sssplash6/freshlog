import { notFound } from "next/navigation";

import { CancelClassButton, MarkHeldButton, ScheduleClassForm } from "@/components/forms/class-forms";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { ArrowLink } from "@/components/ui/link";
import { PageTitle, Section } from "@/components/ui/section";
import { Table, Td, Tr, FILL_CELL, type Column } from "@/components/ui/table";
import { adminScope, scopeCovers } from "@/lib/authz";
import {
  CLASS_STATUS,
  monthKey,
  monthLabel,
  monthRange,
  monthTotals,
  reservedMinutes,
  shiftMonth,
} from "@/lib/class-schedule";
import { classProgramIds } from "@/lib/classes";
import { canActAsMentor } from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import { formatDuration, formatFullDate, toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { mentorCaseload } from "@/lib/queries";
import { programToday, programWallClock } from "@/lib/when";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Classes" };

const clock = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

const COLUMNS: Column[] = [
  { label: "Student" },
  { label: "Classes", align: "right" },
  { label: "Booked", align: "right" },
  { label: "Held", align: "right" },
  { label: "Month total", align: "right", emphasis: "key" },
];

/**
 * The class diary, and each student's hours by month.
 *
 * Only reachable for programs with `schedulesClasses` on — the SAT department's
 * feature. Everyone else gets a 404, the same answer as a page that is not
 * there, so the setting cannot be discovered from outside the department.
 *
 * A mentor reads and books their own classes; an admin of the program reads
 * every mentor's, and can cancel. The month total is booked + held, per
 * student, across whichever mentors taught them: the figure the page exists to
 * give. Cancelled classes are listed but never counted.
 */
export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireUser();
  const programIds = await classProgramIds(viewer);
  if (programIds.length === 0) notFound();

  const scope = await adminScope(viewer);
  const staffIds = programIds.filter((id) => scopeCovers(scope, id));
  const isMentor = canActAsMentor(viewer);

  const raw = (await searchParams).month;
  const wanted = typeof raw === "string" ? raw : "";
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
  const href = (m: string) => `/classes?month=${m}`;
  const nowWall = programWallClock(new Date());

  return (
    <div className="space-y-4">
      <PageTitle
        title="Classes"
        subtitle={
          isMentor && staffIds.length === 0
            ? "Book classes out of the hours your students hold with you."
            : "Every class booked in your programs, and each student's hours by month."
        }
      />

      {isMentor && (
        <Section title="Schedule a class" caption="Reserved out of the hours the student holds with you">
          {targets.length === 0 ? (
            <EmptyState framed={false} title="Nobody to book yet">
              No student holds unreserved time with you. An admin allocates it from the program page.
            </EmptyState>
          ) : (
            <ScheduleClassForm targets={targets} today={programToday()} />
          )}
        </Section>
      )}

      <Section
        title={monthLabel(month) ?? month}
        caption={`${formatDuration(grand)} booked or held across ${students.length} student${students.length === 1 ? "" : "s"}`}
        action={
          <span className="flex items-center gap-3 text-xs">
            <ArrowLink href={href(prev)}>{monthLabel(prev)}</ArrowLink>
            {month !== thisMonth && <ArrowLink href={href(thisMonth)}>This month</ArrowLink>}
            <ArrowLink href={href(next)}>{monthLabel(next)}</ArrowLink>
          </span>
        }
      >
        {students.length === 0 ? (
          <EmptyState framed={false} title="No classes this month">
            Classes you book for {monthLabel(month)} are totalled here, student by student.
          </EmptyState>
        ) : (
          <Table columns={COLUMNS} label={`Hours by student, ${monthLabel(month)}`} framed={false}>
            {students.map((t) => (
              <Tr key={t.studentId}>
                <Td tone="key" className={FILL_CELL}>
                  <span className="block min-w-0 truncate">{names.get(t.studentId)}</span>
                </Td>
                <Td align="right" label="Classes">{t.classes}</Td>
                <Td align="right" label="Booked">{formatDuration(t.scheduled)}</Td>
                <Td align="right" label="Held">{formatDuration(t.held)}</Td>
                <Td align="right" tone="key" label="Month total">{formatDuration(t.total)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Diary" count={rows.length > 0 ? rows.length : undefined}>
        {rows.length === 0 ? (
          <EmptyState framed={false} title="Empty month">Nothing is in the diary for {monthLabel(month)}.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((c) => {
              const mine = c.mentorId === viewer.id;
              const started = c.startsAt.getTime() <= nowWall.getTime();
              const day = formatFullDate(c.startsAt);
              const logHref = `/sessions/new?student=${c.studentId}&programId=${c.programId}&minutes=${c.minutes}&date=${toDateInputValue(c.startsAt)}`;
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <div className="text-body font-medium text-ink">
                      {c.student.user.name ?? c.student.user.email}
                      <span className="ml-2 text-xs font-normal text-muted-fg">
                        {c.status === CLASS_STATUS.HELD ? "Held" : c.status === CLASS_STATUS.CANCELLED ? "Cancelled" : "Booked"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-fg">
                      {day}, {clock(c.startsAt)} · {formatDuration(c.minutes)}
                      {!mine && ` · ${c.mentor.name ?? c.mentor.email}`}
                      {c.topic && ` · ${c.topic}`}
                    </div>
                  </div>
                  {c.status === CLASS_STATUS.SCHEDULED && (
                    <div className="flex flex-wrap items-center gap-3">
                      {mine && started && (
                        <>
                          <LinkButton href={logHref} variant="secondary" size="sm">Log session</LinkButton>
                          <MarkHeldButton classId={c.id} />
                        </>
                      )}
                      <CancelClassButton classId={c.id} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
