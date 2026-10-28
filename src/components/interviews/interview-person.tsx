import { notFound, redirect } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { BookInterviewForm } from "@/components/forms/interview-forms";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { studiesIn } from "@/lib/enrollments";
import { mayBook } from "@/lib/interview-partners";
import type { InterviewViewer } from "@/lib/interview-viewer";
import { INTERVIEW_TEMPLATES } from "@/lib/interview-templates";
import { formatSlotDay, formatSlotSpan } from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import { programWallClock } from "@/lib/when";

/**
 * Somebody to practise with, as the reader sees them: their name, their own
 * programs, and the times they offer that the reader may book — a classmate's
 * student times, a mentor's times for their students, a student's times for
 * the mentors who work with them (lib/interview-partners.ts).
 *
 * Gated on the row, not the route: the person is loaded first and then asked
 * whether the reader may book them at all — and "may not" and "no such person"
 * both answer 404, so an id cannot be used to learn who exists.
 */
export async function InterviewPerson({ viewer, id }: { viewer: InterviewViewer; id: string }) {
  const { user, as, base, now } = viewer;
  if (id === user.id) redirect(base);

  const person = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      role: true,
      status: true,
      isMentor: true,
      avatarUpdatedAt: true,
      studentProfile: {
        select: {
          enrollments: {
            select: { programId: true, exchangeId: true, program: { select: { name: true } } },
          },
        },
      },
      interviewSlots: {
        where: { startsAt: { gt: programWallClock(now) }, interview: null },
        select: { id: true, asMentor: true, startsAt: true, minutes: true },
        orderBy: { startsAt: "asc" },
      },
    },
  });
  if (!person?.name?.trim()) notFound();

  // Each kind of time asked once: a student-who-mentors offers both.
  const [asStudent, asMentor] = await Promise.all([
    mayBook(user, as, { asMentor: false, user: person }),
    mayBook(user, as, { asMentor: true, user: person }),
  ]);
  if (!asStudent && !asMentor) notFound();

  const name = person.name;
  const first = name.split(" ")[0] || name;
  // Their own programs, never one they are only visiting. A mentor's are not
  // shown: a mentor is reached through the work, not a program.
  const programs = asStudent
    ? studiesIn(person.studentProfile?.enrollments ?? []).map((e) => e.program.name)
    : [];

  const slots = person.interviewSlots
    .filter((s) => (s.asMentor ? asMentor : asStudent))
    .map((s) => ({
      id: s.id,
      day: formatSlotDay(s.startsAt, { zone: true }),
      span: formatSlotSpan(s),
    }));

  return (
    <div className="space-y-4">
      <PageTitle
        backHref={base}
        backLabel="Interviews"
        leading={<Avatar person={{ ...person, email: "" }} className="h-12 w-12 text-sm" />}
        title={name}
        subtitle={asMentor ? "Your mentor" : programs.join(" · ")}
      />

      <Section title="Available interview times" count={slots.length || undefined}>
        {slots.length === 0 ? (
          <EmptyState framed={false} title="No times offered">
            {`${first} hasn’t offered any times yet.`}
          </EmptyState>
        ) : (
          <BookInterviewForm as={as} slots={slots} templates={INTERVIEW_TEMPLATES} classmate={first} />
        )}
      </Section>
    </div>
  );
}
