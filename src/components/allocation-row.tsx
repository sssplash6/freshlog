import { PersonChip } from "@/components/person-chip";
import { ProgramChip } from "@/components/program-chip";
import { Meter } from "@/components/ui/meter";
import { DeadlineText, StatusChip } from "@/components/ui/status-chip";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatDuration, formatMoney } from "@/lib/format";
import { EXPIRY_WINDOW_DAYS, type ViewerContext } from "@/lib/status";

/**
 * One student's time with one mentor, wherever it is read.
 *
 * Three surfaces drew this and each did the same arithmetic differently. The
 * one that matters is what the bar means. `allocationSummary` writes an
 * expired allocation's `remaining` down to zero, so `allocated - remaining`
 * reads a grant that simply ran out of time as fully USED — and a full bar
 * tells a student they had their sessions when they had none. The bar is what
 * is GONE: spent plus forfeited. The figures underneath separate the two,
 * because a student who lost four hours to a deadline needs to know that is
 * what happened.
 *
 * Two shapes, one set of facts:
 *
 *   table  the staff ledger — every column, a use-by date, a ⋮ menu
 *   card   the student's own, and the mentor's: a balance, a bar, a date
 */

/** A person on a row, with the page this reader may open for them. */
type RowPerson = {
  id: string;
  name: string | null;
  email: string;
  avatarUpdatedAt?: Date | null;
  href?: string;
};

/**
 * Structural, not Prisma-derived: `allocationSummary` computes forfeiture in
 * JS against each row's own deadline, and the derived row for a mentor who
 * holds no grant at all is not an `HourAllocation` in the first place.
 */
export type AllocationEntry = {
  /** Null = granted before a mentor was chosen: the unassigned pool. */
  mentor: RowPerson | null;
  /**
   * The program the time was granted in.
   *
   * A row is one (program, mentor) grant, so a student in two programs has two
   * rows for one mentor, with two balances and two use-by dates. The column is
   * only drawn when there IS more than one program on the table — see
   * `AllocationsTable` — because a program named on every row of a
   * single-program student is a column of the same word.
   */
  program: { id: string; name: string };
  allocated: number;
  completed: number;
  missed: number;
  remaining: number;
  forfeited: number;
  expired: boolean;
  deadline: Date | null;
  /** Master's records what was paid for the time. Null everywhere else. */
  amountPaid?: number | null;
};

/** The two figures the bar is drawn from, computed once. */
function spent(entry: AllocationEntry) {
  const used = entry.completed + entry.missed;
  return { used, gone: used + entry.forfeited };
}

export function toAllocationEntries(
  rows: readonly {
    mentor: {
      id: string;
      name: string | null;
      email: string;
      avatarUpdatedAt?: Date | null;
    } | null;
    program: { id: string; name: string };
    allocated: number;
    completed: number;
    missed: number;
    remaining: number;
    forfeited: number;
    expired: boolean;
    deadline: Date | null;
    amountPaid?: number | null;
  }[],
  links: { mentorBase?: string } = {}
): AllocationEntry[] {
  return rows.map((r) => ({
    ...r,
    mentor: r.mentor
      ? {
          ...r.mentor,
          href: links.mentorBase ? `${links.mentorBase}/${r.mentor.id}` : undefined,
        }
      : null,
  }));
}

/**
 * The balance, as one figure and one word.
 *
 * Overdrawn is stated once, here, in red — which is why no caller adds an
 * "over" chip beside it. Saying it twice on one row is the habit the student
 * pages were rebuilt to drop.
 */
export function AllocationBalance({ entry }: { entry: AllocationEntry }) {
  const overdrawn = entry.remaining < 0;
  return (
    <span className="text-sm text-muted-fg">
      <span
        className={cn(
          "text-lg font-bold tabular-nums",
          overdrawn ? "text-danger-ink" : "text-ink"
        )}
      >
        {formatDuration(Math.abs(entry.remaining))}
      </span>{" "}
      {overdrawn ? "over" : "remaining"}
    </span>
  );
}

/**
 * The bar, and the two figures that say what it is made of.
 *
 * The use-by date is a chip only while it can still be acted on: once it has
 * passed, `DeadlineText` is already red and the row's own state says how much
 * went with it, and two red things on one row are the same alarm twice.
 */
