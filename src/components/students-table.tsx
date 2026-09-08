import { FolderIcon, SendIcon } from "@/components/icons";

import { PersonCell } from "@/components/person-chip";
import { ProgramChip } from "@/components/program-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ExternalLink } from "@/components/ui/link";
import { DeadlineText, StatusChip } from "@/components/ui/status-chip";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatDate, formatDuration } from "@/lib/format";
import { studentStatuses, type ViewerContext } from "@/lib/status";
import type { StudentWithHours } from "@/lib/queries";

/**
 * The roster, in six columns.
 *
 * It had eight, and two of them — Telegram and Folder — were an em-dash in
 * most rows, so they cost a phone two columns of width to say nothing. They
 * are one Contact cell. `Program` survives, because this list is reached
 * without one as often as with one; `Cohort` folds into it as a muted suffix,
 * since programs are flat by default and the column was empty in all three.
 *
 * The bigger change is what the numbers say. Allotted / Completed / Missed /
 * Remaining was four right-aligned figures the reader had to subtract in their
 * head, and the set was incomplete in the one way that matters: it omitted
 * FORFEITED, so a student at zero because their time expired was indis-
 * tinguishable from one who used every minute of it. One "Remaining" column
 * with the total muted beside it, and the chip beside the name says which of
 * the two happened.
 *
 * "Last session" is the column no total can replace: a student can hold plenty
 * of time and not have been seen for six weeks, and that is the thing worth
 * finding on a list.
 */
export function StudentsTable({
  students,
  viewer,
  showProgram = true,
  href = "/students",
  sortable = false,
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
   * Offer the name as a sort. Only for a page that reads `?sort=`/`?dir=` back
   * into its own query — a header that changes the URL and not the order is
   * worse than a header that does nothing.
   */
  sortable?: boolean;
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

  const columns: Column[] = [
    // Only the name is offered, and only where the page can honour it. The
    // other four are computed per row after the query has already sliced the
    // roster into pages, so ordering by them here would order one page of
    // forty and call it the list.
    { label: "Student", ...(sortable ? { sort: "student" } : {}) },
    ...(showProgram ? [{ label: "Program" } as Column] : []),
    {
      label: viewer.audience === "mentor" ? "Remaining with you" : "Remaining",
      align: "right",
    },
    { label: "Use by" },
    { label: "Last session" },
    { label: "Contact" },
  ];

  return (
    <Table columns={columns} framed={framed}>
      {students.map((s, i) => {
        // The highest-severity thing true of them, and only that one: a row
        // wearing three chips is a row nobody reads. The full list is on their
        // own page, where there is room to act on each.
        const [top] = studentStatuses(
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
                    <ProgramChip
                      key={e.program.id}
                      program={e.program}
                      className="text-[13px]"
                    />
                  ))}
                  {s.enrollments.length === 0 && (
                    <span className="text-muted-fg">—</span>
                  )}
                </span>
              </Td>
            )}

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

            <Td label="Use by" className="whitespace-nowrap">
              {s.expiring ? (
                <DeadlineText deadline={s.expiring.date} now={viewer.now} />
              ) : s.forfeitedMinutes > 0 ? (
                // Not a missing date: every date they had has passed, and the
                // minutes behind them are gone. A dash would read as "none set".
                <span className="text-muted-fg">expired</span>
              ) : (
                <span className="text-muted-fg">—</span>
              )}
            </Td>

            <Td label="Last session" className="whitespace-nowrap text-muted-fg">
              {s.lastSessionAt ? formatDate(s.lastSessionAt) : "never"}
            </Td>

            <Td label="Contact">
              <span className="flex items-center gap-1">
                {s.telegramUsername ? (
                  <ExternalLink
                    variant="chip"
                    className="min-h-11 px-3"
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
                    className="min-h-11 px-3"
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
