import { FolderIcon, SendIcon } from "@/components/icons";

import { PersonCell } from "@/components/person-chip";
import { ProgramChip } from "@/components/program-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { RowFold } from "@/components/ui/row-fold";
import { DeadlineText, StatusChip } from "@/components/ui/status-chip";
import { FILL_CELL, Table, Td, Tr, type Column } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { sortEnrollments } from "@/lib/enrollments";
import { HoursLeft } from "@/components/ui/hours-left";
import { formatDate, formatDaysAgo, formatDuration } from "@/lib/format";
import {
  EXPIRY_WINDOW_DAYS,
  studentStatuses,
  type ViewerContext,
} from "@/lib/status";
import type { StudentWithHours } from "@/lib/queries";

/**
 * The roster: who they are, what they have used, what is left, when they were
 * last seen, and how to reach them.
 *
 * It had eight columns, and two of them — Telegram and Folder — were an
 * em-dash in most rows, so they cost a phone two columns of width to say
 * nothing. They are one Contact cell. `Program` survives, because this list is
 * reached without one as often as with one; `Cohort` folds into it as a muted
 * suffix, since programs are flat by default and the column was empty in all
 * three.
 *
 * DELIVERED BEFORE REMAINING. Allotted / Completed / Missed / Remaining was
 * four right-aligned figures the reader had to subtract in their head, and the
 * answer was cut to one — but "remaining" alone cannot tell a student who has
 * never been taught from one who has been taught for twenty hours and bought
 * twenty more. Completed says it, and it is the figure an admin opens a
 * program to check.
 *
 * "Last session" is the column no total can replace: a student can hold plenty
 * of time and not have been seen for six weeks, and that is the thing worth
 * finding on a list.
 *
 * "Use by" came back on 13 October 2026, at the admins' request: the mentor's
 * caseload had it and the roster did not, and finding whose hours run out
 * first meant opening forty student pages. It is the soonest date that still
 * has unused hours behind it, with those minutes under it — never the
 * student's whole Remaining, which is mostly grants running months later. It
 * is a date, not a chip: quiet ink until the staff window, amber inside it.
 *
 * The cohort came back on 15 October 2026, on a program's own roster only, at
 * Research's request: "can we sort our students within the program by
 * cohort?" It is offered only where the program HAS cohorts, so the reason it
 * went — a column empty in every row — still holds everywhere it is absent.
 * It is a line under the name, not a column: the roster already fills its
 * 816px beside the mentors rail, and a seventh column pushed Contact off the
 * edge at every width. So it sorts from the Student heading ("Student ·
 * Cohort"), and it does not filter: a cohort select is still not on the page.
 *
 * WHAT IS STILL NOT HERE, on the owner's instruction (12 September 2026):
 * every chip beside the name except "Not signed in". A roster of forty rows
 * wearing a red chip each is a roster nobody reads.
 */
/**
 * The href, only if it is a web address.
 *
 * A folder URL comes from whatever an admin typed or a spreadsheet imported,
 * and a raw `<a href>` renders a `javascript:` URI as a link that runs it.
 * Anything that does not parse as http(s) renders no link at all.
 */
function webHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/** A contact link: a ghost icon button, the glyph on nothing until hovered. */
const ICON_LINK =
  "inline-flex h-11 w-11 items-center justify-center rounded-lg text-brand transition-colors hover:bg-fill sm:h-8 sm:w-8";

/**
 * What this table can be ordered by. The page says which of them it can
 * honour; `lib/sort.ts` does the ordering.
 */
export const STUDENT_SORTS = [
  "student",
  "completed",
  "total",
  "remaining",
  "deadline",
  "seen",
  "cohort",
] as const;
export type StudentSort = (typeof STUDENT_SORTS)[number];

/**
 * One chip per program, own programs first and visits last (`sortEnrollments`),
 * with the visit's "(on exchange)" beside ITS chip rather than on a line of its
 * own — under the last chip it was ambiguous which one it belonged to.
 */