export function AllocationMeter({
  entry,
  viewer,
  label,
  className,
}: {
  entry: AllocationEntry;
  viewer: ViewerContext;
  /** What the bar is measuring, for a screen reader: "Time with Malika". */
  label: string;
  className?: string;
}) {
  if (entry.allocated <= 0) return null;
  const { used, gone } = spent(entry);
  const overdrawn = entry.remaining < 0;

  // A month, because that is the window a student can act inside — the same
  // number `studentStatuses` warns on, so a row and a home page cannot
  // disagree about which dates are close.
  const within = EXPIRY_WINDOW_DAYS[viewer.audience === "student" ? "student" : "staff"];

  return (
    <div className={className}>
      <Meter
        pct={overdrawn ? 100 : Math.round((gone / entry.allocated) * 100)}
        tone={overdrawn ? "danger" : "accent"}
        ariaValueNow={used}
        ariaValueMax={entry.allocated}
        ariaLabel={label}
      />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-fg">
        <span className="tabular-nums">
          {formatDuration(entry.completed)} of {formatDuration(entry.allocated)}{" "}
          completed
          {entry.missed > 0 ? ` · ${formatDuration(entry.missed)} missed` : ""}
        </span>
        {/* One alarm, not two. This used to wrap the date in an amber chip when
            it was close; `DeadlineText` now carries close, past and ahead in
            its own weight and colour, and a chip around an already-amber date
            says the same thing twice. */}
        <span>
          Use by{" "}
          <DeadlineText
            deadline={entry.deadline}
            now={viewer.now}
            within={within}
          />
        </span>
      </div>
    </div>
  );
}

/**
 * The person a row is about — a mentor, or the time nobody holds yet. The pool
 * is not an absence: it is a grant made before a consultant was chosen, and its
 * own row is what makes it correctable like any other.
 */
function AllocationPerson({ entry }: { entry: AllocationEntry }) {
  if (entry.mentor) {
    return <PersonChip person={entry.mentor} size="sm" href={entry.mentor.href} />;
  }
  return <StatusChip severity="attention">Needs a mentor</StatusChip>;
}

/** A value the row does not have. Never a blank cell — a blank reads as a bug. */
function Dash() {
  return <span className="text-muted-fg">—</span>;
}

export function AllocationRow({
  entry,
  viewer,
  showProgram = false,
  showAmountPaid = false,
  actions,
  index,
}: {
  entry: AllocationEntry;
  viewer: ViewerContext;
  /** Set by the table when its rows span more than one program. */
  showProgram?: boolean;
  showAmountPaid?: boolean;
  actions?: React.ReactNode;
  index?: number;
}) {
  return (
    <Tr
      className={cn(index != null && "deal-in")}
      style={
        index == null
          ? undefined
          : { animationDelay: `${Math.min(index, 14) * 24}ms` }
      }
    >
      <Td>
        <AllocationPerson entry={entry} />
      </Td>
      {showProgram && (
        <Td label="Program">
          <ProgramChip program={entry.program} />
        </Td>
      )}
      <Td label="Total" align="right" className="tabular-nums">
        {formatDuration(entry.allocated)}
      </Td>
      <Td label="Completed" align="right" className="tabular-nums">
        {formatDuration(entry.completed)}
      </Td>
      <Td
        label="Missed"
        align="right"
        className={cn(
          "tabular-nums",
          entry.missed > 0 ? "text-warn-ink" : "text-muted-fg"
        )}
      >
        {entry.missed > 0 ? formatDuration(entry.missed) : <Dash />}
      </Td>
      <Td
        label="Remaining"
        align="right"
        className={cn(
          "font-medium tabular-nums",
          entry.remaining < 0 ? "text-danger-ink" : "text-ink"
        )}
      >
        {formatDuration(entry.remaining)}
      </Td>
      <Td label="Use by">
        <DeadlineText deadline={entry.deadline} now={viewer.now} />
      </Td>
      {showAmountPaid && (
        <Td label="Paid" align="right" className="tabular-nums">
          {entry.amountPaid != null ? formatMoney(entry.amountPaid) : <Dash />}
        </Td>
      )}
      {actions !== undefined && <Td align="right">{actions}</Td>}
    </Tr>
  );
}

export function AllocationsTable({
  entries,
  viewer,
  showAmountPaid = false,
  renderActions,
  framed = true,
  className,
}: {
  entries: AllocationEntry[];
  viewer: ViewerContext;
  showAmountPaid?: boolean;
  renderActions?: (entry: AllocationEntry) => React.ReactNode;
  framed?: boolean;
  className?: string;
}) {
  const rowActions = entries.map((e) => renderActions?.(e));
  const withActions = rowActions.some(Boolean);
  // Only worth a column when it varies. One program is the page's own subject
  // and gets said once, above the table, not on every line of it.
  const showProgram = new Set(entries.map((e) => e.program.id)).size > 1;

  const columns: Column[] = [
    { label: "Mentor" },
    ...(showProgram ? [{ label: "Program" } as Column] : []),
    { label: "Total", align: "right" },
    { label: "Completed", align: "right" },
    { label: "Missed", align: "right" },
    { label: "Remaining", align: "right" },
    { label: "Use by" },
    ...(showAmountPaid ? [{ label: "Paid", align: "right" } as Column] : []),
    ...(withActions ? [{ label: "", align: "right" } as Column] : []),
  ];

  return (
    <Table framed={framed} columns={columns} className={className}>
      {entries.map((entry, i) => (
        <AllocationRow
          key={`${entry.program.id}:${entry.mentor?.id ?? "unassigned"}`}
          entry={entry}
          viewer={viewer}
          showProgram={showProgram}
          showAmountPaid={showAmountPaid}
          actions={withActions ? rowActions[i] : undefined}
          index={i}
        />
      ))}
    </Table>
  );
}
