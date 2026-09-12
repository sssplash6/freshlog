import Link from "next/link";

import { ExpandableText } from "@/components/expandable-text";
import { PersonChip } from "@/components/person-chip";
import { Rating } from "@/components/rating";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "@/components/ui/status-chip";
import { SessionRowActions } from "@/components/forms/session-forms";
import { ArrowLink } from "@/components/ui/link";
import { Section } from "@/components/ui/section";
import {
  attendanceOf,
  chargesAllocation,
  SESSION_STATUS,
  timeKindOf,
} from "@/lib/constants";
import { cn } from "@/lib/cn";
import {
  formatDate,
  formatDuration,
  formatMinutes,
  toDateInputValue,
} from "@/lib/format";
import { personTone } from "@/lib/person-tone";
import { sessionStatuses, type ViewerContext } from "@/lib/status";

/**
 * A logged session, wherever one appears.
 *
 * Four renderers drew this row before: the `MeetingsLog` table (mounted on six
 * routes), `LedgerBoard.LoggedMeetingRow`, `StudentJourney`'s rail, and the
 * inline table on `/mentor/sessions`. They agreed on nothing that mattered.
 * The same voided session was 45% opaque in one, 50% in the second and 55% in
 * the third; the same 90 minutes were bold ink in the table and orange in the
 * two lists; and each of the four re-derived its own chips — three off
 * `ATTENDANCE_META` plus a hand-written "Voided, time returned", and
 * `StudentJourney` off a fourth set written out inline in the student's voice.
 * Two vocabularies for one fact, kept in step by hand: the day somebody edits
 * `ATTENDANCE_META`, the student's page keeps saying the old thing.
 *
 * The shape differs by where the row is read; the facts never do. So one
 * component with three variants, and no variant chooses a word or a colour:
 * `sessionStatuses` supplies both, already in this reader's voice. A plain
 * attended in-plan session gets NO chip, which is what finally removes the
 * green "Logged" badge that sat on every row of every log.
 *
 *   log       the ledger — /sessions. TWO LINES, at every width: who and how
 *             long on the first, what it was about on the second.
 *   timeline  a student reading their own history: mentor leads, date is a
 *             marker down a rail (the one thing StudentJourney had right)
 *   line      one sentence, read-only: "Aug 30 · Malika logged 90 min…"
 *
 * `log` replaced a six-column `<table>`, and the reason is what that table did
 * on a phone: `Table` stacks a row into one labelled line per column, so a
 * single logged session was DATE / STUDENT · MENTOR / DURATION / TASK / NOTES
 * — eight lines and about 500px, one session per screenful. On a laptop it was
 * three lines, because the student sat above the mentor and a clamped note ran
 * to two more. The facts are the same; they are laid out to be scanned now
 * rather than tabulated.
 */

type RowPerson = {
  id: string;
  name: string | null;
  email: string;
  avatarUpdatedAt?: Date | null;
  /** Their page, when this reader may open it. Was `mentorBase` + string maths. */
  href?: string;
};

/**
 * Structural, not Prisma-derived: the same row serves one student's ledger, one
 * mentor's log and the cross-program staff ledger, which are three queries with
 * three shapes. The fields are exactly what a row shows plus the four
 * (`attended`, `late`, `status`, `withinPlan`) that `sessionStatuses` and
 * `chargesAllocation` read — nothing here is recomputed from raw columns.
 */
export type SessionEntry = {
  id: string;
  /** A calendar date at UTC midnight: a session records a day, not an instant. */
  date: Date;
  minutes: number;
  attended: boolean;
  late: boolean;
  /** `SESSION_STATUS`. */
  status: string;
  /** False = given out of plan: delivered, but charged to no allocation. */
  withinPlan: boolean;
  note: string | null;
  /** `SESSION_ANSWER`, or null while the student has not answered. */
  studentAnswer?: string | null;
  /** 1-5 on this meeting, when they left one. */
  studentRating?: number | null;
  /** Their words: what was wrong, or what was good. */
  studentNote?: string | null;
  mentor: RowPerson;
  /** Present only on a log that spans students. */
  student?: (RowPerson & { program?: string | null }) | null;
  /** The task this session went toward; null when none was named. */
  task?: { id: string; purpose: string } | null;
  /**
   * `line` only, and usually the ledger with this row's anchor. A session has
   * no page of its own, so the table and timeline rows stay inert and their
   * people carry the links.
   */
  href?: string;
};

