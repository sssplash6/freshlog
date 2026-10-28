import Link from "next/link";

import { OfferSlotForm, RemoveSlotButton } from "@/components/forms/interview-forms";
import { PersonCell } from "@/components/person-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";
import { mentorsOfStudent, studentsOfMentor } from "@/lib/interview-partners";
import type { InterviewViewer } from "@/lib/interview-viewer";
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
import { status } from "@/lib/status";
import { programToday, programWallClock } from "@/lib/when";

const DAY = 24 * 60 * 60 * 1000;

type Partner = {
  id: string;
  name: string | null;
  avatarUpdatedAt: Date | null;
  programs: string[];
  open: number;
};

/**
 * Practising interviews: the ones booked, the times this person offers, and
 * the people whose times they can book.
 *
 * As a student, those are their mentors (only the ones offering a time) and
 * every other approved student, in any program: practising with somebody from
 * another program is the point, not a leak. As a mentor, they are the students
 * the mentor has worked with. A student is shown by name and their own
 * programs — never a program they are only visiting — and never by email.
 *
 * The caller gates: `viewer.user` already acts in `viewer.as`.
 */
export async function InterviewsHome({ viewer }: { viewer: InterviewViewer }) {
  const { user, as, base, now } = viewer;
  const context = { audience: as, userId: user.id, now } as const;
  const wallNow = programWallClock(now);

  const [interviews, mySlots, partners, mentors] = await Promise.all([
    prisma.peerInterview.findMany({
      where: { OR: [{ hostId: user.id }, { guestId: user.id }] },
      select: {
        id: true,
        hostId: true,
        guestId: true,
        template: true,
        completedAt: true,
        absentId: true,
        slot: { select: { startsAt: true, minutes: true } },
        host: { select: { id: true, name: true, avatarUpdatedAt: true } },
        guest: { select: { id: true, name: true, avatarUpdatedAt: true } },
      },
      orderBy: { slot: { startsAt: "asc" } },
    }),
    prisma.interviewSlot.findMany({
      where: { userId: user.id, asMentor: as === "mentor", startsAt: { gt: wallNow } },
      select: {
        id: true,
        startsAt: true,
        minutes: true,
        interview: { select: { id: true, guest: { select: { name: true } } } },
      },
      orderBy: { startsAt: "asc" },
    }),
    as === "mentor" ? myStudents(user.id, wallNow) : classmates(user.id, wallNow),
    as === "student" ? mentorsOfStudent(user.id, wallNow) : Promise.resolve([]),
  ]);

  const open = interviews.filter((i) => !i.completedAt && !i.absentId);
  const completed = interviews.filter((i) => i.completedAt || i.absentId).reverse();

  const named = partners.filter((p) => p.name?.trim());
  const byName = (a: Partner, b: Partner) => (a.name ?? "").localeCompare(b.name ?? "");
  const offering = named.filter((p) => p.open > 0).sort(byName);
  const quiet = named.filter((p) => p.open === 0).sort(byName);
  const mentorsOffering: Partner[] = mentors
    .filter((m) => m.interviewSlots.length > 0)
    .map((m) => ({ ...m, programs: [], open: m.interviewSlots.length }));

  const today = programToday(now);
  const tomorrow = toDateInputValue(new Date(wallNow.getTime() + DAY));
  const lastDay = toDateInputValue(new Date(wallNow.getTime() + MAX_DAYS_AHEAD * DAY));

  const row = (i: (typeof interviews)[number]) => {
    const other = sideOf(i, user.id) === "host" ? i.guest : i.host;
    // "Booked" is the ordinary state of a row under "Coming up", and "Done" is
    // the heading of the list a finished one sits in: only an interview that
    // needs marking is flagged.
    const phase = interviewPhase(i, now);
    const chip =
      phase === "to-mark" || phase === "absent" ? status(PHASE_STATUS[phase], context) : null;
    return (
      <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <PersonCell
          person={{ ...other, email: "" }}
          href={`${base}/${i.id}`}
          secondary={`${templateName(i.template)} · ${formatSlotWhen(i.slot.startsAt)}`}
          className="min-w-0 flex-1"
        />
        {chip && <StatusChip status={chip} className="shrink-0" />}
      </li>
    );
  };

  const people = as === "mentor" ? "students" : "classmates";
  const Title = as === "mentor" ? "Your students" : "Classmates";

  // Most visits come to book somebody, so the page leads with who has a time
  // free. It used to open on an empty "Your interviews" card and an
  // always-open form for offering your own, and the classmates a student came
  // for sat below the fold.
  const partnersSection = (
    <Section title={Title} count={named.length || undefined}>
      {named.length === 0 ? (
        <EmptyState framed={false} variant="blocked" title={`No ${people} yet`} />
      ) : (
        <>
          {offering.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-fg sm:px-5">No times offered yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {offering.map((p) => (
                <PartnerRow key={p.id} partner={p} base={base} />
              ))}
            </ul>
          )}
          {quiet.length > 0 && (
            // Uncounted when nobody is offering: the line above has just
            // said how many there are.
            <Disclosure
              label={
                offering.length > 0
                  ? `${as === "mentor" ? "Students" : "Classmates"} with no times offered`
                  : `See your ${people}`
              }
              count={offering.length > 0 ? quiet.length : undefined}
              className="border-t border-line px-4 py-2 sm:px-5"
            >
              <ul className="-mx-4 divide-y divide-line border-t border-line sm:-mx-5">
                {quiet.map((p) => (
                  <PartnerRow key={p.id} partner={p} base={base} />
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
      <PageTitle
        title="Interviews"
        subtitle={
          as === "mentor"
            ? "Practise interviews with the students you work with."
            : undefined
        }
      />

      {open.length > 0 && (
        <Section title="Coming up" count={open.length}>
          <ul className="divide-y divide-line">{open.map(row)}</ul>
        </Section>
      )}

      {mentorsOffering.length > 0 && (
        <Section title="Your mentors" count={mentorsOffering.length}>
          <ul className="divide-y divide-line">
            {mentorsOffering.map((m) => (
              <PartnerRow key={m.id} partner={m} base={base} />
            ))}
          </ul>
        </Section>
      )}

      {partnersSection}

      <Section title="Your times" count={mySlots.length || undefined}>
        {/* Behind a button: offering a time is the less common half of the
            page, and the open form was the tallest thing on it. Open by
            default only while this person has nothing on offer and nobody
            else does either — then offering is the only thing to do here. */}
        <Disclosure
          label="Offer a time"
          variant="create"
          defaultOpen={mySlots.length === 0 && offering.length === 0}
          className="px-4 py-2 sm:px-5"
        >
          <div className="-mx-4 sm:-mx-5">
            <OfferSlotForm as={as} today={today} tomorrow={tomorrow} lastDay={lastDay} />
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
                    href={`${base}/${s.interview.id}`}
                    className="text-xs font-medium text-brand hover:text-brand-dark"
                  >
                    Booked by {s.interview.guest.name ?? "a classmate"}
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
        <Section title="Done" count={completed.length}>
          <ul className="divide-y divide-line">{completed.map(row)}</ul>
        </Section>
      )}
    </div>
  );
}

/** Every other approved student, with their own programs and open student times. */
async function classmates(userId: string, wallNow: Date): Promise<Partner[]> {
  const rows = await prisma.user.findMany({
    where: {
      id: { not: userId },
      role: ROLES.STUDENT,
      status: USER_STATUS.ACTIVE,
      name: { not: null },
    },
    select: {
      id: true,
      name: true,
      avatarUpdatedAt: true,
      studentProfile: {
        select: {
          enrollments: { where: { exchangeId: null }, select: { program: { select: { name: true } } } },
        },
      },
      interviewSlots: {
        where: { asMentor: false, startsAt: { gt: wallNow }, interview: null },
        select: { id: true },
      },
    },
  });
  return rows.map(partnerOf);
}

async function myStudents(mentorId: string, wallNow: Date): Promise<Partner[]> {
  return (await studentsOfMentor(mentorId, wallNow)).map(partnerOf);
}

function partnerOf(row: {
  id: string;
  name: string | null;
  avatarUpdatedAt: Date | null;
  studentProfile: { enrollments: { program: { name: string } }[] } | null;
  interviewSlots: unknown[];
}): Partner {
  return {
    id: row.id,
    name: row.name,
    avatarUpdatedAt: row.avatarUpdatedAt,
    programs: row.studentProfile?.enrollments.map((e) => e.program.name) ?? [],
    open: row.interviewSlots.length,
  };
}

/** Somebody to book, with their programs: the list runs across every program. */
function PartnerRow({ partner, base }: { partner: Partner; base: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
      <PersonCell
        person={{ ...partner, email: "" }}
        href={`${base}/people/${partner.id}`}
        secondary={partner.programs.join(" · ") || false}
        className="min-w-0 flex-1"
      />
      {partner.open > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-muted-fg">
          {partner.open} {partner.open === 1 ? "time" : "times"} open
        </span>
      )}
    </li>
  );
}
