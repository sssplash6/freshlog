import { notFound } from "next/navigation";

import { FolderIcon, SendIcon } from "@/components/icons";
import {
  AllocationsTable,
  timeByMentorEntries,
  toAllocationEntries,
} from "@/components/allocation-row";
import { ApproveStudentButtons } from "@/components/forms/approve-student-buttons";
import { AllocationRowActions, TaskRowActions } from "@/components/forms/hours-forms";
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
  TaskProgressControl,
} from "@/components/forms/student-task-forms";
import { Avatar } from "@/components/avatar";
import { PersonChip } from "@/components/person-chip";
import { LinkButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
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
  adminWriteScope,
  canAdministerStudent,
  canManageStudent,
  mentorReaches,
  scopeCovers,
  staffLevel,
  scopeProgramFilter,
  studentScope,
} from "@/lib/authz";
import { enrollmentLabel, enrollmentsLabel, studiesIn } from "@/lib/enrollments";
import { visibleExchanges } from "@/lib/exchanges";
import { requireUser } from "@/lib/dal";
import { deadlinePassed, soonestExpiry } from "@/lib/deadlines";
import {
  formatDate,
  formatDuration,
  formatMinutes,
  formatMoney,
  toDateInputValue,
} from "@/lib/format";
import { readParam, type SearchParams } from "@/lib/filters";
import { allocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { profileOf } from "@/lib/profile";
import {
  programOptions,
  studentLedger,
  taskOptionsForSessions,
  toProgramOptions,
} from "@/lib/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Student" };

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireUser();
  const { id } = await params;
  const from = readParam(await searchParams, "from");

  const profile = await prisma.studentProfile.findUnique({
    where: { id },
    include: {
      user: true,
      enrollments: {
        include: { program: true, cohort: true, level: true },
        orderBy: { program: { name: "asc" } },
      },
    },
  });
  if (!profile) notFound();

  // The two rights, asked before anything is fetched. A student outside an
  // admin's programs and outside a mentor's reach reads exactly like a student
  // who does not exist — and their own page is their home, not this.
  const [manages, writes, reaches] = await Promise.all([
    canManageStudent(me, profile),
    // The change affordances, separately: a LEADER/SALES grant opens the page
    // and its figures (`manages`) but must not draw a control whose action
    // would refuse it.
    canAdministerStudent(me, profile),
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
    : // "You" is the reader as a MENTOR. An admin who is not this student's
      // mentor holds no time with anybody and logs on someone else's behalf, so
      // being told "you hold no time with them" was a sentence about nothing
      // they were doing (October 2026 audit).
      !reaches
      ? undefined
      : !mine && !pool
      ? "You hold no time with them — a session you log here counts as extra time or an overdraw."
      : mine && (mine.expired || mine.remaining < 0)
        ? mine.expired
          ? // Expired is not overdrawn, and the sentence used to call it one.
            `Their time with you expired${mine.deadline ? ` on ${formatDate(mine.deadline)}` : ""}. Log the session as extra, or ask an admin to extend it.`
          : "Their time with you is already overdrawn — a session that counts toward it adds to the overdraw. Log it as extra to charge nothing."
        : undefined;

  /**
   * Which of the student's OWN programs this reader may lend them from.
   *
   * The same two people `assertExchangeSender` accepts — an admin of the
   * program, or a mentor who works in it — asked here so the form offers
   * exactly what the action will take. A visit is never in this list: a student
   * somebody else lent us is not ours to lend onward.
   */
  // The legs below build write affordances (send, set a task, row menus), so
  // they ask the write scope — the read scope `adminScope(me)` would offer a
  // LEADER controls the actions then refuse.
  const scope = await adminWriteScope(me);
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

  // "Assigned" is the commitment to a mentor: the grant, or the open agenda's
  // budget where work was planned past it — never their sum, since a task born
  // of a grant is funded by it. Keep the raw allocation on the entry because
  // its editor and the completed/remaining math still act on that row.
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
    enrollments
      .filter((e) => e.program.tracksPayment && !e.program.hourBank)
      .map((e) => e.programId)
  );
  const tracksPayment = paymentPrograms.size > 0;
  // A bank is changed by admins only: leaders and sales staff of the program
  // read it, and get no controls on it.
  const bankAdmin = new Set(
    (
      await Promise.all(
        enrollments
          .filter((e) => e.program.hourBank)
          .map(async (e) =>
            manages && (await staffLevel(me, e.programId)) === "ADMIN" ? e.programId : null
          )
      )
    ).filter((v): v is string => v !== null)
  );
  // Back to where the reader came from. A program's roster names itself in the
  // link (`?from=`), and only then is the program the way back. Otherwise it is
  // the reader's own list: Students for an admin, Home for a mentor — whose
  // caseload lives there, and who has no Students in their navigation. It used
  // to guess a program the student was in, so an admin arriving from /students
  // was offered "← Global Admissions Program", a page they had never been on.
  const administered = enrollments.filter((e) => scopeCovers(scope, e.programId));
  const backProgram = from ? administered.find((e) => e.programId === from) : undefined;
  const mentorLens = !manages || lens === "mentor";
  const back = backProgram
    ? { href: `/programs/${backProgram.programId}`, label: backProgram.program.name }
    : mentorLens
      ? { href: "/mentor", label: "Home" }
      : { href: "/students", label: "Students" };
  // Two primary actions at most, in either lens — the admin's power lives in
  // the ⋮ menus on the rows it belongs to.
  const primaryIsLog = lens === "mentor";

  /**
   * The line the page is opened for, first under the name: how much is left
   * and until when.
   *
   * A mentor reads THEIR balance with this student — "8h remaining with you · use
   * by October 17" — which used to be the last row of a table at the foot of
   * the page, under a progress card summing all three mentors. An admin reads
   * the student's whole balance in the programs they can see, with the soonest
   * date that will take some of it.
   */
  const headline: { figure: string; rest?: string; danger: boolean } | null = (() => {
    if (mentorLens && reaches) {
      const rows = hours.perMentor.filter((m) => m.mentor?.id === me.id);
      if (rows.length === 0) return null;
      const left = rows.reduce((sum, m) => sum + m.remaining, 0);
      const lost = rows.reduce((sum, m) => sum + m.forfeited, 0);
      const soon = soonestExpiry(rows, viewer.now);
      if (left < 0) return { figure: `${formatDuration(-left)} over with you`, danger: true };
      if (left === 0 && lost > 0) {
        return { figure: `${formatDuration(lost)} expired unused`, rest: "with you", danger: true };
      }
      return {
        figure: `${formatDuration(left)} remaining with you`,
        rest: soon ? `use by ${formatDate(soon.date)}` : undefined,
        danger: false,
      };
    }
    if (hours.allotted === 0 && hours.used === 0) return null;
    if (hours.remaining < 0) {
      return { figure: `${formatDuration(-hours.remaining)} over`, danger: true };
    }
    return {
      figure: `${formatDuration(hours.remaining)} remaining`,
      rest: hours.expiring
        ? `${formatDuration(hours.expiring.minutes)} to use by ${formatDate(hours.expiring.date)}`
        : undefined,
      danger: false,
    };
  })();

  // The warning about logging against time that is gone — said once, as a
  // callout with its glyph, rather than a bare amber sentence under the title.
  const logWarns = Boolean(mine && (mine.expired || mine.remaining < 0));

  const logButton = reaches ? (
    <LinkButton
      key="log"
      href={`/sessions/new?student=${profile.id}`}
      variant={primaryIsLog ? "primary" : "secondary"}
      size="md"
      // The one control on the page that spends the student's hours, marked by
      // a filament of the colour those hours are drawn in.
      className="liquid-edge"
      {...(canLog ? {} : { "aria-disabled": true, title: logReason })}
    >
      {enrollments.length > 0 && enrollments.every((e) => e.program.classHours)
        ? "Log an hour for this group"
        : "Log a session"}
    </LinkButton>
  ) : null;
  const allocateButton =
    writes && mentorOptions.length > 0 ? (
      // The admin lens's one primary action, as logging is the mentor's: a
      // masthead of two grey buttons had no answer to "what is this page for".
      <LinkButton
        key="allocate"
        href={`/students/${profile.id}/allocate${from ? `?from=${from}` : ""}`}
        variant={primaryIsLog ? "secondary" : "primary"}
        size="md"
      >
        Allocate time
      </LinkButton>
    ) : null;
  // The primary is always LAST — the right end, where every page keeps it. The
  // mentor lens put its primary first and the program page put its own last,
  // so the same two buttons swapped places between pages.
  const headerButtons = primaryIsLog ? [allocateButton, logButton] : [logButton, allocateButton];

  return (
    <div className="space-y-4">
      <PageTitle
        backHref={back.href}
        backLabel={back.label}
        // The programs, and nothing else. "Student ·" in front of them said
        // what the back-link two lines above already says, on a page whose
        // subject is a person with their face beside their name.
        // Not when the back link already says the same thing: from a program's
        // page the two lines read the program name twice, one under the other.
        eyebrow={
          enrollmentsLabel(enrollments) === back.label ? undefined : enrollmentsLabel(enrollments)
        }
        // The mentor's page opens with their face; the student's opened with
        // nothing, on the same data model. A person's own page is the one place
        // identity is unambiguously the subject.
        leading={
          <Avatar
            person={{
              id: profile.userId,
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
            {(writes || reaches) && (
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
            {headline && (
              <span className="mb-0.5 block text-body">
                <span
                  className={
                    headline.danger ? "font-semibold text-danger-ink" : "font-semibold text-ink"
                  }
                >
                  {headline.figure}
                </span>
                {headline.rest && <> · {headline.rest}</>}
              </span>
            )}
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
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            {isPending && writes && (
              <ApproveStudentButtons studentProfileId={profile.id} />
            )}
            {headerButtons}
          </div>
        }
      />

      {reaches && logReason && (
        // When the log would add to an overdraw it is a warning, and it reads
        // as one: a callout with its glyph. A bare amber sentence under the
        // title was the easiest thing on the page to scroll past, and colour
        // alone said it was a warning at all.
        logWarns ? (
          <Callout tone="warn" row>
            {logReason}
          </Callout>
        ) : (
          <p className="text-sm text-muted-fg">{logReason}</p>
        )
      )}

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
        banks={timeByMentor.filter((entry) => entry.bank)}
        // The pinned bank row is where the balance is read, so it is where an
        // admin corrects it — the same ⋮ its "Time by mentor" row carries:
        // total, use-by, removal. `bankAdmin` is the action's own rule, so the
        // menu is the affordance for a gate that will agree with it.
        renderBankActions={(bank) =>
          bank.deadline && bankAdmin.has(bank.program.id) ? (
            <AllocationRowActions
              bank
              studentProfileId={profile.id}
              programId={bank.program.id}
              mentorId=""
              mentorLabel="the hour bank"
              currentMinutes={bank.allocated}
              currentDeadline={toDateInputValue(bank.deadline)}
            />
          ) : null
        }
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
          writes || session.mentorId === me.id ? (
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
              canDelete={writes}
              student={name}
              mentor={session.mentor.name ?? session.mentor.email}
            />
          ) : null
        }
        renderAgendaActions={(task) =>
          writes || task.mentorId === me.id ? (
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
              canDelete={writes}
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
        // The same pair again, and for the same reason: the mentor is who
        // reads the draft. A student's own claim is still theirs to make on
        // their home page — this is the person who just sat with them saying
        // where the work actually got to, rather than a row that says 0% until
        // somebody remembers to tap.
        renderTaskProgress={(task) =>
          ownsTask({ programId: task.programId, mentorId: task.mentor.id }) ? (
            <TaskProgressControl
              taskId={task.id}
              percent={task.percent}
              done={task.completedAt != null}
              mine={false}
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
      {/* A titled card only when there is a placement to list. With none it
          was a whole section to say "Nobody has lent … to another program";
          the one thing left to do — lend them — is now the last row of "Time
          by mentor" below, beside the hours it would add to. */}
      {exchanges.length > 0 && (
        <Section title="Exchange" count={exchanges.length}>
          <ExchangeList exchanges={exchanges} viewer={viewer} canReturn={isParty} />
          {sendForm && (
            <div className="border-t border-line px-4 py-3 sm:px-5">{sendForm}</div>
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
              writes
                ? (entry) =>
                    entry.deadline && (!entry.bank || bankAdmin.has(entry.program.id)) ? (
                      <AllocationRowActions
                        bank={entry.bank}
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
                        // In date and unspent is what a transfer can move;
                        // `remaining` is already zero once a deadline passes.
                        unusedMinutes={Math.max(0, entry.remaining)}
                        transferTo={mentorOptions.filter(
                          (m) => m.value !== entry.mentor?.id && m.value !== me.id
                        )}
                      />
                    ) : null
                : undefined
            }
            // No pencil beside Assigned: the row's ⋮ already changes the total,
            // the use-by date and removal. Two controls for one edit on every
            // row, and the pencil pushed the figures 28px off their heading.
          />
        )}

        {exchanges.length === 0 && sendForm && (
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-line px-4 py-3 sm:px-5">
            {sendForm}
          </div>
        )}

        {manages && changes.length > 0 && (
          <div className="border-t border-line px-4 sm:px-5">
            {/* The last row of the group, folded: who changed a grant and to
                what is asked after something looks wrong, not on every visit. */}
            <Disclosure label="History" count={changes.length}>
              <ul className="divide-y divide-line text-xs">
                {changes.map((c) => (
                  <li key={c.id} className="flex flex-wrap gap-x-2 py-2">
                    <span className="tabular-nums text-muted-fg">
                      {formatDate(c.createdAt)}
                    </span>
                    <span>
                      {c.changedBy.name ?? c.changedBy.email} set{" "}
                      {c.mentor ? (
                        <PersonChip person={c.mentor} size="sm" href={`/mentors/${c.mentor.id}`} />
                      ) : enrollments.some((e) => e.programId === c.programId && e.program.hourBank) ? (
                        "the hour bank"
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
        // No "Admin only" eyebrow: a reader who is not an admin never sees
        // this group, so the label only ever told an admin what they are.
        <Section title="Details">
          <div className="px-4 sm:px-5">
            <FactList
              items={[
                {
                  label: "Sign-in email",
                  value: profile.user.email,
                  change: writes ? (
                    <StudentEmailChange
                      studentProfileId={profile.id}
                      currentEmail={profile.user.email}
                    />
                  ) : undefined,
                },
                {
                  label: enrollments.length === 1 ? "Program" : "Programs",
                  value: enrollmentsLabel(enrollments, "Not in any program"),
                  change: writes ? (
                    <StudentPrograms
                      studentProfileId={profile.id}
                      programs={toProgramOptions(programs)}
                      enrollments={enrollments.map((e) => ({
                        id: e.id,
                        programId: e.programId,
                        levelId: e.levelId,
                        cohortId: e.cohortId,
                        label: enrollmentLabel(e),
                      }))}
                    />
                  ) : undefined,
                },
                {
                  label: "Folder",
                  value: profile.folderUrl ?? "Not set",
                  change: writes ? (
                    <StudentFolderChange
                      studentProfileId={profile.id}
                      currentFolderUrl={profile.folderUrl}
                    />
                  ) : undefined,
                },
                {
                  label: "Telegram",
                  value: handle
                    ? `@${handle}`
                    : "Not set — they add it on first sign-in",
                  change: writes ? (
                    <StudentTelegramChange
                      studentProfileId={profile.id}
                      currentHandle={handle}
                    />
                  ) : undefined,
                },
                { label: "Registered", value: formatDate(profile.createdAt) },
                {
                  label: "Approval",
                  value: isPending ? "Waiting for approval" : "Approved",
                },
              ]}
            />
          </div>
          {writes && (
            <div className="border-t border-line px-4 py-2 sm:px-5">
              {/* Last, and quiet: a red word with its reason beside it, not an
                  outlined red box at the foot of the page's calmest group. */}
              <RemoveStudentButton
                studentProfileId={profile.id}
                name={name}
                hasSessions={ledger.sessions.some((s) => s.status !== SESSION_STATUS.VOIDED)}
              />
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