/**
 * Which facts a row carries. `notes` brings the exception chips with it — they
 * are a property of what happened, not a field of their own, and giving them
 * one was how `/mentor/sessions` reached nine stacked lines on a phone.
 */
export type SessionColumn =
  | "date"
  | "student"
  | "mentor"
  | "duration"
  | "task"
  | "notes"
  /** The row's edit menu. `SessionsList` adds it when any row has one. */
  | "actions";

const DEFAULT_COLUMNS: SessionColumn[] = [
  "date",
  "student",
  "mentor",
  "duration",
  "task",
  "notes",
];

const nameOf = (person: RowPerson) => person.name ?? person.email;

export function SessionRow({
  session,
  viewer,
  variant = "log",
  columns = DEFAULT_COLUMNS,
  actions,
  index,
}: {
  session: SessionEntry;
  /** Whose words the chips are in. Never who may act — that is `lib/authz.ts`. */
  viewer: ViewerContext;
  variant?: "log" | "timeline" | "line";
  /** `log` only. Ignored by the two list shapes, which show every fact. */
  columns?: SessionColumn[];
  /** Edit · Void · Delete · Rate — already resolved for this reader. */
  actions?: React.ReactNode;
  /** Position in the list, for the entrance stagger and nothing else. */
  index?: number;
}) {
  const { id, date, minutes, note, mentor, student, task, href } = session;
  const statuses = sessionStatuses(session, viewer);
  const voided = session.status === SESSION_STATUS.VOIDED;
  // The one question the row's typography answers: did these minutes move a
  // balance? A voided, rescheduled or out-of-plan session was still time
  // somebody spent, so the number stays legible and is struck instead of hidden.
  const charged = chargesAllocation(session);
  // Voided rows stay in the log — the hours went back, the history did not. They
  // quieten to muted ink rather than to 45% opacity, which is what the three
  // renderers before this did: opacity fades a token past the contrast it was
  // chosen for, while `text-muted-fg` is a tone that was measured.
  const textTone = voided ? "text-muted-fg" : "text-ink";
  // The receipt on `/sessions/new` links to a row by id, so a mentor who reads
  // "90 min" and meant 60 lands on their own line with its menu in front of them.
  const anchor = `session-${id}`;
  const stagger =
    index == null ? undefined : { animationDelay: `${Math.min(index, 14) * 24}ms` };

  const chips =
    statuses.length > 0 ? (
      <span className="flex flex-wrap gap-1.5">
        {statuses.map((s) => (
          <StatusChip key={s.type} status={s} />
        ))}
      </span>
    ) : null;

  // Size is deliberately absent: the number inherits it from whichever row it
  // lands in. Colour is absent too — hours are orange only as a `Figure` of
  // 24px and up, because #f18d05 is 2.46:1 on white and the two list renderers
  // this replaces both painted a 13px duration in it.
  const duration = (
    <span
      className={cn(
        "tabular-nums",
        charged ? "font-semibold text-ink" : "text-muted-fg line-through",
      )}
    >
      {formatMinutes(minutes)}
    </span>
  );

  if (variant === "line") {
    const summary = (
      <>
        <span className="font-medium text-ink">{nameOf(mentor)}</span> logged {duration}
        {student && (
          <>
            {" "}
            with <span className="font-medium text-ink">{nameOf(student)}</span>
          </>
        )}
      </>
    );

    return (
      <li
        id={anchor}
        className={cn(
          "flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5 text-[0.8125rem] text-muted-fg sm:px-5",
          index != null && "deal-in",
        )}
        style={stagger}
      >
        <span className="tabular-nums">{formatDate(date)}</span>
        <Separator />
        {href ? (
          <Link href={href} className="min-w-0 hover:text-brand">
            {summary}
          </Link>
        ) : (
          <span className="min-w-0">{summary}</span>
        )}
        {student?.program && (
          <>
            <Separator />
            <span className="min-w-0 truncate">{student.program}</span>
          </>
        )}
        {chips}
      </li>
    );
  }

  if (variant === "timeline") {
    return (
      <li
        id={anchor}
        className={cn("group flex gap-4 pb-3 last:pb-0", index != null && "deal-in")}
        style={stagger}
      >
        {/* The rail: a dot in the mentor's own hue, so a run of sessions with
            one person reads as a run, joined by a hairline that stops itself at
            the last entry — `group-last` rather than an `isLast` prop, which
            existed only because a row could not see its own position. */}
        <div aria-hidden="true" className="flex flex-col items-center">
          <span
            className={cn(
              "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-surface",
              voided ? "bg-line" : personTone(mentor.id).badge,
            )}
          />
          <span className="mt-1 w-px flex-1 bg-line group-last:hidden" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8125rem]">
            <PersonChip person={mentor} size="sm" href={mentor.href} />
            <span className="tabular-nums text-muted-fg">{formatDate(date)}</span>
            {duration}
            {/* On the header line, not under the row. A pencil on a line of
                its own is a whole row of height per session, down a ledger
                that is read by scrolling. */}
            {actions && <span className="ml-auto shrink-0">{actions}</span>}
          </div>
          {task && (
            <div className="mt-1.5">
              <ExpandableText
                text={task.purpose}
                lines={2}
                className={cn("text-[0.8125rem] font-medium", textTone)}
              />
            </div>
          )}
          {/* Folded, not clamped. `Disclosure`'s own doctrine sends free text
              to `ExpandableText` instead — and that is what this was — but two
              lines of prose per row, down a ledger of forty sessions, is still
              eighty lines of prose between a reader and the next date. The
              summary says whether there is a note at all, so nothing is hidden
              that the reader did not already know was there.

              Native `<details>`: keyboard and screen-reader behaviour arrive
              free, it works before hydration, and find-in-page opens it. */}
          {note && (
            <details className="group/note mt-1">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-muted-fg transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
                <span
                  aria-hidden="true"
                  className="text-[0.5625rem] transition-transform group-open/note:rotate-90"
                >
                  ▸
                </span>
                note
              </summary>
              <p className={cn("mt-1 whitespace-pre-line text-[0.9375rem]", textTone)}>
                {note}
              </p>
            </details>
          )}
          {/* What the student said back. It sits under the mentor's own note
              on purpose: the row reads as the record, then the answer to it. */}
          {session.studentAnswer && (session.studentRating || session.studentNote) && (
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[0.8125rem]">
              {session.studentRating ? <Rating value={session.studentRating} /> : null}
              {session.studentNote && (
                <span className="min-w-0 text-muted-fg">
                  &ldquo;{session.studentNote}&rdquo;
                </span>
              )}
            </div>
          )}
          {chips && <div className="mt-1">{chips}</div>}
        </div>
      </li>
    );
  }

  // ------------------------------------------------------------------ log
  //
  // Two lines, at every width, and the second one only when it has something
  // on it. Line 1 is who and how long — the two facts you scan a ledger by.
  // Line 2 is what it was about, one line of it, unfoldable in place.
  const showStudent = columns.includes("student") && Boolean(student);
  const showMentor = columns.includes("mentor");
  const showTask = columns.includes("task") && Boolean(task);
  const showNote = columns.includes("notes") && Boolean(note);
  const secondLine = showTask || showNote || chips || student?.program;

  return (
    <li
      id={anchor}
      className={cn(
        "group/row px-3 py-1.5 transition-colors hover:bg-canvas sm:px-4",
        index != null && "deal-in",
      )}
      style={stagger}
    >
      <div className="flex items-center gap-2">
        {/* A fixed column from `sm` up, so a ledger of forty rows has its
            names starting in one place; auto below it, where 96px of mostly
            empty date would come out of the names themselves. */}
        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-fg sm:w-24">
          {formatDate(date)}
        </span>
        {/* Both people on ONE line. The student led the mentor by a line break
            in the table this replaces, which read as two facts and cost every
            row its second line. `min-w-0` is what lets each chip truncate
            instead of the pair wrapping. */}
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {/* Half each when both are here, and the cap lives on a WRAPPER
              rather than on the chip: `cn` joins classes without resolving
              conflicts, so a `max-w` passed to `PersonChip` lands beside its
              own `max-w-full` and loses. The cap matters because flexbox
              shrinks BOTH pills when the pair overflows — at 390px "Sitora"
              was being cut to "S…" to buy room for a mentor with a long name.
              Capped, the pair can never overflow, so a short name is never
              shortened at all, and the long one ellipses its own label. */}
          {showStudent && student && (
            <span className={cn("min-w-0", showMentor && "max-w-[50%]")}>
              <PersonChip person={student} size="sm" href={student.href} />
            </span>
          )}
          {showMentor && (
            <span
              className={cn("min-w-0", showStudent && student && "max-w-[50%]")}
            >
              <PersonChip person={mentor} size="sm" href={mentor.href} />
            </span>
          )}
        </span>
        <span className="shrink-0 text-[0.8125rem]">{duration}</span>
        {actions && <span className="shrink-0">{actions}</span>}
      </div>

      {secondLine && (
        <div className="mt-px flex min-w-0 items-baseline gap-1.5 text-[0.8125rem] leading-snug">
          {showTask && task && (
            <span className={cn("max-w-[45%] shrink-0 truncate font-medium", textTone)}>
              {task.purpose}
            </span>
          )}
          {showNote && note && (
            <ExpandableText
              text={note}
              lines={1}
              className={cn("min-w-0 flex-1", voided ? "text-muted-fg" : "text-muted-fg")}
            />
          )}
          {student?.program && (
            <span className="max-w-32 shrink-0 truncate text-xs text-muted-fg">
              {student.program}
            </span>
          )}
          {chips}
        </div>
      )}
    </li>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-muted-fg">
      ·
    </span>
  );
}

