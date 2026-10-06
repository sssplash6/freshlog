import { StarIcon } from "@/components/icons";
import { PersonCell } from "@/components/person-chip";
import { ProgramChip, type ProgramRef } from "@/components/program-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { RowFold } from "@/components/ui/row-fold";
import { StatusChip } from "@/components/ui/status-chip";
import { FILL_CELL, Table, Td, Tr, type Column } from "@/components/ui/table";
import { mentorStatuses, type ViewerContext } from "@/lib/status";

/**
 * The mentor roster, in four columns.
 *
 * What it replaces was a list of cards, and the cards were the problem. Each
 * one carried the mentor, one chip per pairing, a bare "link" / "no link"
 * anchor beside every chip, and an Edit button that unfolded a whole form —
 * name, email and a program picker — inside the row. Twenty-five of those is
 * twenty-five pickers built over the same program list, and a page whose
 * height depends on how many programs the busiest mentor works in.
 *
 * So the row says the four things a roster is scanned for — who, where, can a
 * student book them, and are they holding anybody's time — and everything you
 * might DO to a mentor happens on that mentor's page.
 *
 * "Booking links" is a fraction rather than a chip per pairing because the
 * question here is whether this mentor is bookable at all; WHICH program is
 * missing its link is a fact about one mentor, and it is on their page beside
 * the form that fixes it.
 */
export type MentorRow = {
  id: string;
  name: string | null;
  email: string;
  avatarUpdatedAt?: Date | null;
  /** `USER_STATUS`. */
  accountStatus: string;
  /** A dual-role admin who also mentors. */
  isAdmin: boolean;
  /** Program (or program / cohort) labels, already narrowed to the reader. */
  /** One per pairing; `label` names the cohort when the pairing has one. */
  programs: { program: ProgramRef; label: string }[];
  pairings: number;
  pairingsWithLink: number;
  /** Students holding time from this mentor, inside the reader's programs. */
  students: number;
  averageRating: number | null;
  ratingCount: number;
};

const COLUMNS: Column[] = [
  { label: "Mentor" },
  { label: "Programs" },
  { label: "Booking links", className: "whitespace-nowrap" },
  { label: "Students", align: "right", emphasis: "key" },
];

export function MentorsTable({
  rows,
  viewer,
  href = "/mentors",
  framed = true,
  empty,
}: {
  rows: MentorRow[];
  /** Whose words the chips are in. */
  viewer: ViewerContext;
  /** Base path for a row's link. */
  href?: string;
  framed?: boolean;
  /** Pass an `EmptyState variant="no-results"` when a filter did the emptying. */
  empty?: React.ReactNode;
}) {
  if (rows.length === 0) {
    return (
      empty ?? (
        <EmptyState framed={framed} title="No mentors registered">
          A mentor is registered by an admin, or arrives on their first sign-in.
        </EmptyState>
      )
    );
  }

  return (
    <Table columns={COLUMNS} framed={framed}>
      {rows.map((m, i) => {
        // One chip, the first thing the model has to say about them. A row
        // wearing three chips is a row nobody reads; the full list is on their
        // own page, under a heading that says what to do about each.
        const [top] = mentorStatuses(
          {
            id: m.id,
            name: m.name,
            email: m.email,
            accountStatus: m.accountStatus,
            programCount: m.pairings,
            pairingsMissingLink: m.pairings - m.pairingsWithLink,
            averageRating: m.averageRating,
            ratingCount: m.ratingCount,
          },
          viewer
        );

        return (
          <Tr
            key={m.id}
            className="deal-in"
            style={{ animationDelay: `${Math.min(i, 14) * 24}ms` }}
          >
            <Td className={FILL_CELL}>
              <div className="flex items-center gap-1">
                <PersonCell
                  className="min-w-0 flex-1"
                  person={{
                    id: m.id,
                    name: m.name,
                    email: m.email,
                    avatarUpdatedAt: m.avatarUpdatedAt,
                  }}
                  href={`${href}/${m.id}`}
                >
                  {/* Muted text, never a chip: "also an admin" is a fact about
                      the account, and a coloured pill beside a status chip
                      reads as a second state to act on. */}
                  {m.isAdmin && (
                    <span className="shrink-0 text-xs font-normal text-muted-fg">
                      Admin
                    </span>
                  )}
                  {top && <StatusChip status={top} />}
                </PersonCell>
                {/* On a phone the row folds to its headline — who, and what
                    the students who met them said back. Programs, booking
                    links and the headcount are a tap behind the chevron. */}
                <RowFold label={m.name ?? m.email}>
                  {/* One line, and the star in ink: orange is the hours'
                      colour, and /feedback already draws its stars in ink. */}
                  {m.averageRating != null && (
                    <span className="flex items-center gap-1 whitespace-nowrap text-sm tabular-nums">
                      <StarIcon className="h-3.5 w-3.5 text-ink" />
                      <span className="font-semibold text-ink">
                        {m.averageRating.toFixed(1)}
                      </span>
                      <span className="text-xs text-muted-fg">({m.ratingCount})</span>
                    </span>
                  )}
                </RowFold>
              </div>
            </Td>

            <Td label="Programs" className="text-ink sm:min-w-56 lg:min-w-72" data-fold>
              {m.programs.length > 0 ? (
                // One per line. Joined with " · " they wrapped wherever the
                // column ran out, so "Master's" sat on one line and "Program"
                // on the next, and two programs read as three.
                <span className="flex flex-col items-start gap-y-1">
                  {m.programs.map(({ program, label }) => (
                    <ProgramChip
                      key={label}
                      program={{ ...program, name: label }}
                      variant="tag"
                    />
                  ))}
                </span>
              ) : (
                <span className="text-muted-fg">—</span>
              )}
            </Td>

            <Td label="Booking links" className="sm:whitespace-nowrap" data-fold>
              {m.pairings === 0 ? (
                <span className="text-muted-fg">—</span>
              ) : (
                // Missing links are a status — somebody cannot be booked — so
                // they say it the way every status does, a tinted chip with its
                // glyph. It was bare amber text, colour alone.
                m.pairingsWithLink < m.pairings ? (
                  <StatusChip severity="attention">
                    {m.pairingsWithLink} of {m.pairings} set
                  </StatusChip>
                ) : (
                  <span className="text-muted-fg">
                    {m.pairingsWithLink} of {m.pairings} set
                  </span>
                )
              )}
            </Td>

            <Td label="Students" align="right" tone="key" className="tabular-nums" data-fold>
              {m.students > 0 ? (
                m.students
              ) : (
                <span className="text-muted-fg">—</span>
              )}
            </Td>
          </Tr>
        );
      })}
    </Table>
  );
}
