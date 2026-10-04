import { FolderIcon, SendIcon } from "@/components/icons";

import { PersonCell } from "@/components/person-chip";
import { ProgramChip } from "@/components/program-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { RowFold } from "@/components/ui/row-fold";
import { StatusChip } from "@/components/ui/status-chip";
import { FILL_CELL, Table, Td, Tr, type Column } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatBalance, formatDate, formatDuration } from "@/lib/format";
import { studentStatuses, type ViewerContext } from "@/lib/status";
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
 * WHAT IS NOT HERE, on the owner's instruction (12 September 2026): a "Use by"
 * column, and every chip beside the name except "Not signed in". A roster
 * of forty rows wearing a red chip each is a roster nobody reads, and the
 * deadline that drives forfeiture is not a date a reader acts on from here —
 * it is on the student's own page, beside the grant it belongs to, and the
 * bell is what says whose is running out.
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
export const STUDENT_SORTS = ["student", "completed", "total", "remaining", "seen"] as const;
export type StudentSort = (typeof STUDENT_SORTS)[number];

export function StudentsTable({
  students,
  viewer,
  showProgram = true,
  href = "/students",
  from,
  sorts = [],
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
    // other four are computed per row after the query has already sliced the
    // roster into pages, so ordering by them here would order one page of
    // forty and call it the list.
    { label: "Student", ...(on("student") ? { sort: "student" } : {}) },
    ...(showProgram ? [{ label: "Program" } as Column] : []),
    {
      label: "Completed",
      align: "right",
      // Down, on a first click: nobody opens this column looking for the
      // student who has had the least teaching.
      ...(on("completed") ? { sort: "completed", sortDir: "desc" as const } : {}),
    },
    {
      label: "Total",
      align: "right",
      ...(on("total") ? { sort: "total", sortDir: "desc" as const } : {}),
    },
    {
      // Just "Remaining": the figure is the student's total across EVERY
      // mentor's grant (`studentsWithHours`), so "with you" would claim a
      // mentor's column holds their own balance. The per-mentor figure with
      // that label lives on /mentor's caseload table, which does scope it.
      label: "Remaining",
      align: "right",
      ...(on("remaining") ? { sort: "remaining", sortDir: "desc" as const } : {}),
    },
    {
      label: "Last session",
      // Down first: the question this column answers is "who has gone quiet",
      // and the most recent session is the top of that order — the same rule
      // the two figures beside it follow.
      ...(on("seen") ? { sort: "seen", sortDir: "desc" as const } : {}),
    },
    { label: "Contact" },
  ];

  return (
    <Table columns={columns} framed={framed}>
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
                  href={`${href}/${s.id}${from ? `?from=${from}` : ""}`}
                >
                  {top && <StatusChip status={top} />}
                  {/* A visitor, where the Program column is not there to say
                      so — a program's own roster, which drops that column, and
                      the page where the distinction matters most: the hours
                      beside this name are capped by another program, and the
                      student goes home when they run out. */}
                  {!showProgram && s.enrollments.some((e) => e.exchangeId) && (
                    <span className="shrink-0 text-xs font-normal text-muted-fg">
                      on exchange
                    </span>
                  )}
                </PersonCell>
                {/* On a phone the rest of the row folds away and this is the
                    figure it folds to: the balance that runs out. The full
                    columns — completed, total, the last visit, contact — are
                    one tap behind the chevron. */}
                <RowFold label={s.user.name ?? s.user.email}>
                  {s.allottedMinutes > 0 || s.remainingMinutes !== 0 ? (
                    <span className="flex flex-col items-end leading-tight">
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          overdrawn ? "text-danger-ink" : "text-ink"
                        )}
                      >
                        {formatDuration(Math.abs(s.remainingMinutes))}
                      </span>
                      <span className="text-xs font-medium text-muted-fg">
                        {overdrawn ? "over" : "left"}
                      </span>
                    </span>
                  ) : null}
                </RowFold>
              </div>
            </Td>

            {showProgram && (
              <Td label="Program" data-fold>
                {/* Every program the READER may see them in — the rows were
                    narrowed to the reader's scope before they got here, so a
                    student in a program this person doesn't administer shows
                    only the ones they do. One chip each rather than one joined
                    string, because two enrollments is the case this column
                    exists for and "Global Admissions · Master's" is a sentence
                    the reader has to parse. */}
                {/* Capped below `xl`: a table sizes this column to its
                    longest program name, and on a tablet that left the
                    student — the row's subject — five letters wide. The chip
                    truncates into the cap (its title carries the full name). */}
                <span className="flex min-w-0 flex-col gap-0.5 sm:max-w-36 xl:max-w-none">
                  {s.enrollments.map((e) => (
                    <span
                      key={e.program.id}
                      className="flex min-w-0 flex-wrap items-center gap-x-1.5"
                    >
                      <ProgramChip program={e.program} className="text-[0.8125rem]" />
                      {/* A visitor another program lent us, not one of this
                          program's students. Said on the row, because a roster
                          that shows a visit as an enrollment is a roster that
                          has quietly gained a student — and their hours are
                          capped by somebody else. */}
                      {e.exchangeId && (
                        <span className="shrink-0 text-[0.6875rem] text-muted-fg">
                          on exchange
                        </span>
                      )}
                    </span>
                  ))}
                  {s.enrollments.length === 0 && (
                    <span className="text-muted-fg">—</span>
                  )}
                </span>
              </Td>
            )}

            <Td label="Completed" align="right" className="tabular-nums" data-fold>
              <span
                className={cn(
                  "font-medium",
                  s.completedMinutes > 0 ? "text-ink" : "text-muted-fg"
                )}
              >
                {formatDuration(s.completedMinutes)}
              </span>
            </Td>

            <Td label="Total" align="right" className="tabular-nums" data-fold>
              <span className="font-medium text-muted-fg">
                {formatDuration(s.allottedMinutes)}
              </span>
            </Td>

            <Td label="Remaining" align="right" className="tabular-nums" data-fold>
              <span
                className={cn(
                  "font-medium",
                  overdrawn ? "text-danger-ink" : "text-ink"
                )}
              >
                {formatBalance(s.remainingMinutes)}
              </span>
            </Td>

            <Td label="Last session" className="whitespace-nowrap text-muted-fg" data-fold>
              {s.lastSessionAt ? formatDate(s.lastSessionAt) : "never"}
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
