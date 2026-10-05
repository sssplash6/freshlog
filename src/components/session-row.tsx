"use client";

import Link from "next/link";

import { ExpandableNote } from "@/components/expandable-note";
import { ExpandableText } from "@/components/expandable-text";
import { PersonChip } from "@/components/person-chip";
import { Rating } from "@/components/rating";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "@/components/ui/status-chip";
import { SessionRowActions } from "@/components/forms/session-forms";
import { SessionLiveProvider, useLiveSession } from "@/components/session-live-context";
import { ArrowLink } from "@/components/ui/link";
import { Section } from "@/components/ui/section";
import {
  attendanceOf,
  chargesAllocation,
  SESSION_STATUS,
  timeKindOf,
} from "@/lib/constants";
import { cn } from "@/lib/cn";
import { formatDate, formatMinutes, toDateInputValue } from "@/lib/format";
import { sessionsCaption } from "@/lib/session-entries";
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
 *   log       the ledger — /sessions. An iOS list row: who and how long on
 *             the first line, when and what it was about on the second.
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
  footer,
  index,
  chipSlot = false,
}: {
  session: SessionEntry;
  /** Whose words the chips are in. Never who may act — that is `lib/authz.ts`. */
  viewer: ViewerContext;
  variant?: "log" | "timeline" | "line";
  /** `log` only. Ignored by the two list shapes, which show every fact. */
  columns?: SessionColumn[];
  /** Edit · Void · Delete · Rate — already resolved for this reader. */
  actions?: React.ReactNode;
  /**
   * Content pinned under the row — the student's "Did this happen?" form on
   * /student/meetings. Rendered by the `timeline` and `log` variants; `line`
   * stays a single sentence and ignores it.
   */
  footer?: React.ReactNode;
  /** Position in the list, for the entrance stagger and nothing else. */
  index?: number;
  /** `log` only: reserve the chip column, because some row in this list has a chip. */
  chipSlot?: boolean;
}) {
  return (
    <SessionLiveProvider initialSession={session}>
      <SessionRowContent
        session={session}
        viewer={viewer}
        variant={variant}
        columns={columns}
        actions={actions}
        footer={footer}
        index={index}
        chipSlot={chipSlot}
      />
    </SessionLiveProvider>
  );
}

