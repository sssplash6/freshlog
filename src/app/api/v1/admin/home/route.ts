import { adminHomeFor } from "@/lib/api/v1/admin";
import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { scopeIsEmpty } from "@/lib/authz";
import { ROLES } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** The roles whose home /admin is, as `requireStaff` lets them in (src/lib/dal.ts). */
const STAFF = new Set<string>([ROLES.ADMIN, ROLES.DEPT_LEADER, ROLES.SALES]);

/**
 * A program admin's home: their programs, the school's figures, and what needs
 * them (`adminHomeFor`).
 *
 * Somebody who reads a program has one, at any level of grant, a platform
 * admin, whose school may be empty, and staff with no grant yet, whose home
 * says only that (STAFF_UNSCOPED). Anybody else is answered like a page that
 * does not exist, so the answer cannot be used to find out who administers.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const reader = await readerFor(user);
  // Staff with no grant have a home all the same, saying why it is empty, as /admin does (`requireStaff`).
  if (scopeIsEmpty(reader.read) && !STAFF.has(user.role)) return refused("Not found.", 404);
  return ok(await adminHomeFor(reader));
}
