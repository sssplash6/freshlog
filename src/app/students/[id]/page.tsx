import { notFound } from "next/navigation";

import { FolderIcon, SendIcon } from "@/components/icons";
import { AttentionList } from "@/components/attention-list";
import {
  AllocationsTable,
  toAllocationEntries,
} from "@/components/allocation-row";
import { ApproveStudentButtons } from "@/components/forms/approve-student-buttons";
import { AssignTaskForm } from "@/components/forms/assign-task-form";
import { AllocationRowActions } from "@/components/forms/hours-forms";
import { MeetingRowActions } from "@/components/forms/meeting-forms";
import { ScheduleInterviewForm } from "@/components/forms/schedule-interview-form";
import {
  RemoveStudentButton,
  StudentEmailChange,
  StudentFolderChange,
  StudentPrograms,
} from "@/components/forms/student-details-forms";
import { LedgerBoard } from "@/components/ledger-board";
import { Avatar } from "@/components/avatar";
import { PersonChip } from "@/components/person-chip";
import { Timeline, type TimelineEntry } from "@/components/timeline";
import { LinkButton } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { FactList } from "@/components/ui/fact-list";
import { Figure } from "@/components/ui/figure";
import { ExternalLink } from "@/components/ui/link";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ASSIGNMENT_PROGRESS,
  USER_STATUS,
  canActAsMentor,
  interviewIsOpen,
} from "@/lib/constants";
import {
  adminScope,
  canManageStudent,
  mentorReaches,
  scopeProgramFilter,
  studentScope,
} from "@/lib/authz";
import { enrollmentLabel, enrollmentsLabel } from "@/lib/enrollments";
import { requireUser } from "@/lib/dal";
import { deadlinePassed } from "@/lib/deadlines";
import {
  formatDate,
  formatDuration,
  formatMinutes,
  formatMoney,
  toDateInputValue,
  toTimeInputValue,
} from "@/lib/format";
import { allocationSummary } from "@/lib/hours";
import { splitMeetings } from "@/lib/interviews";
import { prisma } from "@/lib/prisma";
import { profileOf } from "@/lib/profile";
import {
  programOptions,
  studentLedger,
  studentMeetings,
  toProgramOptions,
} from "@/lib/queries";
import { meetingStatus, studentStatuses } from "@/lib/status";

/**
 * One student, at one address, for everyone entitled to open them.
 *
 * There were two of these pages and they disagreed. Both rendered every
 * session and every task TWICE — once in the board and once in the panel
 * under it — with over-budget work red in one and amber in the other, five
 * stat cards on top and seven panels in three tints below. The reader's job is
 * one question: how much time is left, with whom, until when, and what needs
 * doing now.
 *
 * Who may see it is the UNION of the viewer's rights, per §3: an admin who
 * also mentors this student gets both sets of controls, and the lens decides
 * only which action reads as primary. Nothing appears or disappears when you
 * switch lens mid-task — that was the old switch's worst habit.
 */
