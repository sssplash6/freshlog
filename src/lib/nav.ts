import "server-only";

import { adminScope, scopeIsEmpty, staffLevel, type StaffLevel } from "@/lib/authz";
import { classProgramIds } from "@/lib/classes";
import { canActAsMentor, inStudentLens } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { Profile } from "@/lib/profile";
import { SCHOOL, type Space } from "@/lib/space";
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
 *   An admin with NO grants gets a single item. Their home is where they are
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
   * ONLY the home item may carry one in the rail; the bell in the corner
   * carries the other. A count is a claim that something is waiting; put one
   * on Students and it reads as a queue rather than a roster, and a reader
   * who learns that one badge is decorative stops believing the two that are
   * not.
   */
  count?: number;
  /**
   * A heading the rail prints above the first item of a run that shares it.
   * Only the institute's levels carry one: they are several items standing in
   * for the one program item everybody else has, and four bare level names in
   * a column of places read as four more places rather than one place's parts.
   */
  group?: string;
};

/**
 * The school's hours, on every mentor and staff rail: `/analytics` asks only
 * that you are not a student, so no lens and no grant can take it away.
 */
const analytics: NavItem = { href: "/analytics", label: "Analytics" };

const STUDENT_NAV: NavItem[] = [
  { href: "/student", label: "Home" },
  { href: "/student/book", label: "Book" },
  { href: "/student/interviews", label: "Interviews" },
  // No Feedback tab: reporting a mentor is the big button under the greeting on
  // Home (components/report-mentor-button.tsx), not a fourth word in the bar.
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
 * The widest grant somebody holds, as `staffNav` reads it for the items it
 * draws (a platform admin is ADMIN), or null for nobody's staff. The freshlog
 * app reads it to offer the same items.
 */
export async function navLevel(viewer: User): Promise<StaffLevel | null> {
  const scope = await adminScope(viewer);
  if (scopeIsEmpty(scope)) return null;
  if (scope === "ALL") return "ADMIN";
  return widest(await Promise.all([...scope].map((id) => staffLevel(viewer, id))));
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
async function staffNav(
  viewer: User,
  space: Space,
  inbox?: number
): Promise<NavItem[]> {
  const scope = await adminScope(viewer);
  // "Home", not "Inbox": the attention rows this used to promise live behind
  // the bell at /notifications — a label that named them on a page that no
  // longer holds them sent readers looking for a list that is not there.
  const inboxItem: NavItem = { href: "/admin", label: "Home", count: inbox };
  if (scopeIsEmpty(scope)) return [inboxItem, analytics];

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
  //
  // An institute is a program with parts, and somebody whose whole scope it is
  // gets the parts: the roster as a whole, then each level, under one heading.
  // The rail already names the institute at its top, so the program's name
  // would be the same fact twice. An institute with no levels yet is just a
  // program, and gets the program's item.
  const programItem: NavItem[] =
    space.kind === "institute" && space.levels.length > 0
      ? [
          { href: `/programs/${space.programId}`, label: "All levels", group: "Levels" },
          ...space.levels.map((l) => ({
            href: `/programs/${space.programId}?level=${l.id}`,
            label: l.name,
            group: "Levels",
          })),
        ]
      : onlyProgram
        ? [{ href: `/programs/${onlyProgram.id}`, label: onlyProgram.name }]
        : [{ href: "/programs", label: "Programs" }];

  const students: NavItem = { href: "/students", label: "Students" };
  const feedback: NavItem = { href: "/feedback", label: "Feedback" };

  if (level === "SALES") return [inboxItem, students, ...programItem, analytics];
  if (level === "LEADER")
    return [inboxItem, students, feedback, ...programItem, analytics];

  return [
    inboxItem,
    students,
    { href: "/mentors", label: "Mentors" },
    ...programItem,
    { href: "/sessions", label: "Sessions" },
    ...(await classesItem(viewer)),
    // Students' practice interviews: who met whom and for how long, never
    // what was said (lib/interview-prep.ts).
    { href: "/interviews", label: "Interview prep" },
    analytics,
    feedback,
  ];
}

/**
 * Classes, for the people whose programs schedule them — and nobody else. The
 * item exists only where `classProgramIds` finds a program with the setting on,
 * which is what keeps scheduling exclusive to the department that asked for it.
 */
async function classesItem(viewer: User): Promise<NavItem[]> {
  return (await classProgramIds(viewer)).length > 0
    ? [{ href: "/classes", label: "Classes" }]
    : [];
}

/**
 * The mentor lens: what a mentor delivers, and to whom.
 *
 * Students is missing, and it is the one omission that costs something: today
 * `/mentor` IS the caseload as well as the inbox, so a second item would be the
 * same page under a different name. Commit 40 splits them.
 */
async function mentorNav(viewer: User, inbox?: number): Promise<NavItem[]> {
  return [
    // Same rename as the staff rail: the page is the mentor's home and
    // caseload, and the inbox it promised is the bell's now. Not "Students" —
    // mentors can open the real /students too, and two items named the same
    // thing going to different places is the confusion this rename removes.
    { href: "/mentor", label: "Home", count: inbox },
    // Always "Programs", never collapsed to a single program's name the way
    // the staff rail does: the name in that rail is a link into the program's
    // own ledger, and a mentor cannot read one. This item goes to their own
    // page about the same places (`programs/mentor-programs.tsx`).
    { href: "/programs", label: "Programs" },
    { href: "/sessions", label: "Sessions" },
    ...(await classesItem(viewer)),
    // Practice interviews with their students: not sessions, no hours.
    { href: "/mentor/interviews", label: "Interviews" },
    { href: "/feedback", label: "Feedback" },
    analytics,
  ];
}

export async function navFor(
  viewer: User,
  profile: Profile,
  space: Space = SCHOOL,
  inbox?: number
): Promise<NavItem[]> {
  // Role first, not lens. `profileOf` answers "admin" for anybody who cannot
  // mentor, students included — the lens is a staff idea and a student is
  // never in one, unless they are a student who also mentors and have
  // switched to the mentor half.
  if (inStudentLens(viewer, profile)) return STUDENT_NAV;
  if (profile === "mentor" && canActAsMentor(viewer)) return mentorNav(viewer, inbox);
  return staffNav(viewer, space, inbox);
}
