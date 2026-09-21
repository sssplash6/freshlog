import { notFound } from "next/navigation";

import { FolderIcon, SendIcon } from "@/components/icons";
import {
  AllocationsTable,
  timeByMentorEntries,
  toAllocationEntries,
} from "@/components/allocation-row";
import { ApproveStudentButtons } from "@/components/forms/approve-student-buttons";
import {
  AllocationMinutesEditor,
  AllocationRowActions,
  TaskRowActions,
} from "@/components/forms/hours-forms";
import {
  RemoveStudentButton,
  StudentEmailChange,
  StudentFolderChange,
  StudentNameChange,
  StudentPrograms,
  StudentTelegramChange,
} from "@/components/forms/student-details-forms";
import { ExchangeList } from "@/components/exchange-panel";
import { SendOnExchangeForm } from "@/components/forms/exchange-forms";
import { LedgerBoard } from "@/components/ledger-board";
import { toStudentTaskEntries } from "@/components/student-task-row";
import {
  SetStudentTaskForm,
  StudentTaskRowActions,
} from "@/components/forms/student-task-forms";
import { Avatar } from "@/components/avatar";
import { PersonChip } from "@/components/person-chip";
import { LinkButton } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { FactList } from "@/components/ui/fact-list";
import { ExternalLink } from "@/components/ui/link";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { SessionRowActions } from "@/components/forms/session-forms";
import {
  ASSIGNMENT_PROGRESS,
  SESSION_STATUS,
  USER_STATUS,
  attendanceOf,
  canActAsMentor,
  timeKindOf,
} from "@/lib/constants";
import {
  adminScope,
  canManageStudent,
  mentorReaches,
  scopeCovers,
  scopeProgramFilter,
  studentScope,
} from "@/lib/authz";
import { enrollmentLabel, enrollmentsLabel, studiesIn } from "@/lib/enrollments";
import { visibleExchanges } from "@/lib/exchanges";
import { requireUser } from "@/lib/dal";
import { deadlinePassed } from "@/lib/deadlines";
import {
  formatDate,
  formatDuration,
  formatMinutes,
  formatMoney,
  toDateInputValue,
} from "@/lib/format";
import { allocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { profileOf } from "@/lib/profile";
import {
  programOptions,
  studentLedger,
  taskOptionsForSessions,
  toProgramOptions,
} from "@/lib/queries";

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

  const [
    hours,
    ledger,
    changes,
    programs,
    mentors,
    exchanges,
    myPairings,
    elsewhere,
  ] = await Promise.all([
    allocationSummary(profile.id, visible),
    studentLedger(profile.id, visible),
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
    // Placements between two programs, in both directions — the one thing on
    // this page a reader may see that belongs to a program they do not
    // administer. `visibleExchanges` decides which, and it is narrower than
    // this page's own gate: being able to open a student is not being party to
    // an arrangement between two other programs.
    visibleExchanges(me, profile),
    canActAsMentor(me)
      ? prisma.mentorAssignment.findMany({
          where: { mentorId: me.id },
          select: { programId: true },
        })
      : Promise.resolve([]),
    // Where they could be sent: every active program they are not already in.
    // Deliberately NOT scoped to the reader's grants — you lend a student to a
    // program precisely because you have no standing in it.
    prisma.program.findMany({
      where: {
        status: "ACTIVE",
        id: { notIn: profile.enrollments.map((e) => e.programId) },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const name = profile.user.name ?? profile.user.email;
  const isPending = profile.user.status === USER_STATUS.PENDING;
  const handle = profile.telegramUsername?.replace(/^@/, "");

  // May this reader log a session here?
  //
  // Reach and approval, and nothing else. It used to also require the reader
  // to hold a grant or find a live unassigned pool — which disabled the button
  // for every mentor working in the student's program who had simply not been
  // granted hours yet, and for every mentor whose allocation had expired. The
  // action never agreed: a mentor in the program may log without holding
  // anything, an in-plan log against an empty balance overdraws rather than
  // failing, and extra hours are loggable past a deadline. A button disabled
  // where the action would have said yes is a permission invented by the page.
  //
  // What the reader holds is still worth saying, so it is said as a hint under
  // the button rather than as a block on it.
  const mine = hours.perMentor.find((m) => m.mentor?.id === me.id);
  const pool = hours.perMentor.find(
    (m) => !m.mentor && m.remaining > 0 && !(m.deadline && deadlinePassed(m.deadline))
  );
  const active = profile.user.status === USER_STATUS.ACTIVE;
  const canLog = reaches && active;
  const logReason = !active
    ? "This student is not approved yet."
    : !mine && !pool
      ? "No time is allocated for you with them — a session you log here will be an overdraw, or extra hours."
      : undefined;

  /**
   * Which of the student's OWN programs this reader may lend them from.
   *
   * The same two people `assertExchangeSender` accepts — an admin of the
   * program, or a mentor who works in it — asked here so the form offers
   * exactly what the action will take. A visit is never in this list: a student
   * somebody else lent us is not ours to lend onward.
   */
  const scope = await adminScope(me);
  const pairedIn = new Set(myPairings.map((p) => p.programId));
  const sendableFrom = studiesIn(profile.enrollments).filter(
    (e) => scopeCovers(scope, e.programId) || pairedIn.has(e.programId)
  );
  // Either program's admins, or whoever sent them. The action asks the same.
  const isParty = (e: { fromProgramId: string; toProgramId: string; sentById: string }) =>
    e.sentById === me.id ||
    scopeCovers(scope, e.fromProgramId) ||
    scopeCovers(scope, e.toProgramId);

  /**
   * Which programs this reader may set this student a TASK in.
   *
   * The same two people `assertTaskAssigner` accepts — a mentor who works in
   * the program, or an admin of it — asked here so the form offers exactly what
   * the action will take. Unlike `sendableFrom` a VISIT counts: the placement
   * made them a member of the host program for as long as the hours last, and
   * the work of that visit is the host's to set, exactly as its sessions are.
   */
  const assignableIn = enrollments.filter(
    (e) => scopeCovers(scope, e.programId) || pairedIn.has(e.programId)
  );
  /** A task's menu belongs to the mentor who set it, and to its program's admins. */
  const ownsTask = (task: { programId: string; mentorId: string }) =>
    task.mentorId === me.id || scopeCovers(scope, task.programId);

  const sendForm =
    sendableFrom.length > 0 ? (
      <SendOnExchangeForm
        studentProfileId={profile.id}
        studentName={name}
        fromPrograms={sendableFrom.map((e) => ({
          value: e.programId,
          label: enrollmentLabel(e),
        }))}
        toPrograms={elsewhere.map((p) => ({ value: p.id, label: p.name }))}
      />
    ) : null;

  const openTasks = ledger.assignments.filter(
    (t) => t.progress !== ASSIGNMENT_PROGRESS.DONE
  );

  // "Assigned" is the whole commitment to a mentor: their allocation plus
  // the budgets on their agenda items. Keep the raw allocation on the entry
  // because its editor and the completed/remaining math still act on that row.
  const timeByMentor = timeByMentorEntries(
    toAllocationEntries(hours.perMentor, { mentorBase: "/mentors" }),
    ledger.assignments,
    { mentorBase: "/mentors" },
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
          ? `${formatMinutes(task.loggedMinutes)}/${formatMinutes(task.minuteLimit)}`
          : undefined,
    });
  }

  // The tasks each logged session could be re-pointed at, keyed by session.
  // `taskOptionsForSessions` is the same helper /sessions uses, and it keys on
  // (student, program, mentor) because `resolveGoal` refuses a task from
  // another program — offering one here would offer a correction the action
  // then turns down.
  const sessionTasks = await taskOptionsForSessions(ledger.sessions);

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
    <div className="space-y-4">
      <PageTitle
        backHref="/students"
        backLabel="Students"
        // The programs, and nothing else. "Student ·" in front of them said
        // what the back-link two lines above already says, on a page whose
        // subject is a person with their face beside their name.
        eyebrow={enrollmentsLabel(enrollments)}
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
          <span className="flex flex-wrap items-center gap-2">
            {name}
            {/* The pencil is on the fact, not in a panel below it. Both
                readers of this page own this one — see `StudentNameChange`. */}
            {(manages || reaches) && (
              <StudentNameChange
                studentProfileId={profile.id}
                currentName={profile.user.name}
              />
            )}
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
          <div className="flex flex-wrap items-center gap-2 lg:-mr-14">
            {reaches && (
              // One action in the masthead, not two. Scheduling was the
              // secondary of a pair and the only one that opened a form in the
              // header rather than going somewhere; the meetings already in
              // the diary still read on the board below.
              <LinkButton
                href={`/sessions/new?student=${profile.id}`}
                variant={primaryIsLog ? "primary" : "secondary"}
                size="md"
                // The one control on the page that spends the student's hours,
                // marked by a filament of the colour those hours are drawn in.
                className="liquid-edge"
                {...(canLog ? {} : { "aria-disabled": true, title: logReason })}
              >
                Log a session
              </LinkButton>
            )}
            {manages && mentorOptions.length > 0 && (
              <LinkButton href={`/students/${profile.id}/allocate`} variant="secondary" size="md">
                Allocate time
              </LinkButton>
            )}
            {isPending && manages && (
              <ApproveStudentButtons studentProfileId={profile.id} />
            )}
          </div>
        }
      />

      {reaches && logReason && <p className="text-sm text-muted-fg">{logReason}</p>}

      {/* The tracking sheet's whole tab: what happened on the left, what the
          student is doing about it on the right, the agenda the hours were
          bought for underneath, and the balance across the top. It leads the
          page because it is what the page is opened for — and it is the ONLY
          place a session, a task or an agenda item renders, so nothing below
          repeats a row. */}
      <LedgerBoard
        viewer={viewer}
        sessions={ledger.sessions}
        tasks={toStudentTaskEntries(ledger.tasks, {
          mentorBase: "/mentors",
          // Named only when the reader can see more than one of the student's
          // programs, for the same reason the agenda names one: otherwise every
          // row repeats a fact the page's own eyebrow already carries.
          showProgram: enrollments.length > 1,
        })}
        assignments={ledger.assignments}
        totals={hours}
        mentorBase="/mentors"
        // The board is where these rows are READ, so it is where they have to
        // be correctable. Neither menu was here: a logged session had to be
        // hunted down again on /sessions, and a task could not be corrected
        // anywhere at all — `TaskRowActions` was written and never rendered.
        //
        // An admin of the row's program gets both. A mentor gets a session
        // they logged themselves and a task assigned to them, which are the
        // same two rules the server enforces in `requireSessionAuthority` and
        // `assertTaskScope`; the menu is not the gate, it is the affordance
        // for a gate that will agree with it.
        renderSessionActions={(session) =>
          manages || session.mentorId === me.id ? (
            <SessionRowActions
              session={{
                id: session.id,
                minutes: session.minutes,
                date: toDateInputValue(session.date),
                attendance: attendanceOf(session),
                timeKind: timeKindOf(session),
                note: session.note,
                assignmentId: session.assignmentId,
              }}
              goals={sessionTasks[session.id] ?? []}
              canEdit={session.status !== SESSION_STATUS.VOIDED}
              canDelete={manages}
            />
          ) : null
        }
        renderAgendaActions={(task) =>
          manages || task.mentorId === me.id ? (
            <TaskRowActions
              task={{
                id: task.id,
                purpose: task.purpose,
                mentorId: task.mentorId,
                minuteLimit: task.minuteLimit,
                dueNote: task.dueNote,
                dueOn: task.dueOn,
                note: task.note,
                progress: task.progress,
                progressManual: task.progressManual,
              }}
              mentors={mentorOptions}
              canDelete={manages}
            />
          ) : null
        }
        // A task is the mentor's own word to the student, so the menu goes to
        // the person who gave it — and to the admins of the program it was
        // given in, who are who is left holding it when that mentor moves on.
        // `assertTaskScope` enforces exactly this pair server-side.
        renderTaskActions={(task) =>
          ownsTask({ programId: task.programId, mentorId: task.mentor.id }) ? (
            <StudentTaskRowActions
              task={{
                id: task.id,
                title: task.title,
                note: task.note,
                dueOn: task.dueOn,
              }}
            />
          ) : null
        }
        taskForm={
          assignableIn.length > 0 ? (
            <SetStudentTaskForm
              studentProfileId={profile.id}
              programs={assignableIn.map((e) => ({
                value: e.programId,
                label: enrollmentLabel(e),
              }))}
            />
          ) : null
        }
      />

      {/* Placements between two programs, above the grant form on purpose: a
          host admin about to allocate has to see the cap first, and a sending
          mentor opens this page for nothing else. It is the one section whose
          rows can belong to a program the reader does not administer — see
          `visibleExchanges`, which decides exactly which. */}
      {(exchanges.length > 0 || sendableFrom.length > 0) && (
        <Section
          title="Exchange"
          count={exchanges.length || undefined}
        >
          {exchanges.length > 0 ? (
            <>
              <ExchangeList
                exchanges={exchanges}
                viewer={viewer}
                canReturn={isParty}
              />
              {sendForm && (
                <div className="border-t border-line px-4 py-2 sm:px-5">
                  {sendForm}
                </div>
              )}
            </>
          ) : (
            // The sentence and the action on ONE line: a band of its own for a
            // button under a band holding six words was two rows of chrome to
            // say that nothing has happened yet. `justify-between` with wrap,
            // so the form drops to a line of its own when it is opened and
            // needs the width.
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-5">
              <p className="min-w-0 text-sm text-muted-fg">
                Nobody has lent {name} to another program.
              </p>
              {sendForm}
            </div>
          )}
        </Section>
      )}

      {/* The two halves of the tracking sheet, side by side at ≥lg and stacked
          below. That is how the deleted board earns its keep: holding both at
          once was what it was prized for, and a grid keeps that reading while
          every session and task renders exactly once. */}
      {/* No eyebrow. "Granted by an admin" said who WRITES the rows, which is
          a fact about permissions rather than about the time — and the ⋮ menu
          is already there or not there depending on the answer. The title
          names the subject and the caption says what the figures are. */}
      <Section
        title="Time by mentor"
        // On the title's line, not in a band of its own. A `Figure` under the
        // header spent a whole row of the card on one small number and left
        // the other nine hundred pixels of it empty; the total belongs beside
        // the heading it totals, the way every other card here reads.
        action={
          tracksPayment && manages ? (
            <span className="text-xs text-muted-fg">
              <span className="font-semibold tabular-nums text-ink">
                {formatMoney(hours.paid)}
              </span>{" "}
              paid
            </span>
          ) : undefined
        }
      >
        {timeByMentor.length === 0 ? (
          <EmptyState framed={false} title="No time yet">
            An admin grants it, with or without a mentor named.
          </EmptyState>
        ) : (
          <AllocationsTable
            entries={timeByMentor}
            framed={false}
            showAmountPaid={tracksPayment && manages}
            renderActions={
              manages
                ? (entry) =>
                    entry.deadline ? (
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
                        currentDeadline={toDateInputValue(entry.deadline)}
                        openTasks={
                          openTasksByMentor[
                            `${entry.program.id}:${entry.mentor?.id ?? ""}`
                          ] ?? []
                        }
                        showAmountPaid={paymentPrograms.has(entry.program.id)}
                        currentAmountPaid={entry.amountPaid ?? null}
                      />
                    ) : null
                : undefined
            }
            renderAssignedActions={
              manages
                ? (entry) =>
                    entry.deadline ? (
                      <AllocationMinutesEditor
                        studentProfileId={profile.id}
                        programId={entry.program.id}
                        mentorId={entry.mentor?.id ?? ""}
                        currentMinutes={entry.allocated}
                        currentDeadline={toDateInputValue(entry.deadline)}
                        showAmountPaid={paymentPrograms.has(entry.program.id)}
                        currentAmountPaid={entry.amountPaid ?? null}
                      />
                    ) : undefined
                : undefined
            }
          />
        )}

        {manages && changes.length > 0 && (
          <div className="border-t border-line px-4 py-2 sm:px-5">
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
                  value: handle
                    ? `@${handle}`
                    : "Not set — they add it on first sign-in",
                  change: (
                    <StudentTelegramChange
                      studentProfileId={profile.id}
                      currentHandle={handle}
                    />
                  ),
                },
                { label: "Registered", value: formatDate(profile.createdAt) },
                {
                  label: "Approval",
                  value: isPending ? "Waiting for approval" : "Approved",
                },
              ]}
            />
          </div>
          <div className="border-t border-line px-4 py-2 sm:px-5">
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