export default async function StudentWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  const { id } = await params;

  const profile = await prisma.studentProfile.findUnique({
    where: { id },
    include: {
      user: true,
      enrollments: {
        include: { program: true, cohort: true },
        orderBy: { program: { name: "asc" } },
      },
    },
  });
  if (!profile) notFound();

  // The two rights, asked before anything is fetched. A student outside an
  // admin's programs and outside a mentor's reach reads exactly like a student
  // who does not exist — and their own page is their home, not this.
  const [manages, reaches] = await Promise.all([
    canManageStudent(me, profile),
    canActAsMentor(me) ? mentorReaches(me, profile) : Promise.resolve(false),
  ]);
  if (!manages && !reaches) notFound();

  const lens = await profileOf(me);
  const viewer = {
    // One instant for the whole page: every use-by date, every bucket and
    // every chip is judged against the same "now", or two sections disagree
    // about what has expired.
    audience: manages ? ("staff" as const) : ("mentor" as const),
    userId: me.id,
    now: new Date(),
  };

  const programIds = scopeProgramFilter(await adminScope(me));
  /**
   * WHICH of this student's programs this reader may read.
   *
   * `manages` says they may open the page — one of the student's programs is
   * theirs. This says which, and everything below is filtered by it: an admin
   * of Global Admissions opening a student who also studies in the Master's
   * Program sees their Global Admissions hours, tasks, sessions and grants, and
   * no trace of the other. A mentor is not scoped by grants at all; they see
   * the student's whole record, as they always have, because their reach is the
   * caseload rather than a program.
   */
  const visible = manages ? await studentScope(me, profile) : undefined;
  const enrollments = visible
    ? profile.enrollments.filter((e) => visible.includes(e.programId))
    : profile.enrollments;
  const ledgerWhere = visible ? { programId: { in: visible } } : {};

  const [hours, ledger, meetings, changes, programs, mentors] = await Promise.all([
    allocationSummary(profile.id, visible),
    studentLedger(profile.id, visible),
    studentMeetings(profile.id),
    manages
      ? prisma.hourAllotmentChange.findMany({
          where: { studentId: profile.id, ...ledgerWhere },
          include: { mentor: true, program: true, changedBy: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : Promise.resolve([]),
    // Archived included: a student may already be IN one, and the move form
    // has to be able to show where they are before it offers anywhere else.
    manages ? programOptions(programIds, true) : Promise.resolve([]),
    manages
      ? prisma.user.findMany({
          where: {
            OR: [{ role: "MENTOR" }, { isMentor: true }],
            ...(programIds
              ? { mentorAssignments: { some: { programId: { in: [...programIds] } } } }
              : {}),
          },
          orderBy: [{ name: "asc" }],
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
  ]);

  const name = profile.user.name ?? profile.user.email;
  const isPending = profile.user.status === USER_STATUS.PENDING;
  const handle = profile.telegramUsername?.replace(/^@/, "");

  // What this reader may log against: their own grant, or the unassigned pool
  // while it is live. Stated once, and the button says the reason when it is
  // false rather than vanishing — a control that disappears is a control the
  // reader thinks is broken.
  const mine = hours.perMentor.find((m) => m.mentor?.id === me.id);
  const pool = hours.perMentor.find(
    (m) => !m.mentor && m.remaining > 0 && !(m.deadline && deadlinePassed(m.deadline))
  );
  const active = profile.user.status === USER_STATUS.ACTIVE;
  const canLog = reaches && active && Boolean(mine || pool);
  const logReason = !active
    ? "This student is not approved yet."
    : !mine && !pool
      ? "No time is allocated for you with them."
      : undefined;

  const statuses = studentStatuses(
    {
      id: profile.id,
      name: profile.user.name,
      email: profile.user.email,
      accountStatus: profile.user.status,
      telegramUsername: profile.telegramUsername,
      allottedMinutes: hours.allotted,
      remainingMinutes: hours.remaining,
      forfeitedMinutes: hours.forfeited,
      poolMinutes: pool?.remaining ?? 0,
      nextDeadline: hours.perMentor.reduce<Date | null>(
        (soonest, m) =>
          m.deadline &&
          !deadlinePassed(m.deadline) &&
          (!soonest || m.deadline < soonest)
            ? m.deadline
            : soonest,
        null
      ),
      mentorCount: hours.perMentor.filter((m) => m.mentor).length,
    },
    viewer
  );

  const { upcoming } = splitMeetings(meetings, viewer.now);
  const entries: TimelineEntry[] = upcoming
    .filter(interviewIsOpen)
    .map((m) => ({
      id: m.id,
      at: m.scheduledAt,
      hasTime: m.hasTime,
      timePending: !m.hasTime,
      title: "Meeting",
      status: meetingStatus(
        {
          id: m.id,
          status: m.status,
          scheduledAt: m.scheduledAt,
          sessionId: m.sessionId,
          student: { id: profile.id, name },
        },
        viewer
      ),
      person: { id: m.mentorId, name: m.mentor.name, email: m.mentor.email },
      joinUrl: m.link,
      note: m.note,
      // Only the mentor who booked it may move it. An admin correcting
      // somebody else's diary is not a thing this product does.
      action:
        m.mentorId === me.id ? (
          <MeetingRowActions
            meeting={{
              id: m.id,
              date: toDateInputValue(m.scheduledAt),
              time: m.hasTime ? toTimeInputValue(m.scheduledAt) : "",
              link: m.link,
              note: m.note,
            }}
          />
        ) : undefined,
    }));

  const openTasks = ledger.assignments.filter(
    (t) => t.progress !== ASSIGNMENT_PROGRESS.DONE
  );

  // Their open tasks per (program, mentor), so granting more hours for work
  // already underway tops that budget up instead of starting a second row of
  // the same name — and so the Master's Program's essay is never offered as a
  // top-up target for a Global Admissions grant. An empty mentor half keys the
  // unassigned pool's own.
  const openTasksByMentor: Record<string, { purpose: string; hint?: string }[]> = {};
  for (const task of openTasks) {
    (openTasksByMentor[`${task.programId}:${task.mentorId ?? ""}`] ??= []).push({
      purpose: task.purpose,
      hint:
        task.minuteLimit != null
          ? `${formatMinutes(task.loggedMinutes)} of ${formatMinutes(task.minuteLimit)}`
          : "no budget yet",
    });
  }

  const mentorOptions = mentors.map((m) => ({
    value: m.id,
    label: m.name ?? m.email,
  }));
  // Any of the reader's programs that bills per student. The money fields
  // belong to the grant, and the grant names its program, so the form asks
  // per program rather than once for the whole student.
  const paymentPrograms = new Set(
    enrollments.filter((e) => e.program.tracksPayment).map((e) => e.programId)
  );
  const tracksPayment = paymentPrograms.size > 0;
  // Two primary actions at most, in either lens — the admin's power lives in
  // the ⋮ menus on the rows it belongs to.
  const primaryIsLog = lens === "mentor";

  return (
    <div className="space-y-8">
      <PageTitle
        backHref="/students"
        backLabel="Students"
        eyebrow={`Student · ${enrollmentsLabel(enrollments)}`}
        // The mentor's page opens with their face; the student's opened with
        // nothing, on the same data model. A person's own page is the one place
        // identity is unambiguously the subject.
        leading={
          <Avatar
            person={{
              id: profile.id,
              name: profile.user.name,
              email: profile.user.email,
              avatarUpdatedAt: profile.user.avatarUpdatedAt,
            }}
            className="h-16 w-16 text-lg"
          />
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {name}
            {isPending && (
              <StatusChip severity="attention">Pending approval</StatusChip>
            )}
          </span>
        }
        subtitle={
          <>
            {profile.user.email}
            {handle && (
              <>
                {" · "}
                <ExternalLink
                  variant="inline"
                  href={`https://t.me/${handle}`}
                  icon={<SendIcon className="h-3.5 w-3.5" />}
                  title={`Message @${handle} on Telegram`}
                  className="align-middle"
                >
                  @{handle}
                </ExternalLink>
              </>
            )}
            {profile.folderUrl && (
              <>
                {" · "}
                <ExternalLink
                  variant="inline"
                  href={profile.folderUrl}
                  icon={<FolderIcon className="h-3.5 w-3.5" />}
                  title={`Open the student's folder (${profile.folderUrl})`}
                  className="align-middle"
                >
                  Folder
                </ExternalLink>
              </>
            )}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {reaches && (
              <>
                <LinkButton
                  href={`/sessions/new?student=${profile.id}`}
                  variant={primaryIsLog ? "primary" : "secondary"}
                  size="md"
                  {...(canLog ? {} : { "aria-disabled": true, title: logReason })}
                >
                  Log a session
                </LinkButton>
                <ScheduleInterviewForm
                  studentProfileId={profile.id}
                  studentName={name}
                />
              </>
            )}
            {isPending && manages && (
              <ApproveStudentButtons studentProfileId={profile.id} />
            )}
          </div>
        }
      />

      {!canLog && reaches && logReason && (
        <p className="text-sm text-muted-fg">{logReason}</p>
      )}

      <AttentionList statuses={statuses} title="Needs attention" empty={null} />

      {/* The tracking sheet's whole tab, side by side: what happened on the
          left, what was planned on the right, and the balance across the top.
          It leads the page because it is what the page is opened for — and it
          is the ONLY place a session or a task renders, so nothing below
          repeats a row. */}
      <LedgerBoard
        viewer={viewer}
        sessions={ledger.sessions}
        meetings={meetings}
        assignments={ledger.assignments}
        totals={hours}
        mentorBase="/mentors"
      />

      {manages && mentorOptions.length > 0 && (
        <Section
          eyebrow="Adds to a mentor's ledger"
          title="Allocate time"
          caption="The hours go to the student; naming a mentor and a task can wait."
        >
          <div className="px-4 py-4 sm:px-5">
            <AssignTaskForm
              studentProfileId={profile.id}
              programs={enrollments.map((e) => ({
                value: e.programId,
                label: enrollmentLabel(e),
              }))}
              mentors={mentorOptions}
              openTasksByMentor={openTasksByMentor}
              paymentPrograms={[...paymentPrograms]}
            />
          </div>
        </Section>
      )}

      <Timeline
        entries={entries}
        now={viewer.now}
        empty="Nothing scheduled with them."
      />

      {/* The two halves of the tracking sheet, side by side at ≥lg and stacked
          below. That is how the deleted board earns its keep: holding both at
          once was what it was prized for, and a grid keeps that reading while
          every session and task renders exactly once. */}
      <Section
        eyebrow="Granted by an admin"
        title="Time by mentor"
        caption="What sessions draw down, and the date each pool expires"
      >
        {tracksPayment && manages && (
          <div className="px-4 pt-4 sm:px-5">
            <Figure label="Paid" value={formatMoney(hours.paid)} tone="muted" />
          </div>
        )}

        {hours.perMentor.length === 0 ? (
          <EmptyState framed={false} title="No time yet">
            An admin grants it, with or without a mentor named.
          </EmptyState>
        ) : (
          <AllocationsTable
            entries={toAllocationEntries(hours.perMentor, {
              mentorBase: "/mentors",
            })}
            viewer={viewer}
            framed={false}
            showAmountPaid={tracksPayment && manages}
            renderActions={
              manages
                ? (entry) => (
                    <AllocationRowActions
                      studentProfileId={profile.id}
                      programId={entry.program.id}
                      mentorId={entry.mentor?.id ?? ""}
                      mentorLabel={
                        entry.mentor
                          ? (entry.mentor.name ?? entry.mentor.email)
                          : "the unassigned time"
                      }
                      currentMinutes={entry.allocated}
                      currentDeadline={
                        entry.deadline ? toDateInputValue(entry.deadline) : null
                      }
                      openTasks={
                        openTasksByMentor[
                          `${entry.program.id}:${entry.mentor?.id ?? ""}`
                        ] ?? []
                      }
                      showAmountPaid={paymentPrograms.has(entry.program.id)}
                      currentAmountPaid={entry.amountPaid ?? null}
                    />
                  )
                : undefined
            }
          />
        )}

        {manages && changes.length > 0 && (
          <div className="border-t border-line px-4 py-3 sm:px-5">
            <Disclosure label="History" count={changes.length}>
              <ul className="divide-y divide-line/60 text-sm">
                {changes.map((c) => (
                  <li key={c.id} className="flex flex-wrap gap-x-2 py-2.5">
                    <span className="tabular-nums text-muted-fg">
                      {formatDate(c.createdAt)}
                    </span>
                    <span>
                      {c.changedBy.name ?? c.changedBy.email} set{" "}
                      {c.mentor ? (
                        <PersonChip person={c.mentor} size="sm" href={`/mentors/${c.mentor.id}`} />
                      ) : (
                        "unassigned time"
                      )}
                      :{" "}
                      <span className="tabular-nums">
                        {formatDuration(c.oldMinutes)} → {formatDuration(c.newMinutes)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
        )}
      </Section>

      {manages && (
        <Section eyebrow="Admin only" title="Details">
          <div className="px-4 py-2 sm:px-5">
            <FactList
              items={[
                {
                  label: "Sign-in email",
                  value: profile.user.email,
                  change: (
                    <StudentEmailChange
                      studentProfileId={profile.id}
                      currentEmail={profile.user.email}
                    />
                  ),
                },
                {
                  label: enrollments.length === 1 ? "Program" : "Programs",
                  value: enrollmentsLabel(enrollments, "Not in any program"),
                  change: (
                    <StudentPrograms
                      studentProfileId={profile.id}
                      programs={toProgramOptions(programs)}
                      enrollments={enrollments.map((e) => ({
                        id: e.id,
                        programId: e.programId,
                        cohortId: e.cohortId,
                        label: enrollmentLabel(e),
                      }))}
                    />
                  ),
                },
                {
                  label: "Folder",
                  value: profile.folderUrl ?? "Not set",
                  change: (
                    <StudentFolderChange
                      studentProfileId={profile.id}
                      currentFolderUrl={profile.folderUrl}
                    />
                  ),
                },
                {
                  label: "Telegram",
                  value: handle ? `@${handle}` : "Not set — they add it on first sign-in",
                },
                { label: "Registered", value: formatDate(profile.createdAt) },
                {
                  label: "Approval",
                  value: isPending ? "Waiting for approval" : "Approved",
                },
              ]}
            />
          </div>
          <div className="border-t border-line px-4 py-4 sm:px-5">
            <RemoveStudentButton
              studentProfileId={profile.id}
              name={name}
              hasSessions={ledger.sessions.length > 0}
            />
          </div>
        </Section>
      )}
    </div>
  );
}