/**
 * The ledger: sessions as a table, and nothing else.
 *
 * `MeetingsLog` owned a whole panel — title, eyebrow, caption, `moreHref`,
 * `moreLabel` — which is eight props of chrome `Section` already provides, and
 * which is why the same log carried five different headings across six routes.
 * A caller that wants a titled region wraps this in a `Section`.
 *
 * It also computed its own tally ("3 meetings · 2h 30m · 1h extra") from the
 * rows it happened to be handed. On a paginated ledger that is a sentence about
 * page 1 pretending to be about the ledger, so it is gone: totals belong to the
 * query that can see the whole filtered set. When two renderers disagree about
 * a number, delete the one that recomputes it.
 */
/**
 * A session as the database hands it over, at any of the six places one is
 * read. Structural for the same reason `SessionEntry` is — three queries, three
 * shapes — and separate from it because this is what callers HAVE and that is
 * what the row NEEDS.
 */
export type LoggedSession = {
  id: string;
  minutes: number;
  date: Date;
  attended: boolean;
  late: boolean;
  note: string | null;
  status: string;
  withinPlan: boolean;
  studentAnswer?: string | null;
  studentRating?: number | null;
  studentNote?: string | null;
  mentor: { id: string; name: string | null; email: string; avatarUpdatedAt?: Date | null };
  student?: {
    id: string;
    user: { name: string | null; email: string; avatarUpdatedAt?: Date | null };
    program?: { name: string } | null;
  } | null;
  assignment?: { id: string; purpose: string } | null;
};

