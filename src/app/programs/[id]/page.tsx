import { AttentionList } from "@/components/attention-list";
import { PersonChip } from "@/components/person-chip";
import { Timeline, type TimelineEntry } from "@/components/timeline";
import { ArrowLink } from "@/components/ui/link";
import { Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { INTERVIEW_STATUS } from "@/lib/constants";
import { requireProgramScope } from "@/lib/dal";
import { formatDate, formatDuration } from "@/lib/format";
import { programTotals } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { recentMeetings } from "@/lib/queries";
import { attentionList, meetingStatus, type ViewerContext } from "@/lib/status";

import {
  programFlags,
  programOf,
  programPairings,
  programStudents,
  requestNow,
} from "../reads";

const DAY = 24 * 60 * 60 * 1000;
/**
 * A week ahead, plus a day of slack: a meeting time is the program's wall clock
 * kept in a UTC field, five hours ahead of this instant, and `Timeline`
 * re-buckets every row against `now` anyway. One extra row to discard is
 * cheaper than doing calendar arithmetic twice.
 */
const HORIZON = 8 * DAY;
/** Up next is a week's diary, not a ledger. */
const UP_NEXT_CAP = 10;
/** Past ten, a list of mentors is a page of its own. */
const MENTORS_SHOWN = 10;
/** More than three of one state collapse into a line (`rollUp`). */
const ROLL_UP_AT = 3;

/**
 * The program at a glance: what needs a person, what is coming, who teaches
 * here, and when it was last taught in.
 *
 * Reading, not doing. Everything that changes the program's shape is one tab
 * over in Settings, and the roster with its add form is in Students — which is
 * what the page this replaces could not say, because it carried an editable
 * 12-row `MeetingsLog`, a violet "Tasks in flight" panel, and a Mentors list
 * byte-identical to the one on the settings page beneath it (§6.12).
 */
export default async function ProgramOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireProgramScope(id);
  const now = requestNow();
  const viewer: ViewerContext = { audience: "staff", userId: me.id, now };

  // The first three are the layout's reads, memoised: opening a program asks
  // for its row, its roster and its pairings once between the two files.
  const [program, students, pairings, meetings, [lastSession]] =
    await Promise.all([
      programOf(id),
      programStudents(id),
      programPairings(id),
      // Still in the diary: not cancelled, not held, nothing logged against it.
      // No lower bound, so a meeting that passed unlogged is still on the page
      // — it is the row most worth finding, and it sorts into "overdue".
      prisma.interview.findMany({
        where: {
          sessionId: null,
          status: {
            in: [
              INTERVIEW_STATUS.PROPOSED,
              INTERVIEW_STATUS.CONFIRMED,
              INTERVIEW_STATUS.DECLINED,
            ],
          },
          scheduledAt: { lte: new Date(now.getTime() + HORIZON) },
          // A scheduled meeting names no program of its own — it charges
          // nothing yet — so it belongs to this page by way of the student
          // being enrolled here.
          student: { enrollments: { some: { programId: id } } },
        },
        include: { mentor: true, student: { include: { user: true } } },
        orderBy: { scheduledAt: "asc" },
      }),
      recentMeetings({ programId: id, take: 1 }),
    ]);

  // §8.6: the one helper, over the unsliced roster — never a second reducer.
  const totals = programTotals(students);
  const flags = programFlags(program, students, pairings, viewer);
  const needsYou = attentionList(flags, viewer, { threshold: ROLL_UP_AT });

  /**
   * Up next is chronology, whatever the row is about: a use-by date three days
   * out matters more than a meeting next month, and both belong to the same
   * question. The use-by rows are the same `ALLOCATION_EXPIRING` statuses the
   * list above rolled up, not a second pass over the allocations — one
   * derivation, read twice.
   */
  const upNext: TimelineEntry[] = meetings.map((m) => ({
    id: m.id,
    at: m.scheduledAt,
    hasTime: m.hasTime,
    // Staff are neither party and the row has one chip. The student gets it,
    // because the row is about them; the mentor is named in the title, which is
    // the one fact this page cannot recover from anywhere else.
    title: `Meeting with ${m.mentor.name ?? m.mentor.email}`,
    status: meetingStatus(
      {
        id: m.id,
        status: m.status,
        scheduledAt: m.scheduledAt,
        sessionId: m.sessionId,
        student: {
          id: m.studentId,
          name: m.student.user.name ?? m.student.user.email,
        },
      },
      viewer
    ),
    person: m.student.user,
    href: `/students/${m.studentId}`,
    joinUrl: m.link,
    note: m.note,
  }));
  const studentById = new Map(students.map((s) => [s.id, s]));
  for (const s of flags) {
    if (s.type !== "ALLOCATION_EXPIRING" || !s.subject || !s.at) continue;
    upNext.push({
      id: `use-by-${s.subject.id}`,
      at: s.at,
      hasTime: false,
      // The chip already says "4h 38m expires September 30", so the title names
      // the kind of row rather than repeating the verb back.
      title: "Use-by date",
      status: s,
      person: studentById.get(s.subject.id)?.user ?? null,
      ...(s.href ? { href: s.href } : {}),
    });
  }

  // One line per MENTOR: somebody paired with three cohorts of this program is
  // one person teaching here, not three rows.
  const mentors = new Map<
    string,
    {
      mentor: (typeof pairings)[number]["mentor"];
      cohorts: string[];
      missingLink: boolean;
    }
  >();
  for (const p of pairings) {
    const held = mentors.get(p.mentorId);
    const row = held ?? { mentor: p.mentor, cohorts: [], missingLink: false };
    if (p.cohort) row.cohorts.push(p.cohort.name);
    if (!p.calendlyUrl) row.missingLink = true;
    mentors.set(p.mentorId, row);
  }
  const mentorRows = [...mentors.values()];
  const spilled = mentorRows.length - MENTORS_SHOWN;

  return (
    <div className="space-y-6">
      <AttentionList
        statuses={needsYou}
        title="Needs attention"
        empty="Nothing needs attention."
      />

      <Timeline entries={upNext} now={now} limit={UP_NEXT_CAP} />

      <Section
        title="Mentors"
        count={mentorRows.length}
        action={
          spilled > 0 ? (
            <ArrowLink href={`/mentors?program=${program.id}`} className="text-[13px]">
              All mentors
            </ArrowLink>
          ) : undefined
        }
      >
        {mentorRows.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-fg sm:px-5">
            Nobody teaches here yet. Settings pairs a mentor with the program.
          </p>
        ) : (
          <ul className="divide-y divide-line/60 text-sm">
            {mentorRows.slice(0, MENTORS_SHOWN).map(({ mentor, cohorts, missingLink }) => (
              <li
                key={mentor.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <PersonChip
                    person={mentor}
                    size="sm"
                    href={`/mentors/${mentor.id}`}
                  />
                  {cohorts.length > 0 && (
                    <span className="text-xs text-muted-fg">
                      {cohorts.join(" · ")}
                    </span>
                  )}
                </span>
                {missingLink && (
                  <StatusChip severity="attention">No booking link</StatusChip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* The delivery line, carrying the two figures the removed stat strip
          was the only place to read — logged and missed — and now linking to
          the ledger they came from. */}
      <p className="text-sm text-muted-fg">
        {lastSession
          ? `Last session ${formatDate(lastSession.date)} by ${lastSession.mentor.name ?? lastSession.mentor.email}`
          : "No sessions have been logged in this program"}
        {` · ${formatDuration(totals.completed)} logged`}
        {totals.missed > 0 && ` · ${formatDuration(totals.missed)} missed`}
      </p>
    </div>
  );
}