function SessionRowContent({
  session,
  viewer,
  variant = "log",
  columns = DEFAULT_COLUMNS,
  actions,
  footer,
  index,
  chipSlot = false,
}: {
  session: SessionEntry;
  viewer: ViewerContext;
  variant?: "log" | "timeline" | "line";
  columns?: SessionColumn[];
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  index?: number;
  chipSlot?: boolean;
}) {
  const live = useLiveSession()?.session;
  session = live ?? session;
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
          // The timeline is the student's own history, read on a phone —
          // where a `title` tooltip never appears — so the reason a session
          // cost what it cost is printed, not hovered.
          <StatusChip key={s.type} status={s} explain={variant === "timeline"} />
        ))}
      </span>
    ) : null;

  // Size is deliberately absent: the number inherits it from whichever row it
  // lands in. Colour is absent too — hours are orange only as a `Figure` of
  // 24px and up, because #f18d05 is 2.46:1 on white and the two list renderers
  // this replaces both painted a 13px duration in it.
  //
  // STRUCK ONLY WHEN VOIDED (October 2026). Extra and rescheduled time used to
  // wear the same strike as a voided row, but extra time HAPPENED — a strike
  // reads as "this did not count", which is only true of a void. Uncharged
  // time is muted; its chip says why.
  const duration = (
    <span
      className={cn(
        "tabular-nums",
        charged
          ? "font-semibold text-ink"
          : voided
            ? "text-muted-fg line-through"
            : "text-muted-fg",
      )}
    >
      {formatMinutes(minutes)}
    </span>
  );

  // ANONYMOUS TO MENTORS. `/feedback` tells a mentor "Students' names are
  // never shown to you", and a rating printed on a session row beside the
  // student's name broke that promise on every student page. A mentor reads
  // the record; what the student said about it is for the student and staff.
  const showFeedback = viewer.audience !== "mentor";
  // The viewer's own name on their own log is the one name the row need not
  // carry: "Dilnoza Yusupova" five times down Dilnoza's student page.
  const showMentorChip = mentor.id !== viewer.userId;

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
          "flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-3 text-[0.8125rem] text-muted-fg sm:px-5",
          index != null && "deal-in",
        )}
        style={stagger}
      >
        <span className="tabular-nums">{formatDate(date)}</span>
        <Separator />
        {href ? (
          <Link href={href} transitionTypes={["nav-forward"]} className="min-w-0 hover:text-brand">
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
        // PACKED INSIDE, DISTANCED BETWEEN. One entry's two lines sit two
        // pixels apart and its neighbours ten from its edges, so the eye reads
        // a block and then a gap rather than five lines with rules through
        // them. It was `pb-3 last:pb-0` — space under a row and none above
        // it — so every date sat hard against the hairline above it while the
        // note under it had room to spare, which is the exact inverse.
        className={cn("group py-3", index != null && "deal-in")}
        style={stagger}
      >
        {/* NO RAIL. It was a dot in the mentor's own hue joined by a hairline
            down the column — twenty-six pixels of width and a vertical line
            running through the gap between every pair of rows, tying together
            the entries this list wants read as separate. The colour was the
            second statement of it anyway: the mentor's chip is ten pixels to
            its right, in the same hue, with their name in it. The width goes
            to the agenda item, which is what was wrapping. */}
        <div className="min-w-0 flex-1">
          {/* Date · Mentor · Agenda, on one line, with the minutes and the
              pencil against the right edge — the same shape a task row has,
              because they are the same question twice: WHEN, WHO, WHAT, and
              then the figure. The agenda item had a line of its own under the
              row, which cost every session in the log a second line to say
              one phrase.

              TWO groups, not one wrapping row: the minutes and the pencil sit
              outside the wrap, so a long agenda item rewraps under the date
              and the mentor rather than pushing the figure onto a line by
              itself. */}
          {/* ONE AXIS. The pencil is a 36px target in a 22px line, so the
              row is 36px tall whatever else happens — and with `items-start`
              everything else parked at the top of it while the icon sat
              centred, seven pixels lower. Centring costs no height at all,
              because the button had already set it. */}
          <div className="flex items-center gap-x-2">
            {/* NO WRAPPING. It was `flex-wrap` with the agenda item on a
                160px basis, so whether the item sat on the line or dropped to
                one of its own came down to how long that row's mentor happened
                to be called — five entries, and three different shapes. The
                row has three columns on one line, always.

                The agenda item is `flex-1` on a zero basis, so the leftover
                width is its and the MENTOR is what gives way: a long name
                truncates inside its own chip (capped at 11rem) rather than
                pushing the work this row is about onto another line. */}
            {/* Under `sm` the agenda item takes a line of its own: on a 390px
                screen, squeezed between the date, the mentor and the figure,
                it truncated to a single stray letter ("U"). */}
            <div className="flex min-w-0 flex-1 items-center gap-x-2.5 gap-y-1 text-[0.8125rem] max-sm:flex-wrap">
              {/* Its own width, and no minimum. It was a 96px column, so
                  that "September 30" would fit and every date would start the
                  mentor chip at the same x — which meant "July 30" sat in 55px
                  of text and 40px of nothing, and the gap was the loudest
                  thing on the row. The figure at the other end is the one that
                  earns a fixed column: a ledger is scanned down its numbers,
                  not down the left edge of its names. */}
              <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-fg">
                {formatDate(date)}
              </span>
              {showMentorChip && (
                <span className="flex min-w-0 max-w-44">
                  <PersonChip person={mentor} size="sm" href={mentor.href} />
                </span>
              )}
              {/* ONE LINE, always. An agenda item is capped at 100 characters
                  and is a name rather than a sentence, so the tail an ellipsis
                  eats is the end of "…research as a field" — and a log is read
                  by running down its dates. A row that grows a second line to
                  finish a name costs every row below it a place on the screen.
                  The full text is the element's `title`. */}
              {task && (
                <span
                  title={task.purpose}
                  className={cn(
                    "min-w-0 flex-1 truncate font-medium max-sm:basis-full",
                    textTone,
                  )}
                >
                  {task.purpose}
                </span>
              )}
            </div>
            {/* Right-aligned in a fixed column, so 22, 60 and 180 stack into
                one edge instead of three. It is the only figure on the row and
                a ledger is read by scanning figures. */}
            <span className="flex shrink-0 items-center gap-2 text-[0.8125rem]">
              <span className="w-16 text-right">{duration}</span>
              {/* On the header line, not under the row. A pencil on a line of
                  its own is a whole row of height per session, down a ledger
                  that is read by scrolling. */}
              {actions}
            </span>
          </div>
          {/* One line of the note itself, not the word "note" over a hidden
              copy of it: a ledger of forty sessions should not have to be
              opened row by row to find the one that says "missed an hour, not
              excused". Tapping the line unfolds the rest. */}
          {note && <ExpandableNote text={note} className="mt-0.5" />}
          {/* What the student said back. It sits under the mentor's own note
              on purpose: the row reads as the record, then the answer to it. */}
          {showFeedback && session.studentAnswer && (session.studentRating || session.studentNote) && (
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
          {footer && <div className="mt-2">{footer}</div>}
        </div>
      </li>
    );
  }

  // ------------------------------------------------------------------ log
  //
  // An iOS list row. Line 1 is who and how long — the two facts a ledger is
  // scanned by — with the figure against the right edge in a column of its
  // own. Line 2 is when and what it was about, in one quiet run, clamped and
  // unfoldable in place. The chips, when there are any, come after it.
  //
  // The people are names, not chips. Two avatar pills per row, each in its
  // person's hue, down forty rows, was a column of confetti the eye had to
  // read through to reach the figure; the name is what is read, and it is
  // still the link to their page.
  const showStudent = columns.includes("student") && Boolean(student);
  const showMentor = columns.includes("mentor");
  const showTask = columns.includes("task") && Boolean(task);
  const showNote = columns.includes("notes") && Boolean(note);
  // One string so the clamp can count it as one run: the program when the log
  // spans them, the agenda item, then the note. On a phone the date leads it;
  // from `sm` up the date has a column of its own.
  const topic = [
    student?.program,
    showTask ? task?.purpose : null,
    showNote ? note : null,
  ].filter(Boolean);
  const when = formatDate(date);

  const lead = showStudent && student ? student : showMentor ? mentor : null;
  const second = showStudent && student && showMentor ? mentor : null;

  return (
    <li
      id={anchor}
      className={cn(
        "group/row px-4 py-3 transition-colors sm:px-5 sm:py-2.5 sm:hover:bg-fill/60",
        index != null && "deal-in",
      )}
      style={stagger}
    >
      {/* One line from `sm` up, in fixed columns — WHEN, WHO, WHAT, then the
          figure — so a page of sessions scans down its dates and its minutes
          instead of reading as a wall of two-line blocks. On a phone the same
          facts stack: who and how long, then when and what. */}
      <div className="flex items-start gap-3 sm:items-center">
        <span className="hidden w-24 shrink-0 text-[0.8125rem] tabular-nums text-muted-fg sm:block">
          {when}
        </span>
        <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
          {/* Student · mentor on one line from `sm` up. On a phone the
              two shared one line beside the figure and both truncated until
              neither could be told apart ("Ulugbek Alimuk… · Ulugbek …"),
              so there the mentor drops to a line of their own, introduced
              by "with" since the separator is gone. */}
          {/* A MINIMUM, not a width. Fixed at 24rem, a long double-barrelled
              name truncated ("Dilshodbek Abdurakhmonov-Yulda…") beside four
              hundred pixels of empty note column. Now the people take what
              they need and the topic — the column that can afford to — gives
              way first; with no topic at all, the people take the row. */}
          <div
            className={cn(
              "flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[0.9375rem] leading-snug sm:flex-nowrap sm:text-sm",
              topic.length > 0
                ? second
                  ? "sm:max-w-[60%] sm:shrink-0 sm:basis-auto sm:min-w-[19rem] lg:min-w-[24rem]"
                  : "sm:max-w-[60%] sm:shrink-0 sm:basis-auto sm:min-w-52 lg:min-w-60"
                : "sm:flex-1",
            )}
          >
            {lead && (
              <PersonName
                person={lead}
                className={cn("max-w-full truncate font-medium", textTone)}
              />
            )}
            {second && (
              <span className="flex min-w-0 basis-full items-baseline gap-x-1 text-[0.8125rem] text-muted-fg sm:shrink-[2] sm:basis-auto sm:text-sm">
                <span className="shrink-0">with</span>
                <PersonName person={second} className="min-w-0 truncate" />
              </span>
            )}
          </div>
          {/* The separator is glued to the word AFTER it (a no-break space),
              so a wrap starts the next line with "· note" rather than leaving
              "October 5 ·" dangling at the end of the first. */}
          <ExpandableText
            text={[when, ...topic].join(" · ")}
            lines={2}
            className="mt-0.5 text-[0.8125rem] leading-snug text-muted-fg sm:hidden"
          />
          <div className="hidden min-w-0 flex-1 sm:block">
            {topic.length > 0 && (
              <ExpandableText
                text={topic.join(" · ")}
                lines={1}
                className="text-[0.8125rem] leading-snug text-muted-fg"
              />
            )}
          </div>
          {/* A fixed slot when any row in the list has a chip, right-aligned,
              so "Show more", the chip and the figure land at the same x down
              the page instead of wherever each row's chip happened to end. */}
          {chips ? (
            <div
              className={cn(
                "mt-1.5 sm:mt-0 sm:shrink-0",
                chipSlot && "sm:flex sm:w-48 sm:justify-end",
              )}
            >
              {chips}
            </div>
          ) : (
            chipSlot && <div aria-hidden="true" className="hidden shrink-0 sm:block sm:w-48" />
          )}
        </div>
        {/* The figure in a fixed column so 12, 45 and 150 stack into one
            edge, then the menu — which, on a pointer, waits for the row to
            be hovered or focused rather than repeating down every line. */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <span className="text-[0.9375rem] leading-snug sm:w-16 sm:text-right sm:text-sm">
            {duration}
          </span>
          {actions && (
            <span className="-my-2.5 shrink-0 transition-opacity sm:-my-1 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100 pointer-fine:has-[[aria-expanded=true]]:opacity-100">
              {actions}
            </span>
          )}
        </div>
      </div>

      {footer && <div className="mt-2 sm:pl-28">{footer}</div>}
    </li>
  );
}

/** A name on a log row: the link to their page when this reader may open it. */
function PersonName({
  person,
  className,
}: {
  person: RowPerson;
  className?: string;
}) {
  return person.href ? (
    <Link
      href={person.href}
      transitionTypes={["nav-forward"]}
      className={cn("min-w-0 hover:text-brand", className)}
    >
      {nameOf(person)}
    </Link>
  ) : (
    <span className={cn("min-w-0", className)}>{nameOf(person)}</span>
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
  actions,
  framed = true,
  empty,
  className,
}: {
  sessions: SessionEntry[];
  viewer: ViewerContext;
  columns?: SessionColumn[];
  /**
   * A row's own menu, keyed by session id — the answer is per row, since a
   * mentor may correct their own lines and an admin anyone's, and a record
   * with nothing in it for any row drops the column instead of leaving an
   * empty one.
   *
   * Nodes rather than the `(session) => node` this took until 20 September
   * 2026: this file became a client module when the edit form learnt to
   * autosave, and a function is not something a server component may hand
   * across that boundary. `/sessions` passed one, and every request to it
   * rendered the error boundary.
   */
  actions?: Record<string, React.ReactNode>;
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

  const rowActions = sessions.map((s) => actions?.[s.id]);
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
  const chipSlot = sessions.some((s) => sessionStatuses(s, viewer).length > 0);

  return (
    <ul
      className={cn(
        "divide-y divide-line",
        framed && "overflow-hidden rounded-xl bg-surface shadow-sm",
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
          chipSlot={chipSlot}
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
  title = "Sessions",
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
          <span className="flex items-center gap-3 text-[0.8125rem] text-muted-fg">
            {tally}
            <ArrowLink href={moreHref} className="text-[0.8125rem]">
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
            <EmptyState framed={false} title="No sessions logged yet">
              A mentor logs each meeting once it has happened.
            </EmptyState>
          )
        }
        actions={Object.fromEntries(
          sessions.map((s) => [
            s.id,
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
                student={s.student ? nameOf(s.student) : null}
                mentor={nameOf(s.mentor)}
              />
            ) : null,
          ]),
        )}
      />
    </Section>
  );
}