/**
 * Rows, with the links this reader is entitled to.
 *
 * Bases rather than functions: a page hands these to a component tree that may
 * cross into a client component, and a function cannot make that crossing — it
 * type-checks, it builds, and it throws at render.
 */
export function toSessionEntries(
  sessions: readonly LoggedSession[],
  links: { mentorBase?: string; studentBase?: string } = {}
): SessionEntry[] {
  return sessions.map((s) => ({
    id: s.id,
    date: s.date,
    minutes: s.minutes,
    attended: s.attended,
    late: s.late,
    status: s.status,
    withinPlan: s.withinPlan,
    note: s.note,
    studentAnswer: s.studentAnswer ?? null,
    studentRating: s.studentRating ?? null,
    studentNote: s.studentNote ?? null,
    mentor: {
      id: s.mentor.id,
      name: s.mentor.name,
      email: s.mentor.email,
      avatarUpdatedAt: s.mentor.avatarUpdatedAt,
      href: links.mentorBase ? `${links.mentorBase}/${s.mentor.id}` : undefined,
    },
    student: s.student
      ? {
          id: s.student.id,
          name: s.student.user.name,
          email: s.student.user.email,
          avatarUpdatedAt: s.student.user.avatarUpdatedAt,
          program: s.student.program?.name ?? null,
          href: links.studentBase
            ? `${links.studentBase}/${s.student.id}`
            : undefined,
        }
      : null,
    task: s.assignment ?? null,
  }));
}

