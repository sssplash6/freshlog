import { redirect } from "next/navigation";

import { ExpandableText } from "@/components/expandable-text";
import { MentorFeedbackForm } from "@/components/forms/feedback-forms";
import { PersonChip } from "@/components/person-chip";
import { Rating } from "@/components/rating";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { ROLES } from "@/lib/constants";
import { requireRole } from "@/lib/dal";
import { formatDate } from "@/lib/format";
import { allocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { status, type ViewerContext } from "@/lib/status";

/** How many ratings stay open before the rest fold away. */
const RECENT = 3;

/**
 * Rating a mentor, and everything this student has already said.
 *
 * Who can be rated comes from `allocationSummary`, not from the pairing table:
 * it already carries every mentor the student holds time with PLUS every mentor
 * who has logged a session against them, which is exactly §6.6's "a session or
 * an allocation". Reading the pairings instead would offer the platform's admin
 * account — paired into every program — and drop the mentor who ran six
 * sessions before their pairing was removed.
 */
export default async function StudentFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ mentor?: string }>;
}) {
  const user = await requireRole(ROLES.STUDENT);
  const now = new Date();
  const viewer: ViewerContext = { audience: "student", userId: user.id, now };
  const { mentor: askedFor } = await searchParams;

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!profile) redirect("/onboarding");

  const [hours, given] = await Promise.all([
    allocationSummary(profile.id),
    prisma.mentorFeedback.findMany({
      where: { studentId: profile.id },
      include: { mentor: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const mentors = hours.perMentor
    .flatMap((m) => (m.mentor ? [m.mentor] : []))
    .map((m) => ({ id: m.id, label: m.name ?? m.email }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // A deep link from a past session — "rate the person you just met" — but only
  // where it names somebody this student may actually rate; the server action
  // refuses anyone else, and a select pre-filled with a rejected choice is a
  // form that fails on submit for no visible reason.
  const preselect = mentors.some((m) => m.id === askedFor) ? askedFor : undefined;

  const noMentor = status("NO_MENTOR", viewer);
  const recent = given.slice(0, RECENT);
  const earlier = given.slice(RECENT);

  return (
    <div className="space-y-4">
      <PageTitle backHref="/student" backLabel="Home" title="Rate a mentor" />

      {mentors.length > 0 ? (
        <MentorFeedbackForm mentors={mentors} defaultMentorId={preselect} />
      ) : (
        noMentor && (
          <EmptyState variant="blocked" title={noMentor.label}>
            Your program pairs you with one first.
          </EmptyState>
        )
      )}

      {given.length > 0 && (
        <Section title="What you've said" count={given.length}>
          <ul className="divide-y divide-line">
            {recent.map((f) => (
              <FeedbackRow key={f.id} feedback={f} />
            ))}
          </ul>
          <Disclosure
            label="Earlier ratings"
            count={earlier.length}
            className="border-t border-line px-4 sm:px-5"
          >
            <ul className="-mx-4 divide-y divide-line border-t border-line sm:-mx-5">
              {earlier.map((f) => (
                <FeedbackRow key={f.id} feedback={f} />
              ))}
            </ul>
          </Disclosure>
        </Section>
      )}
    </div>
  );
}

type GivenFeedback = {
  rating: number;
  comment: string | null;
  createdAt: Date;
  mentor: { id: string; name: string | null; email: string };
};

function FeedbackRow({ feedback }: { feedback: GivenFeedback }) {
  return (
    <li className="px-4 py-2 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <PersonChip person={feedback.mentor} size="sm" />
        <Rating value={feedback.rating} />
      </div>
      {feedback.comment && (
        <div className="mt-1.5 text-sm">
          <ExpandableText text={feedback.comment} lines={2} className="text-muted-fg" />
        </div>
      )}
      <p className="mt-1 text-xs text-muted-fg">{formatDate(feedback.createdAt)}</p>
    </li>
  );
}
