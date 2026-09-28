import Link from "next/link";
import { redirect } from "next/navigation";

import { OfferSlotForm, RemoveSlotButton } from "@/components/forms/interview-forms";
import { PersonCell } from "@/components/person-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { requireRole } from "@/lib/dal";
import { studiesIn } from "@/lib/enrollments";
import { toDateInputValue } from "@/lib/format";
import { templateName } from "@/lib/interview-templates";
import {
  MAX_DAYS_AHEAD,
  PHASE_STATUS,
  formatSlotDay,
  formatSlotSpan,
  formatSlotWhen,
  interviewPhase,
  sideOf,
} from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import { status, type ViewerContext } from "@/lib/status";
import { programToday, programWallClock } from "@/lib/when";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Practising interviews with classmates: the ones booked, the times this
 * student offers, and the classmates whose times they can book.
 *
 * A classmate is a student who shares one of this student's OWN programs —
 * never one they are only visiting — and is shown by name and program, never
 * by email: this is the one page where a student sees other students, and it
 * shows them what they need to pick a partner and nothing else.
 */
export default async function StudentInterviewsPage() {
  const user = await requireRole(ROLES.STUDENT);
  const now = new Date();
  const viewer: ViewerContext = { audience: "student", userId: user.id, now };

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      enrollments: { select: { programId: true, exchangeId: true } },
    },
  });
  // Not onboarded / not approved yet — the home page explains what's next.
  if (!profile || user.status !== USER_STATUS.ACTIVE) redirect("/student");

  const wallNow = programWallClock(now);
  const myPrograms = studiesIn(profile.enrollments).map((e) => e.programId);

  const [interviews, mySlots, classmates] = await Promise.all([
    prisma.peerInterview.findMany({
      where: { OR: [{ hostId: profile.id }, { guestId: profile.id }] },
      select: {
        id: true,
        hostId: true,
        guestId: true,
        template: true,
        completedAt: true,
        slot: { select: { startsAt: true, minutes: true } },
        host: { select: { user: { select: { id: true, name: true, avatarUpdatedAt: true } } } },
        guest: { select: { user: { select: { id: true, name: true, avatarUpdatedAt: true } } } },
      },
      orderBy: { slot: { startsAt: "asc" } },
    }),
    prisma.interviewSlot.findMany({
      where: { studentId: profile.id, startsAt: { gt: wallNow } },
      select: {
        id: true,
        startsAt: true,
        minutes: true,
        interview: {
          select: { id: true, guest: { select: { user: { select: { name: true } } } } },
        },
      },
      orderBy: { startsAt: "asc" },
    }),
    myPrograms.length === 0
      ? Promise.resolve([])
      : prisma.studentProfile.findMany({
          where: {
            id: { not: profile.id },
            user: { role: ROLES.STUDENT, status: USER_STATUS.ACTIVE, name: { not: null } },
            enrollments: { some: { programId: { in: myPrograms }, exchangeId: null } },
          },
          select: {
            id: true,
            user: { select: { id: true, name: true, avatarUpdatedAt: true } },
            enrollments: {
              where: { programId: { in: myPrograms }, exchangeId: null },
              select: { program: { select: { name: true } } },
            },
            interviewSlots: {
              where: { startsAt: { gt: wallNow }, interview: null },
              select: { id: true },
            },
          },
        }),
  ]);

  const open = interviews.filter((i) => !i.completedAt);
  const completed = interviews.filter((i) => i.completedAt).reverse();

  const named = classmates.filter((c) => c.user.name?.trim());
  const byName = (a: (typeof named)[number], b: (typeof named)[number]) =>
    (a.user.name ?? "").localeCompare(b.user.name ?? "");
  const offering = named.filter((c) => c.interviewSlots.length > 0).sort(byName);
  const quiet = named.filter((c) => c.interviewSlots.length === 0).sort(byName);

  const today = programToday(now);
  const tomorrow = toDateInputValue(new Date(wallNow.getTime() + DAY));
  const lastDay = toDateInputValue(new Date(wallNow.getTime() + MAX_DAYS_AHEAD * DAY));

  const row = (i: (typeof interviews)[number]) => {
    const side = sideOf(i, profile.id);
    const other = side === "host" ? i.guest.user : i.host.user;
    const chip = status(PHASE_STATUS[interviewPhase(i, now)], viewer);
    return (
      <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2 sm:px-5">
        <PersonCell
          person={{ ...other, email: "" }}
          href={`/student/interviews/${i.id}`}
          secondary={`${templateName(i.template)} · ${formatSlotWhen(i.slot.startsAt)}`}
          className="min-w-0 flex-1"
        />
        {chip && <StatusChip status={chip} className="shrink-0" />}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <PageTitle
        backHref="/student"
        backLabel="Home"
        title="Practice interviews"
        subtitle="Rehearse with classmates from your programs. Offer times, or book one of theirs."
      />

      <Section title="Your interviews" count={open.length || undefined}>
        {open.length === 0 ? (
          <EmptyState framed={false} title="Nothing booked">
            Book a classmate&apos;s time below, or offer your own.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">{open.map(row)}</ul>
        )}
        <Disclosure
          label="Completed"
          count={completed.length}
          className="border-t border-line px-4 sm:px-5"
        >
          <ul className="-mx-4 divide-y divide-line border-t border-line sm:-mx-5">
            {completed.map(row)}
          </ul>
        </Disclosure>
      </Section>

      <Section title="Your available times" count={mySlots.length || undefined}>
        <OfferSlotForm today={today} tomorrow={tomorrow} lastDay={lastDay} />
        {mySlots.length > 0 && (
          <ul className="divide-y divide-line border-t border-line">
            {mySlots.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 sm:px-5"
              >
                <span className="text-sm">
                  <span className="font-medium text-ink">{formatSlotDay(s.startsAt)}</span>{" "}
                  <span className="tabular-nums text-muted-fg">{formatSlotSpan(s, { zone: true })}</span>
                </span>
                {s.interview ? (
                  <Link
                    href={`/student/interviews/${s.interview.id}`}
                    className="text-sm font-medium text-brand hover:underline"
                  >
                    Booked by {s.interview.guest.user.name ?? "a classmate"}
                  </Link>
                ) : (
                  <RemoveSlotButton slotId={s.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Classmates" count={named.length || undefined}>
        {named.length === 0 ? (
          <EmptyState framed={false} variant="blocked" title="No classmates yet">
            Nobody else in your programs has signed in.
          </EmptyState>
        ) : (
          <>
            {offering.length === 0 ? (
              <EmptyState framed={false} title="No times offered">
                None of your classmates has offered a time yet.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {offering.map((c) => (
                  <ClassmateRow key={c.id} classmate={c} />
                ))}
              </ul>
            )}
            <Disclosure
              label="Classmates with no times offered"
              count={quiet.length}
              className="border-t border-line px-4 sm:px-5"
            >
              <ul className="-mx-4 divide-y divide-line border-t border-line sm:-mx-5">
                {quiet.map((c) => (
                  <ClassmateRow key={c.id} classmate={c} />
                ))}
              </ul>
            </Disclosure>
          </>
        )}
      </Section>
    </div>
  );
}

function ClassmateRow({
  classmate,
}: {
  classmate: {
    id: string;
    user: { id: string; name: string | null; avatarUpdatedAt: Date | null };
    enrollments: { program: { name: string } }[];
    interviewSlots: { id: string }[];
  };
}) {
  const open = classmate.interviewSlots.length;
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2 sm:px-5">
      <PersonCell
        person={{ ...classmate.user, email: "" }}
        href={`/student/interviews/people/${classmate.id}`}
        secondary={classmate.enrollments.map((e) => e.program.name).join(" · ")}
        className="min-w-0 flex-1"
      />
      {open > 0 && (
        <span className="shrink-0 text-sm tabular-nums text-muted-fg">
          {open} {open === 1 ? "time" : "times"} open
        </span>
      )}
    </li>
  );
}