/**
 * What a log of these adds up to, for the caption above it.
 *
 * Voided and rescheduled rows are history, not hours, and out-of-plan time is
 * named beside the total rather than folded into it — a caption that added
 * them together would disagree with the balance on the same page.
 */
export function sessionsCaption(sessions: readonly SessionEntry[]): string {
  const active = sessions.filter((s) => s.status === SESSION_STATUS.ACTIVE);
  if (active.length === 0) return "Nothing logged yet";
  const logged = active
    .filter(chargesAllocation)
    .reduce((sum, s) => sum + s.minutes, 0);
  const extra = active
    .filter((s) => !s.withinPlan)
    .reduce((sum, s) => sum + s.minutes, 0);
  return `${active.length} meeting${active.length === 1 ? "" : "s"} · ${formatDuration(logged)}${
    extra > 0 ? ` · ${formatDuration(extra)} extra` : ""
  }`;
}

/**
 * The ledger: two-line rows, and nothing around them.
 *
 * It was `SessionsTable` and it rendered a `<table>`; see the note at the top
 * of this file for what that cost on a phone. What survives the change is the
 * part that was actually load-bearing — which facts a row carries is decided
 * ONCE here, for the whole list, rather than per row: a mentor's own log does
 * not repeat their name down the page, and a student's ledger does not carry a
 * Student column of one value.
 */
export function SessionsList({
  sessions,
  viewer,
  columns = DEFAULT_COLUMNS,
  renderActions,
  framed = true,
  empty,
  className,
}: {
  sessions: SessionEntry[];
  viewer: ViewerContext;
  columns?: SessionColumn[];
  /**
   * A row's own menu. A function because the answer is per row — a mentor may
   * correct their own lines, an admin anyone's — and returning nothing for
   * every row drops the column instead of leaving an empty one.
   */
  renderActions?: (session: SessionEntry) => React.ReactNode;
  framed?: boolean;
  /** Pass an `EmptyState variant="no-results"` when a filter did the emptying. */
  empty?: React.ReactNode;
  className?: string;
}) {
  if (sessions.length === 0) {
    return (
      empty ?? (
        <EmptyState framed={framed} title="No sessions logged">
          A mentor logs each meeting once it has happened.
        </EmptyState>
      )
    );
  }

  const rowActions = sessions.map((s) => renderActions?.(s));
  const withActions = rowActions.some(Boolean);

  // A person earns their place on the row only when the rows span more than
  // one of them.
  const spansMentors = new Set(sessions.map((s) => s.mentor.id)).size > 1;
  const hasStudent = columns.includes("student") && sessions.some((s) => s.student);
  const resolved: SessionColumn[] = columns.filter((c) => {
    if (c === "student") return hasStudent;
    // Never both dropped: a row with no person on it is unreadable.
    if (c === "mentor") return spansMentors || !hasStudent;
    return c !== "actions";
  });
  if (withActions) resolved.push("actions");

  return (
    <ul
      className={cn(
        "divide-y divide-line/60",
        framed && "overflow-hidden rounded-xl border border-line bg-surface shadow-sm",
        className,
      )}
    >
      {sessions.map((session, i) => (
        <SessionRow
          key={session.id}
          session={session}
          viewer={viewer}
          columns={resolved}
          actions={rowActions[i]}
          index={i}
        />
      ))}
    </ul>
  );
}

