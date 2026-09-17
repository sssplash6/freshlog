import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { cn } from "@/lib/cn";
import { personTone, type PersonTone } from "@/lib/person-tone";

/**
 * `avatarUpdatedAt` is optional so the many call sites that `select` only
 * id/name/email still typecheck — they simply render initials, as before.
 */
type Person = {
  id: string;
  name: string | null;
  email: string;
  avatarUpdatedAt?: Date | null;
};

/**
 * ONE RULE FOR NAMES, and it is decided by POSITION, not by who the person is:
 *
 *   PersonCell   the person IS the row — the first column of a table, a
 *                settings row's subject. Face, name at reading weight, the
 *                identifying detail quiet underneath.
 *   PersonChip   the person is a VALUE inside a row about something else — who
 *                ran this session, who owns this task, who holds this grant.
 *   PersonBadge  the face alone, where there is no room for a name.
 *   bare text    running prose only: a sentence, a receipt, a toast, an email,
 *                a notification message, a `title` or an aria-label.
 *
 * It was decided per call site instead, which is how the ledger ended up
 * stacking a bare-ink student on top of a coloured mentor pill IN THE SAME
 * CELL, and how one mentor was a cell, a chip and a badge on three pages.
 *
 * A person as a colored chip with their initials — the "Team" and "Mentor"
 * cells of the ledger. Everyone keeps one color across the whole app, so a
 * column of sessions can be read by who ran them without reading any names.
 * Once someone sets a profile picture it replaces the initials here.
 *
 * `size="sm"` is the in-table size; the default suits a page header. Passing
 * `href` turns the chip into a link (admins click a mentor through to their
 * page); the hover ring picks up the chip's own hue via `ring-current`, so one
 * rule covers all three tones.
 */
export function PersonChip({
  person,
  size = "md",
  href,
  tone: toneOverride,
  className,
}: {
  person: Person;
  size?: "sm" | "md";
  href?: string;
  /**
   * Wear somebody else's hue.
   *
   * Only one caller has a reason to: a program's own page, where every mentor
   * on the list belongs to that program and the owner asked for them to match
   * it. Identity is unambiguous there — the page is one program and the row is
   * one person — so the chip can spend its colour on the place instead. Nowhere
   * else: a mentor in three programs must not be three colours on the roster
   * that lists all three.
   */
  tone?: PersonTone;
  className?: string;
}) {
  const tone = toneOverride ?? personTone(person.id);
  const label = person.name ?? person.email;
  const sm = size === "sm";

  const classes = cn(
    "inline-flex max-w-full items-center rounded-full font-medium",
    tone.chip,
    sm ? "gap-1.5 py-0.5 pl-0.5 pr-2.5 text-xs" : "gap-2 py-1 pl-1 pr-3.5 text-sm",
    href &&
      "ring-1 ring-transparent transition-shadow hover:ring-current focus-visible:ring-current",
    className,
  );
  const title = person.name
    ? `${person.name} · ${person.email}`
    : person.email;

  const body = (
    <>
      {/* `sm` stays small: it sits in the dense ledger tables, where the name
          beside it does the identifying and row height is the scarce resource.
          `md` is the header/card size and has room for a face. */}
      <Avatar
        person={person}
        className={sm ? "h-5 w-5 text-[0.5625rem]" : "h-8 w-8 text-[0.6875rem]"}
      />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} title={title} className={classes}>
        {body}
      </Link>
    );
  }

  return (
    <span title={title} className={classes}>
      {body}
    </span>
  );
}

/**
 * The same person as a table cell: their face, their name, one line under it,
 * and — where a page exists for them — the whole block as the link to it.
 *
 * The chip is wrong in a first column. Its pill fills the cell, its hue
 * competes with the status chips beside the name, and a tinted background
 * repeated down forty rows stops meaning anything. What a row actually needs is
 * the name at reading weight with the identifying detail quiet underneath, and
 * that is what six files had each built by hand: `students-table.tsx`,
 * `mentor-list.tsx`, the mentor page's student table, the program settings
 * roster, `mentor-feedback-list.tsx` and the app shell's account block.
 *
 * THE AVATAR IS NOT DECORATION. Dropping the pill dropped the identity with
 * it, so the five tables that followed this rule were the five colourless
 * columns in the app — and `person-tone.ts` exists precisely so "a column can
 * be read by who is in it without reading any names". The face comes back; the
 * tint does not.
 *
 * The name is the way in wherever there is somewhere to go: clicking a person
 * should open them, not send the reader hunting for a link at the far right of
 * a row.
 *
 * `children` are the status chips that belong beside the name — pending
 * approval, not in any program — never a second line of prose.
 */
export function PersonCell({
  person,
  href,
  secondary,
  children,
  className,
}: {
  person: Person;
  href?: string;
  /**
   * The line under the name. Defaults to their email, and is dropped entirely
   * when the email IS the name — an invited person who has not signed in yet
   * should not have their address printed twice. Pass `false` for a dense
   * table that wants the name alone.
   */
  secondary?: React.ReactNode | false;
  children?: React.ReactNode;
  className?: string;
}) {
  const sub =
    secondary === false
      ? null
      : (secondary ?? (person.name ? person.email : null));

  const body = (
    <>
      <Avatar person={person} className="h-8 w-8 shrink-0 text-[0.6875rem]" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-x-2 font-medium text-ink group-hover:text-brand">
          <span className="min-w-0 truncate">{person.name ?? person.email}</span>
          {/* The name gives way, never the chip. These used to wrap to a
              second line when the two together outran the column, so a roster
              of forty stood at two different heights depending on how long
              somebody's name happened to be — and a ragged left edge reads as
              a difference in kind rather than in spelling. The chips here are
              short by contract (see above), so holding them on the line costs
              the longest name a few characters and nothing else. */}
          {children && (
            <span className="flex shrink-0 items-center gap-x-2 whitespace-nowrap">
              {children}
            </span>
          )}
        </span>
        {sub && (
          <span className="block min-w-0 truncate text-xs text-muted-fg">
            {sub}
          </span>
        )}
      </span>
    </>
  );

  if (href) {
    return (
      // 44px: in a stacked row on a phone this anchor is the only target, and
      // a one-line cell with no secondary would otherwise be about 20px tall.
      <Link
        href={href}
        className={cn(
          "group flex min-h-11 min-w-0 items-center gap-2.5",
          className,
        )}
      >
        {body}
      </Link>
    );
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {body}
    </div>
  );
}

/**
 * The initials badge on its own, for tight spots (a stack of mentors on one
 * row) where the full chip would not fit. Name stays available on hover.
 */
export function PersonBadge({
  person,
  className,
}: {
  person: Person;
  className?: string;
}) {
  return (
    <Avatar
      person={person}
      title={person.name ?? person.email}
      className={cn("h-6 w-6 text-[0.625rem] ring-2 ring-surface", className)}
    />
  );
}
