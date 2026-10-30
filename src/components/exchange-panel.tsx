import { PersonChip } from "@/components/person-chip";
import { ProgramChip } from "@/components/program-chip";
import { SessionsList } from "@/components/session-row";
import { toSessionEntries } from "@/lib/session-entries";
import { ReturnExchangeButton } from "@/components/forms/exchange-forms";
import { Disclosure } from "@/components/ui/disclosure";
import { StatusChip } from "@/components/ui/status-chip";
import { EXCHANGE_STATUS } from "@/lib/constants";
import { deadlinePassed } from "@/lib/deadlines";
import type { ExchangeView } from "@/lib/exchanges";
import { formatDate, formatDuration } from "@/lib/format";
import type { ViewerContext } from "@/lib/status";

/**
 * One placement between two programs, read from either end.
 *
 * The same rows, the same arithmetic, to both — that is the whole promise of
 * the feature, so it is one component rather than a sending view and a hosting
 * view that could drift. What differs between the two readers is which program
 * they recognise as their own, and the line says both names, so neither has to
 * be told which side they are on.
 *
 * The log is folded. A host admin opens this page to allocate and a sending
 * mentor opens it to see whether anything has happened yet; the sessions are
 * the answer to a third question, asked less often, and eight rows of them
 * above the figures would bury the two that are actually being looked for.
 */
export function ExchangeList({
  exchanges,
  viewer,
  /** Who may call one off — the two programs' admins and whoever sent them. */
  canReturn,
  /**
   * Name the student on each row. Off on a student's own page, where the whole
   * page is about them; on wherever the list spans people — the same rule
   * `SessionsList` follows for its Student column.
   */
  showStudent = false,
}: {
  exchanges: ExchangeView[];
  viewer: ViewerContext;
  canReturn: (exchange: ExchangeView) => boolean;
  showStudent?: boolean;
}) {
  return (
    <ul className="divide-y divide-line">
      {exchanges.map((e) => {
        const open = e.status === EXCHANGE_STATUS.OPEN;
        const { cap, allocated, unallocated, used, missed, remaining, forfeited, extra } =
          e.figures;
        const sessions = toSessionEntries(e.sessions, { mentorBase: "/mentors" });

        return (
          <li key={e.id} className="px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                {showStudent && (
                  <PersonChip
                    person={{
                      id: e.student.userId,
                      name: e.student.user.name,
                      email: e.student.user.email,
                      avatarUpdatedAt: e.student.user.avatarUpdatedAt,
                    }}
                    size="sm"
                    href={`/students/${e.studentId}`}
                  />
                )}
                {/* The route is one unit, and "→ host" is one unit inside it.
                    The arrow used to be a free item in the wrapping row, so on
                    a phone it landed at the end of one line on one placement
                    and the start of the next on another — "Flexible Program →"
                    over "Global Admissions Program" (October 2026). Now a wrap
                    can only fall before the arrow, and under `sm` the route
                    takes its own line under the student. */}
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 max-sm:basis-full">
                  <ProgramChip program={e.fromProgram} />
                  <span className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap">
                    <span aria-hidden className="text-muted-fg">
                      &rarr;
                    </span>
                    <span className="sr-only">to</span>
                    <ProgramChip program={e.toProgram} />
                  </span>
                </span>
                {!open && <StatusChip severity="neutral">Called off</StatusChip>}
                {open && unallocated > 0 && (
                  <StatusChip severity="attention">
                    {formatDuration(unallocated)} to allocate
                  </StatusChip>
                )}
                {/* Only once its day is over: a stored day is 05:00 Tashkent
                    as an instant, and the grants under it run to midnight. */}
                {open && deadlinePassed(e.deadline, viewer.now.getTime()) && (
                  <StatusChip severity="problem">Ran out</StatusChip>
                )}
              </span>
              <span className="shrink-0 text-body font-medium tabular-nums text-ink">
                {formatDuration(cap)} · use by {formatDate(e.deadline)}
              </span>
            </div>

            <p className="mt-0.5 text-xs text-muted-fg">
              Sent by {e.sentBy.name ?? e.sentBy.email}
              {e.note ? ` · “${e.note}”` : ""}
              {!open && e.returnedBy
                ? ` · called off by ${e.returnedBy.name ?? e.returnedBy.email}${
                    e.returnNote ? ` · “${e.returnNote}”` : ""
                  }`
                : ""}
            </p>

            {open && (
              <p className="mt-0.5 text-xs tabular-nums text-muted-fg">
                {allocated > 0
                  ? `${formatDuration(allocated)} on ${e.mentors
                      .map((m) => m.mentor?.name ?? m.mentor?.email ?? "nobody yet")
                      .join(", ")}`
                  : "Nobody here holds it yet"}
                {/* Completed excludes no-shows — the ledger's own definition,
                    now that the line names the missed subset beside it. */}
                {` · ${formatDuration(used - missed)} completed`}
                {missed > 0 && ` · ${formatDuration(missed)} missed`}
                {` · ${formatDuration(remaining)} remaining`}
                {/* Forfeited minutes are named, in the ledger's own words — a
                    "Ran out" placement that still claimed a spendable balance
                    was the lie this line used to tell. */}
                {forfeited > 0 && ` · ${formatDuration(forfeited)} expired unused`}
                {extra > 0 && ` · ${formatDuration(extra)} extra`}
              </p>
            )}

            {sessions.length > 0 && (
              <div className="mt-1">
                <Disclosure label="Sessions" count={sessions.length}>
                  <SessionsList
                    sessions={sessions}
                    viewer={viewer}
                    columns={["date", "mentor", "duration", "task", "notes"]}
                    framed={false}
                  />
                </Disclosure>
              </div>
            )}

            {open && canReturn(e) && (
              <div className="mt-1">
                <ReturnExchangeButton
                  exchangeId={e.id}
                  hostProgram={e.toProgram.name}
                  canReturn={e.sessions.length === 0}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
