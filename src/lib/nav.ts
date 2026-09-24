import "server-only";

import { adminScope, scopeIsEmpty, staffLevel, type StaffLevel } from "@/lib/authz";
import { canActAsMentor, ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { Profile } from "@/lib/profile";
import type { User } from "@/generated/prisma/client";

/**
 * What this person can reach, as a list of places.
 *
 * This replaces `NAV_BY_ROLE`, a `Record<Role, NavItem[]>`, and the reason is
 * that a static map keyed on a role cannot say the one thing the nav now has to
 * say: access is a GRANT. `role = ADMIN` is a person who administers whichever
 * programs somebody put their name on — three, one, or none — and a constant
 * array has no way to hold "one, and it is called Master's". So the items are
 * derived from the same two questions every gate asks (`adminScope`,
 * `staffLevel`) rather than from a second, parallel idea of who someone is.
 *
 * Two consequences worth stating, because they are the point:
 *
 *   A scoped admin with exactly ONE program sees that program's NAME where a
 *   platform admin sees a list. There is no program switcher anywhere in the
 *   app (§4.3) — a program is an entity and a filter, not a silo — so for the
 *   person who only ever works in one, naming it is the whole of the context
 *   they need.
 *
 *   An admin with NO grants gets a single item. Their inbox is where they are
 *   told they hold nothing, and a sidebar offering them four lists that would
 *   all be empty is a sidebar that argues with the page.
 *
 * The lens (`profile`) chooses between the two staff item sets and nothing
 * else. It cannot add an item — `adminScope` decides that — which is what keeps
 * the switch honest: pressing ⌥M can never reveal a place you could not already
 * go.
 */

export type NavItem = {
  href: string;
  label: string;
  /**
   * A number beside the label.
   *
   * ONLY Inbox carries one in the rail; the bell in the corner carries the
   * other. A count is a claim that something is waiting; put one on Students
   * and it reads as a queue rather than a roster, and a reader who learns that
   * one badge is decorative stops believing the two that are not.
   */
  count?: number;
};

const STUDENT_NAV: NavItem[] = [
  { href: "/student", label: "Home" },
  { href: "/student/book", label: "Book" },
  { href: "/student/feedback", label: "Feedback" },
];

/**
 * ADMIN > LEADER > SALES, across every program somebody holds.
 *
 * Somebody who administers one program and sells into another needs the full
 * item set: the pages narrow themselves to the grants behind them, so a Mentors
 * link they hold in one program shows them that program's mentors and nothing
 * else. Taking the link away instead would hide a right they actually have.
 */
function widest(levels: readonly (StaffLevel | null)[]): StaffLevel {
  if (levels.includes("ADMIN")) return "ADMIN";
  if (levels.includes("LEADER")) return "LEADER";
  return "SALES";
}

/**
 * The items for the staff lens, narrowed by what this person was granted.
 *
 * `inbox` is the count of Active-issues rows and arrives from the caller because
 * nothing computes it cheaply yet: every home builds its own attention list out
 * of its whole roster, and the shell asking the same question again would
 * double the cost of every page. It becomes a shared query with `/inbox` in
 * Phase 6; until then the item simply carries no number.
 */
async function staffNav(viewer: User, inbox?: number): Promise<NavItem[]> {
  const scope = await adminScope(viewer);
  const inboxItem: NavItem = { href: "/admin", label: "Inbox", count: inbox };
  if (scopeIsEmpty(scope)) return [inboxItem];

  const ids = scope === "ALL" ? [] : [...scope];
  const level: StaffLevel =
    scope === "ALL"
      ? "ADMIN"
      : widest(await Promise.all(ids.map((id) => staffLevel(viewer, id))));

  // The program item, for the person whose scope IS one program. One extra
  // read, and only for them: a platform admin returns "ALL" above without
  // touching the grant table at all.
  const onlyProgram =
    ids.length === 1
      ? await prisma.program.findUnique({
          where: { id: ids[0] },
          select: { id: true, name: true },
        })
      : null;
  // One program is a name, not an index: an index of one is a page whose only
  // content is a link. More than one, and it is the list.
  const programItem: NavItem[] = onlyProgram
    ? [{ href: `/programs/${onlyProgram.id}`, label: onlyProgram.name }]
    : [{ href: "/programs", label: "Programs" }];

  const students: NavItem = { href: "/students", label: "Students" };
  const feedback: NavItem = { href: "/feedback", label: "Feedback" };

  if (level === "SALES") return [inboxItem, students, ...programItem];
  if (level === "LEADER") return [inboxItem, students, feedback, ...programItem];

  return [
    inboxItem,
    students,
    { href: "/mentors", label: "Mentors" },
    ...programItem,
    { href: "/sessions", label: "Sessions" },
    { href: "/analytics", label: "Analytics" },
    feedback,
  ];
}

/**
 * The mentor lens: what a mentor delivers, and to whom.
 *
 * Students is missing, and it is the one omission that costs something: today
 * `/mentor` IS the caseload as well as the inbox, so a second item would be the
 * same page under a different name. Commit 40 splits them.
 */
function mentorNav(inbox?: number): NavItem[] {
  return [
    { href: "/mentor", label: "Inbox", count: inbox },
    // Always "Programs", never collapsed to a single program's name the way
    // the staff rail does: the name in that rail is a link into the program's
    // own ledger, and a mentor cannot read one. This item goes to their own
    // page about the same places (`programs/mentor-programs.tsx`).
    { href: "/programs", label: "Programs" },
    { href: "/sessions", label: "Sessions" },
    { href: "/feedback", label: "Feedback" },
  ];
}

export async function navFor(
  viewer: User,
  profile: Profile,
  inbox?: number
): Promise<NavItem[]> {
  // Role first, not lens. `profileOf` answers "admin" for anybody who cannot
  // mentor, students included — the lens is a staff idea and a student is
  // never in one.
  if (viewer.role === ROLES.STUDENT) return STUDENT_NAV;
  if (profile === "mentor" && canActAsMentor(viewer)) return mentorNav(inbox);
  return staffNav(viewer, inbox);
}
