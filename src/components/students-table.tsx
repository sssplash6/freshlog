import { FolderIcon, SendIcon } from "@/components/icons";

import { PersonCell } from "@/components/person-chip";
import { ProgramChip } from "@/components/program-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ExternalLink } from "@/components/ui/link";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatDate, formatDuration } from "@/lib/format";
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
 * column, and every chip beside the name except "Hasn't signed in". A roster
 * of forty rows wearing a red chip each is a roster nobody reads, and the
 * deadline that drives forfeiture is not a date a reader acts on from here —
 * it is on the student's own page, beside the grant it belongs to, and the
 * bell is what says whose is running out.
 */
/**
 * What this table can be ordered by. The page says which of them it can
 * honour; `lib/sort.ts` does the ordering.
 */
export const STUDENT_SORTS = ["student", "completed", "remaining"] as const;
export type StudentSort = (typeof STUDENT_SORTS)[number];

export function StudentsTable({
  students,
  viewer,
  showProgram = true,
  href = "/students",
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
      label: viewer.audience === "mentor" ? "Remaining with you" : "Remaining",
      align: "right",
      ...(on("remaining") ? { sort: "remaining", sortDir: "desc" as const } : {}),
    },
    { label: "Last session" },
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

        return (
          <Tr
            key={s.id}
            className="deal-in"
            style={{ animationDelay: `${Math.min(i, 14) * 24}ms` }}
          >
            <Td>
              <PersonCell
                person={{
                  id: s.userId,
                  name: s.user.name,
                  email: s.user.email,
                  avatarUpdatedAt: s.user.avatarUpdatedAt,
                }}
                href={`${href}/${s.id}`}
              >
                {top && <StatusChip status={top} />}
                {/* A visitor, where the Program column is not there to say so
                    — a program's own roster, which drops that column, and the
                    page where the distinction matters most: the hours beside
                    this name are capped by another program, and the student
                    goes home when they run out. */}
                {!showProgram && s.enrollments.some((e) => e.exchangeId) && (
                  <span className="shrink-0 text-xs font-normal text-muted-fg">
                    on exchange
                  </span>
                )}
              </PersonCell>
            </Td>

            {showProgram && (
              <Td label="Program">
                {/* Every program the READER may see them in — the rows were
                    narrowed to the reader's scope before they got here, so a
                    student in a program this person doesn't administer shows
                    only the ones they do. One chip each rather than one joined
                    string, because two enrollments is the case this column
                    exists for and "Global Admissions · Master's" is a sentence
                    the reader has to parse. */}
                <span className="flex min-w-0 flex-col gap-0.5">
                  {s.enrollments.map((e) => (
                    <span
                      key={e.program.id}
                      className="flex min-w-0 items-center gap-1.5"
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

            <Td label="Completed" align="right" className="tabular-nums">
              <span
                className={cn(
                  "font-medium",
                  s.completedMinutes > 0 ? "text-ink" : "text-muted-fg"
                )}
              >
                {formatDuration(s.completedMinutes)}
              </span>
            </Td>

            <Td label="Remaining" align="right" className="tabular-nums">
              <span
                className={cn(
                  "font-medium",
                  overdrawn ? "text-danger-ink" : "text-ink"
                )}
              >
                {formatDuration(s.remainingMinutes)}
              </span>
              {s.allottedMinutes > 0 && (
                <span className="block text-xs text-muted-fg">
                  of {formatDuration(s.allottedMinutes)}
                </span>
              )}
            </Td>

            <Td label="Last session" className="whitespace-nowrap text-muted-fg">
              {s.lastSessionAt ? formatDate(s.lastSessionAt) : "never"}
            </Td>

            <Td label="Contact">
              {/* Two icon chips, as narrow as a 44px tap target allows on a
                  phone and narrower than that on a pointer, where the column
                  was spending more width on its two buttons than the dates
                  beside it. */}
              <span className="flex items-center gap-1">
                {s.telegramUsername ? (
                  <ExternalLink
                    variant="chip"
                    className="min-h-11 px-2 sm:min-h-9"
                    href={`https://t.me/${s.telegramUsername.replace(/^@/, "")}`}
                    icon={<SendIcon className="h-4 w-4" />}
                    title={`Message @${s.telegramUsername.replace(/^@/, "")} on Telegram`}
                  >
                    {/* The handle is in the tooltip, not the cell: two columns
                        of width went on saying "@name" beside a name. */}
                    <span className="sr-only">Telegram</span>
                  </ExternalLink>
                ) : null}
                {s.folderUrl ? (
                  <ExternalLink
                    variant="chip"
                    className="min-h-11 px-2 sm:min-h-9"
                    href={s.folderUrl}
                    icon={<FolderIcon className="h-4 w-4" />}
                    // The URL stays in the tooltip: staff could not otherwise
                    // see where a link points without clicking it.
                    title={`Open the student's folder (${s.folderUrl})`}
                  >
                    <span className="sr-only">Folder</span>
                  </ExternalLink>
                ) : null}
                {!s.telegramUsername && !s.folderUrl && (
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
