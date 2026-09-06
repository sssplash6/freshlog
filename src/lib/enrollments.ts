/**
 * A student's programs, as the rest of the app asks about them.
 *
 * `StudentProfile.programId` was a single column until 6 September 2026, and
 * every question about a student's program was a field access. Now a student
 * holds a `StudentEnrollment` row per program, and the same questions are set
 * questions — "is any of theirs in my scope?", "which of theirs does this
 * mentor work in?", "what do I call this on a row?".
 *
 * Pure and Prisma-free on purpose: the label helpers run in client components
 * (a table cell, a picker), and the set helpers are the ones `authz.ts` and the
 * server actions lean on, so they must be testable without a database.
 */

/** The least an enrollment has to carry to be named on screen. */
export type NamedEnrollment = {
  programId: string;
  cohortId?: string | null;
  program: { name: string };
  cohort?: { name: string } | null;
};

/** Just the ids — what a scope check needs. */
export type EnrolledIn = { programId: string; cohortId?: string | null };

/** The programs a student is in. */
export function programIdsOf(
  enrollments: readonly EnrolledIn[]
): string[] {
  return enrollments.map((e) => e.programId);
}

/** Is this student in this program? */
export function enrolledIn(
  enrollments: readonly EnrolledIn[],
  programId: string
): boolean {
  return enrollments.some((e) => e.programId === programId);
}

/**
 * One enrollment as a phrase: "Master's Program", or "Global Admissions /
 * Spring 25" where the program has cohorts.
 */
export function enrollmentLabel(e: NamedEnrollment): string {
  return e.cohort ? `${e.program.name} / ${e.cohort.name}` : e.program.name;
}

/**
 * Every enrollment as one phrase, in a stable order.
 *
 * Separated by " · " to match how the rest of the app joins facts on one line
 * (`mentors/[id]`, the session rows). A student in no program at all reads as
 * an em dash rather than an empty cell — the row still has to be legible, and
 * "no program" is a state the inbox flags rather than one a table hides.
 */
export function enrollmentsLabel(
  enrollments: readonly NamedEnrollment[],
  empty = "—"
): string {
  if (enrollments.length === 0) return empty;
  return sortEnrollments(enrollments).map(enrollmentLabel).join(" · ");
}

/** Alphabetical by program, so two readings of the same student agree. */
export function sortEnrollments<T extends NamedEnrollment>(
  enrollments: readonly T[]
): T[] {
  return [...enrollments].sort((a, b) =>
    a.program.name.localeCompare(b.program.name)
  );
}

/**
 * The enrollment to answer with when only one may be shown — a notification
 * sentence, a welcome email, the eyebrow over a page title.
 *
 * The first alphabetically, which is arbitrary but stable; every caller that
 * can show all of them shows all of them, and this exists for the ones that
 * genuinely have room for one word.
 */
export function primaryEnrollment<T extends NamedEnrollment>(
  enrollments: readonly T[]
): T | null {
  return sortEnrollments(enrollments)[0] ?? null;
}

/**
 * The programs both sides have in common — a student's enrollments against a
 * scope, a mentor's pairings, another student's programs.
 *
 * `undefined` for the second argument means "every program", matching the
 * `FilterScope.programIds` convention, so a platform admin's reach is the
 * student's own list rather than an empty intersection.
 */
export function overlap(
  enrollments: readonly EnrolledIn[],
  programIds: readonly string[] | undefined
): string[] {
  const ids = programIdsOf(enrollments);
  if (programIds === undefined) return ids;
  const allowed = new Set(programIds);
  return ids.filter((id) => allowed.has(id));
}