/**
 * Who is reading, and therefore which rows they may change. A mentor may
 * correct and void their own; an admin may do both to anyone's in a program
 * they administer, and is the only one who can delete a row outright.
 */
export type ManageSessions = {
  actorId?: string;
  isAdmin?: boolean;
  /**
   * sessionId → the tasks THAT row could be attached to (its own mentor's, for
   * its own student). Keyed per session because a log can span both — see
   * queries.ts#taskOptionsForSessions.
   */
  tasksBySession?: Record<string, { value: string; label: string }[]>;
};

/**
 * A log of sessions under a heading: what `MeetingsLog` was, in a fifth of the
 * lines, because the row and its words are no longer this component's problem.
 *
 * It exists rather than four call sites composing a Section and a table
 * themselves, for the same reason the row does: the caption is a figure, and a
 * figure written four times is four chances to say something different from
 * the balance on the same page.
 */
export function SessionsLog({
  sessions,
  viewer,
  title = "Meetings log",
  eyebrow = "Logged by mentors",
  caption,
  empty,
  manage,
  moreHref,
  moreLabel = "All sessions",
}: {
  sessions: SessionEntry[];
  viewer: ViewerContext;
  title?: string;
  eyebrow?: React.ReactNode;
  /** Overrides the tally, for rows that are a slice of a wider set. */
  caption?: React.ReactNode;
  empty?: React.ReactNode;
  manage?: ManageSessions;
  moreHref?: string;
  moreLabel?: string;
}) {
  const tally = caption ?? sessionsCaption(sessions);

  // Correcting is for rows that still count and belong to the reader (any row,
  // if they administer the program). Deleting is theirs alone, and applies to a
  // voided row too: those hours are already back, but the line is still in the
  // log, and a line that should never have been there should be removable.
  const canEdit = (s: SessionEntry) =>
    Boolean(manage) &&
    s.status !== SESSION_STATUS.VOIDED &&
    (manage?.isAdmin === true || s.mentor.id === manage?.actorId);
  const canDelete = manage?.isAdmin === true;

  return (
    <Section
      eyebrow={eyebrow}
      title={title}
      action={
        moreHref ? (
          <span className="flex items-center gap-3 text-xs text-muted-fg">
            {tally}
            <ArrowLink href={moreHref} className="text-xs">
              {moreLabel}
            </ArrowLink>
          </span>
        ) : undefined
      }
      caption={tally}
    >
      <SessionsList
        sessions={sessions}
        viewer={viewer}
        framed={false}
        empty={
          empty ?? (
            <EmptyState framed={false} title="No meetings logged yet">
              A mentor logs each meeting once it has happened.
            </EmptyState>
          )
        }
        renderActions={(s) =>
          canEdit(s) || canDelete ? (
            <SessionRowActions
              session={{
                id: s.id,
                minutes: s.minutes,
                date: toDateInputValue(s.date),
                attendance: attendanceOf(s),
                timeKind: timeKindOf(s),
                note: s.note,
                assignmentId: s.task?.id ?? null,
              }}
              goals={manage?.tasksBySession?.[s.id] ?? []}
              canEdit={canEdit(s)}
              canDelete={canDelete}
            />
          ) : null
        }
      />
    </Section>
  );
}
