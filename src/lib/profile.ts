import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { adminScope, scopeIsEmpty } from "@/lib/authz";
import { canActAsMentor, ROLE_HOME, ROLES, type Role } from "@/lib/constants";
import type { User } from "@/generated/prisma/client";

/**
 * The lens: which half of the app a dual-role person is looking through.
 *
 * Nine of the ten admins also mentor students, so almost everybody on staff is
 * two people at once — one who allocates time and one who delivers it. The
 * switch between them used to be a pair of LINKS into two route trees, which
 * meant switching cost you your place: it needed a map of which page in one
 * tree corresponded to which page in the other, and where the map had no entry
 * you were dropped on a home screen mid-task.
 *
 * A cookie instead. It changes four things and no others:
 *
 *   1. which home `/` resolves to
 *   2. the items in the sidebar
 *   3. the default filter on the lists ("just mine" vs "all in my programs")
 *   4. which action on an entity page is the PRIMARY one
 *
 * What it never changes: what you may do. Authority is `authz.ts`, which reads
 * grants and reach and never reads this cookie — a server action ignores the
 * lens entirely. So a lens can never grant anything, and switching can never
 * take a control away. That is what lets the switch keep you where you are:
 * the page repaints, the URL does not move, and nothing you were mid-way
 * through disappears.
 */
export type Profile = "admin" | "mentor";

/**
 * Where the lens was kept before the account kept it. Still read, so somebody
 * who has not switched since keeps their side; no longer written.
 */
export const PROFILE_COOKIE = "profile";

/** Is this a lens at all? Everything reading the cookie is reading a string. */
export function isProfile(value: unknown): value is Profile {
  return value === "admin" || value === "mentor";
}

/**
 * Can this person be in both? Somebody who mentors AND administers: a dual-role
 * admin, or a mentor a grant made an admin. Nothing changes a mentor's `role`
 * when they are granted a program, so the admin half is asked of the scope, the
 * same question every gate asks. A plain mentor has one lens and a plain admin
 * has one, and a switch offering a view its owner cannot open is worse than no
 * switch.
 */
export async function canSwitchProfile(user: User): Promise<boolean> {
  if (!canActAsMentor(user)) return false;
  // A student who also mentors has two halves too. Their "admin" lens is the
  // student side — the lens names are staff words, kept so one cookie serves
  // everybody; the switch labels it "Student" (`ProfileSwitch`).
  if (user.role === ROLES.STUDENT) return true;
  return user.role === ROLES.ADMIN || !scopeIsEmpty(await adminScope(user));
}

/**
 * The lens as it was last set, before anybody's role is considered: the one on
 * their account (`User.profile`), which the website and the phone both write,
 * else this browser's cookie from before the account kept it.
 */
export const storedProfile = cache(async (user: User): Promise<Profile | null> => {
  if (isProfile(user.profile)) return user.profile;
  const value = (await cookies()).get(PROFILE_COOKIE)?.value;
  return isProfile(value) ? value : null;
});

/**
 * The lens this user is actually in.
 *
 * The stored lens only decides for somebody who has a choice. Everyone else has
 * exactly one honest answer, and a stale lens left behind by a role change —
 * an admin who stopped mentoring, a mentor made an admin — must not be able to
 * put them in a lens their pages do not fit.
 */
export const profileOf = cache(async (user: User): Promise<Profile> => {
  if (!(await canSwitchProfile(user))) {
    return canActAsMentor(user) ? "mentor" : "admin";
  }
  return (await storedProfile(user)) ?? "admin";
});

/**
 * The lens of a request that says which side it is on, as the app's do
 * (`?as=`): `profileOf`'s rule with the side asked for in place of the cookie.
 * Only somebody who has a choice gets the one they asked for; everyone else
 * gets their one honest answer, whatever they ask.
 */
export async function profileFrom(user: User, asked: string | null): Promise<Profile> {
  if (!(await canSwitchProfile(user))) {
    return canActAsMentor(user) ? "mentor" : "admin";
  }
  return isProfile(asked) ? asked : "admin";
}

/**
 * Where this person's home is: the lens first, their role second.
 *
 * Called by every gate that turns somebody away, so it has to answer for a
 * user in any state — including an admin whose grants were all removed, who is
 * sent to /admin to be told so rather than into a redirect loop (`requireStaff`
 * in dal.ts).
 */
export function homeFor(user: User, profile?: Profile | null): string {
  if (profile === "mentor" && canActAsMentor(user)) return "/mentor";
  if (user.role === ROLES.STUDENT) return "/student";
  // `profileOf` only answers "admin" for a MENTOR who was granted a program.
  if (profile === "admin" && user.role === ROLES.MENTOR) return "/admin";
  return ROLE_HOME[user.role as Role] ?? "/login";
}