function ProgramChips({
  enrollments,
  className,
}: {
  enrollments: StudentWithHours["enrollments"];
  className?: string;
}) {
  if (enrollments.length === 0) {
    return <span className={cn("text-muted-fg", className)}>—</span>;
  }
  return (
    <span className={cn("flex min-w-0", className)}>
      {enrollments.map((e) => (
        <span key={e.program.id} className="flex min-w-0 items-center gap-x-1.5">
          <ProgramChip program={e.program} variant="tag" />
          {e.exchangeId && (
            <span className="shrink-0 whitespace-nowrap text-caption text-muted-fg">
              (on exchange)
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

export function StudentsTable({
  students,
  viewer,
  showProgram = true,
  href = "/students",
  from,
  sorts = [],
  cohortOf,
  framed = true,
  empty,
}: {
  students: StudentWithHours[];
  /** Whose words, and the one instant every date on the page is judged against. */
  viewer: ViewerContext;
  /** Dropped when the list is already inside one program. */
  showProgram?: boolean;
  /** Base path for a row's link. */
  href?: string;
  /** The program this list sits in, so the student's page can lead back to it. */
  from?: string;
  /**
   * Which headings this page can honour, from `STUDENT_SORTS`. Only a page
   * that reads `?sort=`/`?dir=` back into its own order may name one — a
   * header that changes the URL and not the order is worse than a header that
   * does nothing.
   *
   * It is a list rather than a flag because the pages differ in what they can
   * honestly offer: the two figures are computed per row AFTER the query, so a
   * page that lets the database slice it into pages can only order by the name
   * the database itself ordered by. A program's roster holds its whole filtered
   * set in memory (`programs/[id]/page.tsx`) and can order by any of them.
   */
  sorts?: readonly StudentSort[];
  /**
   * The row's cohort, as this page names it — present only on a program's own
   * roster, and only where that program has cohorts. Absent, no cohort line
   * and no "Cohort" beside the Student heading.
   */
  cohortOf?: (s: StudentWithHours) => string | null;
  framed?: boolean;
  /** Pass an `EmptyState variant="no-results"` when a filter did the emptying. */
  empty?: React.ReactNode;
}) {
  if (students.length === 0) {
    return (
      empty ?? (
        <EmptyState framed={framed} title="No students yet">
          Students arrive when an admin adds them, or when they sign themselves
          up and are approved.
        </EmptyState>
      )
    );
  }

  const on = (key: StudentSort) => sorts.includes(key);

  const columns: Column[] = [
    // Only the name is offered, and only where the page can honour it. The
    // others are computed per row after the query has already sliced the
    // roster into pages, so ordering by them here would order one page of
    // forty and call it the list.
    {
      label: "Student",
      ...(on("student") ? { sort: "student" } : {}),
      ...(cohortOf && on("cohort") ? { also: { label: "Cohort", sort: "cohort" } } : {}),
    },
    // Folded into the student's own cell between `sm` and `xl`: with the rail
    // beside it a 1024px window gives the table ~770px, and a Program column
    // cost the name its width and the page a sideways scroll.
    ...(showProgram
      ? [{ label: "Program", className: "sm:max-xl:hidden" } as Column]
      : []),
    {
      label: "Completed",
      align: "right",
      // Down, on a first click: nobody opens this column looking for the
      // student who has had the least teaching.
      ...(on("completed") ? { sort: "completed", sortDir: "desc" as const } : {}),
    },
    // NO TOTAL. It was Completed + Remaining printed as a third figure, and a
    // seventh column — past the six a roster can carry before the name starts
    // losing its width. The student's own page has the full breakdown.
    {
      // Just "Remaining": the figure is the student's total across EVERY
      // mentor's grant (`studentsWithHours`), so "with you" would claim a
      // mentor's column holds their own balance. The per-mentor figure with
      // that label lives on /mentor's caseload table, which does scope it.
      label: "Remaining",
      align: "right",
      emphasis: "key",
      ...(on("remaining") ? { sort: "remaining", sortDir: "desc" as const } : {}),
    },
    {
      label: "Use by",
      // Shown at every width since 16 October 2026. It was hidden from `sm`
      // up to 1366px, which is most laptops, and the admins who asked for it
      // could not find it there.
      // Up first: soonest at the top is the whole reason to click it. Rows
      // with nothing left to expire sit at the bottom either way (`lib/sort`).
      ...(on("deadline") ? { sort: "deadline" } : {}),
    },
    {
      label: "Last session",
      // Hidden from `sm` up to 1366px, in Use by's place. At 1280 (`xl`,
      // where Program comes back) seven columns needed 1,050px of a 1,028px
      // table: the names were cut to "Aziz K…" and Contact went off the edge,
      // so one of the two dates gives way. A laptop reader asked for the one
      // that loses hours; who has gone quiet is still on the student's page,
      // on a wide screen, and on a phone in the fold.
      //
      // The same rule by the TABLE's width too (`@container`, on the frame
      // below), because the screen's is not the roster's: a program's page
      // sets it beside the mentors rail at 816px however wide the screen is,
      // and there the six columns took 672px and left every name 57px —
      // "Abdul…", "Khabi…" (17 October 2026). Under 57rem (912px) the name
      // would get less than 15rem, so Last session gives way.
      className: "sm:max-[1365px]:hidden sm:@max-[57rem]:hidden",
      // Down first: the question this column answers is "who has gone quiet",
      // and the most recent session is the top of that order — the same rule
      // the two figures beside it follow.
      ...(on("seen") ? { sort: "seen", sortDir: "desc" as const } : {}),
    },
    { label: "Contact" },
  ];

  return (
    // `@container` so Last session can give way by the roster's own width.
    <Table columns={columns} framed={framed} label="Students" className="@container">
      {students.map((s, i) => {
        // ONE chip, and always the same one: has this person ever signed in.
        // It was the highest-severity status true of them, which put "Over by
        // 1h 35m" and "1h 30m expired unused" down the roster in red — facts
        // about a ledger, on a list whose job is to find a person. Everything
        // else still reaches the reader through the bell (`lib/attention.ts`)
        // and is acted on from the student's own page.
        const statuses = studentStatuses(
          {
            id: s.id,
            name: s.user.name,
            email: s.user.email,
            accountStatus: s.user.status,
            telegramUsername: s.telegramUsername,
            allottedMinutes: s.allottedMinutes,
            remainingMinutes: s.remainingMinutes,
            forfeitedMinutes: s.forfeitedMinutes,
            expiring: s.expiring,
          },
          viewer
        );
        const top = statuses.find((x) => x.type === "STUDENT_NOT_SIGNED_IN");
        const overdrawn = s.remainingMinutes < 0;
        const visiting = !showProgram && s.enrollments.some((e) => e.exchangeId);
        const enrollments = sortEnrollments(s.enrollments);
        const cohort = cohortOf?.(s) ?? null;

        const telegramHref = s.telegramUsername
          ? webHref(`https://t.me/${s.telegramUsername.replace(/^@/, "")}`)
          : null;
        const folderHref = s.folderUrl ? webHref(s.folderUrl) : null;

        return (
          <Tr
            key={s.id}
            className="deal-in"
            style={{ animationDelay: `${Math.min(i, 14) * 24}ms` }}
          >
            <Td className={FILL_CELL}>
              <div className="flex items-center gap-1">
                <PersonCell
                  className="min-w-0 flex-1"
                  person={{
                    id: s.userId,
                    name: s.user.name,
                    email: s.user.email,
                    avatarUpdatedAt: s.user.avatarUpdatedAt,
                  }}
                  // No program, no page: `canManageStudent` turns a student with
                  // no enrollment away even from a platform admin, so a link here
                  // led to "We couldn't find that page" (October 2026 audit). The
                  // name stays, unlinked, and says why.
                  href={
                    s.enrollments.length === 0
                      ? undefined
                      : `${href}/${s.id}${from ? `?from=${from}` : ""}`
                  }
                  // The address keeps the WHOLE second line. "Not signed in"
                  // used to share it, and it truncated the one thing an admin
                  // needs to chase that student — "akobiroblokulov@g…". The
                  // chip rides the name's line instead, where `PersonCell`
                  // lets the name give way first and wraps the chip under it
                  // only when the two cannot both fit.
                  secondary={
                    visiting && s.user.name ? (
                      <span className="flex h-5 min-w-0 items-center gap-x-2">
                        <span className="min-w-0 truncate">{s.user.email}</span>
                        {/* A visitor, where the Program column is not there to
                            say so — a program's own roster, which drops that
                            column, and the page where the distinction matters
                            most: the hours beside this name are capped by
                            another program, and the student goes home when
                            they run out. */}
                        <span className="shrink-0 whitespace-nowrap text-xs font-normal text-muted-fg">
                          on exchange
                        </span>
                      </span>
                    ) : undefined
                  }
                >
                  {top && <StatusChip status={top} className="shrink-0" />}
                  {s.enrollments.length === 0 && (
                    <span className="shrink-0 whitespace-nowrap text-xs font-normal text-muted-fg">
                      not in a program
                    </span>
                  )}
                  {visiting && !s.user.name && (
                    <span className="shrink-0 whitespace-nowrap text-xs font-normal text-muted-fg">
                      on exchange
                    </span>
                  )}
                </PersonCell>
                {/* On a phone the rest of the row folds away and this is the
                    figure it folds to: the balance that runs out. The full
                    columns — completed, total, the last visit, contact — are
                    one tap behind the chevron. */}
                <RowFold label={s.user.name ?? s.user.email}>
                  {/* One line — "4h 48m left". Stacked as figure over word it
                      was a two-line cell the chevron floated beside. */}
                  {s.allottedMinutes > 0 || s.remainingMinutes !== 0 ? (
                    <span className="whitespace-nowrap text-sm tabular-nums">
                      <span
                        className={cn(
                          "font-semibold",
                          overdrawn ? "text-danger-ink" : "text-ink"
                        )}
                      >
                        {formatDuration(Math.abs(s.remainingMinutes))}
                      </span>{" "}
                      <span className="text-xs text-muted-fg">
                        {overdrawn ? "over" : "left"}
                      </span>
                    </span>
                  ) : null}
                </RowFold>
              </div>
              {showProgram && (
                // Between `sm` and `xl` the Program column is not there (see
                // the column list); its chips sit under the name instead, in
                // line with the text above (avatar 32 + gap 10).
                <ProgramChips
                  enrollments={enrollments}
                  className="mt-1.5 hidden flex-wrap gap-x-2 gap-y-1 pl-12 sm:max-xl:flex"
                />
              )}
              {/* Under the address, in line with it (avatar 32 + gap 10). */}
              {cohort && (
                <span title={cohort} className="mt-1 block truncate pl-12 text-xs text-muted-fg">
                  {cohort}
                </span>
              )}
            </Td>

            {showProgram && (
              <Td label="Program" className="sm:max-xl:hidden" data-fold>
                {/* Every program the READER may see them in — the rows were
                    narrowed to the reader's scope before they got here, so a
                    student in a program this person doesn't administer shows
                    only the ones they do. One chip each rather than one joined
                    string, because two enrollments is the case this column
                    exists for and "Global Admissions · Master's" is a sentence
                    the reader has to parse. */}
                {/* `*:flex-wrap`: a visit's "(on exchange)" may drop under ITS
                    chip when the column is narrow. Kept on one line, chip and
                    label were the widest thing in the table (~330px) and the
                    Student column paid for it — names broken mid-word at 1366. */}
                <ProgramChips
                  enrollments={enrollments}
                  className="flex-col items-start gap-y-1 *:flex-wrap *:gap-y-0.5"
                />
              </Td>
            )}

            <Td label="Completed" align="right" className="tabular-nums" data-fold>
              {s.completedMinutes > 0 ? (
                formatDuration(s.completedMinutes)
              ) : (
                <span className="text-muted-fg">—</span>
              )}
            </Td>

            <Td label="Remaining" align="right" className="tabular-nums" data-fold>
              <HoursLeft
                remaining={s.remainingMinutes}
                used={s.completedMinutes + s.missedMinutes}
                expired={s.forfeitedMinutes}
              />
            </Td>

            <Td label="Use by" className="whitespace-nowrap" data-fold>
              {/* The date, and under it only the minutes that date takes —
                  "October 20 / 2h to use" beside 22h remaining says most of
                  the time is safe. */}
              {s.expiring ? (
                <span className="flex flex-col">
                  <DeadlineText
                    deadline={s.expiring.date}
                    now={viewer.now}
                    within={EXPIRY_WINDOW_DAYS[viewer.audience]}
                  />
                  <span className="text-xs text-muted-fg tabular-nums">
                    {formatDuration(s.expiring.minutes)} to use
                  </span>
                </span>
              ) : (
                <span className="text-muted-fg">—</span>
              )}
            </Td>

            <Td
              label="Last session"
              className="whitespace-nowrap sm:max-[1365px]:hidden sm:@max-[57rem]:hidden"
              data-fold
            >
              {/* A dash for "nothing has happened", the one way every table
                  writes it — not "never" here and "—" in the next column.
                  Under the date, how long ago: "who has gone quiet" is the
                  question this column is for, and "September 8" made the
                  reader count to it. */}
              {s.lastSessionAt ? (
                <span className="flex flex-col">
                  <span className="text-ink">{formatDate(s.lastSessionAt)}</span>
                  <span className="text-xs text-muted-fg">
                    {formatDaysAgo(s.lastSessionAt, viewer.now)}
                  </span>
                </span>
              ) : (
                <span className="text-muted-fg">—</span>
              )}
            </Td>

            <Td label="Contact" data-fold>
              {/* Two ghost icon buttons: the glyph on nothing, a fill only
                  under the pointer. As filled or bordered chips they were a
                  column of buttons down the roster, louder than the names
                  they sit beside. 44px on a phone, 32px on a pointer. */}
              <span className="-mx-1 flex items-center">
                {s.telegramUsername && telegramHref ? (
                  <a
                    target="_blank"
                    rel="noreferrer"
                    className={ICON_LINK}
                    href={telegramHref}
                    title={`Message @${s.telegramUsername.replace(/^@/, "")} on Telegram`}
                  >
                    <SendIcon className="h-4 w-4" />
                    {/* The handle is in the tooltip, not the cell: two columns
                        of width went on saying "@name" beside a name. */}
                    <span className="sr-only">Telegram</span>
                  </a>
                ) : null}
                {s.folderUrl && folderHref ? (
                  <a
                    target="_blank"
                    rel="noreferrer"
                    className={ICON_LINK}
                    href={folderHref}
                    // The URL stays in the tooltip: staff could not otherwise
                    // see where a link points without clicking it.
                    title={`Open the student's folder (${s.folderUrl})`}
                  >
                    <FolderIcon className="h-4 w-4" />
                    <span className="sr-only">Folder</span>
                  </a>
                ) : null}
                {!telegramHref && !folderHref && (
                  <span className="text-muted-fg">—</span>
                )}
              </span>
            </Td>
          </Tr>
        );
      })}
    </Table>
  );
}
