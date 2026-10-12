import Link from "next/link";
import { redirect } from "next/navigation";

import { OfferSlotForm, RemoveSlotButton } from "@/components/forms/interview-forms";
import { PersonCell } from "@/components/person-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/cn";
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
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Interviews" };

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
        absentId: true,
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

  const open = interviews.filter((i) => !i.completedAt && !i.absentId);
  const completed = interviews.filter((i) => i.completedAt || i.absentId).reverse();

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
    // "Booked" is the ordinary state of a row under "Coming up", and
    // "Completed" is the heading of the list a finished one sits in: only an
    // interview that needs marking is flagged.
    const phase = interviewPhase(i, now);
    const chip =
      phase === "to-mark" || phase === "absent" ? status(PHASE_STATUS[phase], viewer) : null;
    return (
      <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
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

  // Most visits come to book somebody, so the page leads with who has a time
  // free. It used to open on an empty "Your interviews" card and an
  // always-open form for offering your own, and the classmates a student came
  // for sat below the fold.
  const classmatesSection = (
    <Section title="Classmates" count={named.length || undefined}>
      {named.length === 0 ? (
        <EmptyState framed={false} variant="blocked" title="No classmates yet" />
      ) : (
        <>
          {offering.length > 0 && (
            <ul className="divide-y divide-line">
              {offering.map((c) => (
                <ClassmateRow key={c.id} classmate={c} showProgram={myPrograms.length > 1} />
              ))}
            </ul>
          )}
          {quiet.length > 0 && (
            // Uncounted when nobody is offering: the heading has just said
            // how many classmates there are.
            <Disclosure
              label={offering.length > 0 ? "No times open" : "All classmates"}
              count={offering.length > 0 ? quiet.length : undefined}
              className={cn("px-4 py-2 sm:px-5", offering.length > 0 && "border-t border-line")}
            >
              <ul className="-mx-4 divide-y divide-line border-t border-line sm:-mx-5">
                {quiet.map((c) => (
                  <ClassmateRow key={c.id} classmate={c} showProgram={myPrograms.length > 1} />
                ))}
              </ul>
            </Disclosure>
          )}
        </>
      )}
    </Section>
  );

  return (
    <div className="space-y-4">
      {/* The tab's own name, and no back link: this is a tab, not a page
          under Home. */}
      <PageTitle title="Interviews" />

      {open.length > 0 && (
        <Section title="Coming up" count={open.length}>
          <ul className="divide-y divide-line">{open.map(row)}</ul>
        </Section>
      )}

      {classmatesSection}

      <Section title="Your times" count={mySlots.length || undefined}>
        {/* Behind a button: offering a time is the less common half of the
            page, and the open form was the tallest thing on it. Open by
            default only while the student has nothing on offer and nobody
            else does either — then offering is the only thing to do here. */}
        <Disclosure
          label="Offer a time"
          variant="create"
          defaultOpen={mySlots.length === 0 && offering.length === 0}
          className="px-4 py-2 sm:px-5"
        >
          <div className="-mx-4 sm:-mx-5">
            <OfferSlotForm today={today} tomorrow={tomorrow} lastDay={lastDay} />
          </div>
        </Disclosure>
        {mySlots.length > 0 && (
          <ul className="divide-y divide-line border-t border-line">
            {mySlots.map((s) => (
              <li
                key={s.id}
                className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 sm:px-5"
              >
                <span className="text-body">
                  <span className="font-medium text-ink">{formatSlotDay(s.startsAt)}</span>{" "}
                  <span className="tabular-nums text-muted-fg">{formatSlotSpan(s, { zone: true })}</span>
                </span>
                {s.interview ? (
                  <Link
                    href={`/student/interviews/${s.interview.id}`}
                    className="text-xs font-medium text-brand hover:text-brand-dark"
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

      {completed.length > 0 && (
        <Section title="Completed" count={completed.length}>
          <ul className="divide-y divide-line">{completed.map(row)}</ul>
        </Section>
      )}
    </div>
  );
}

function ClassmateRow({
  classmate,
  showProgram,
}: {
  /** Only when the student is in more than one program: otherwise it is their
      own program, repeated under every name down the list. */
  showProgram: boolean;
  classmate: {
    id: string;
    user: { id: string; name: string | null; avatarUpdatedAt: Date | null };
    enrollments: { program: { name: string } }[];
    interviewSlots: { id: string }[];
  };
}) {
  const open = classmate.interviewSlots.length;
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
      <PersonCell
        person={{ ...classmate.user, email: "" }}
        href={`/student/interviews/people/${classmate.id}`}
        secondary={
          showProgram ? classmate.enrollments.map((e) => e.program.name).join(" · ") : false
        }
        className="min-w-0 flex-1"
      />
      {open > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-muted-fg">
          {open} {open === 1 ? "time" : "times"} open
        </span>
      )}
    </li>
  );
}
