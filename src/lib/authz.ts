import "server-only";

import { cache } from "react";

import { prisma } from "@/lib/prisma";
import { mentorReachWhere } from "@/lib/queries";
import type { User } from "@/generated/prisma/client";

/**
 * Who may see and change what.
 *
 * Until the grants migration this was one question with one answer: `role ===
 * ADMIN` meant every program, every student and every figure in the app. The
 * owner runs three programs and wanted people who administer one of them, so
 * the answer is now a SCOPE — the set of programs a person holds a
 * `ProgramStaff` row for — and every gate in the app is a question about that
 * set rather than about a role.
 *
 * Two rules hold the model up:
 *
 *   1. A role grants NOTHING here. `role = ADMIN` with no rows is a person who
 *      administers no programs, and the pages say so rather than 404ing on
 *      every link. Access is a row somebody made, with their name on it.
 *   2. `platformAdmin` is the only exception, and it is deliberately total:
 *      "ALL" is not a set of every program id but a different answer, so a
 *      program created a second from now is inside it without anybody being
 *      re-granted.
 *
 * The mentor half of the app does not use scope at all — a mentor's reach is
 * their caseload, which `mentorReaches` asks once for everybody.
 *
 * This file answers questions; it never redirects. The gates that do —
 * `requireAdminAccess`, `requireProgramScope` — live in `dal.ts` beside every
 * other gate, which also keeps the session out of here so the model itself can
 * be tested without one.
 */

/** The programs someone administers: every one, or exactly these. */
export type AdminScope = "ALL" | ReadonlySet<string>;

/** What a person may do inside one program. */
export type StaffLevel = "ADMIN" | "LEADER" | "SALES";

/** A refusal a server action can return as-is. */
export type Denied = { ok: false; error: string };

/**
 * The programs this user administers.
 *
 * `cache()`d per request and keyed on the user object, which `getCurrentUser`
 * makes stable for the whole request — so a page that asks four times (its
 * gate, two queries and a link) pays for one lookup.
 *
 * Explicit grants only: no fallback to `role`, and no "admins see everything
 * when they hold nothing", which is how a permission model quietly returns to
 * the one it replaced.
 */
export const adminScope = cache(async (user: User): Promise<AdminScope> => {
  if (user.platformAdmin) return "ALL";
  const grants = await prisma.programStaff.findMany({
    where: { userId: user.id },
    select: { programId: true },
  });
  return new Set(grants.map((g) => g.programId));
});

/** Does this scope reach this program? */
export function scopeCovers(scope: AdminScope, programId: string): boolean {
  return scope === "ALL" || scope.has(programId);
}

/** Does this scope reach anything at all? */
export function scopeIsEmpty(scope: AdminScope): boolean {
  return scope !== "ALL" && scope.size === 0;
}

/**
 * What this person may do inside one program, or null if they may not see it.
 *
 * LEADER and SALES are the two old roles, kept as grant levels so the model can
 * still say what they said. Nothing grants them today; the UI writes ADMIN.
 */
export async function staffLevel(
  user: User,
  programId: string
): Promise<StaffLevel | null> {
  if (user.platformAdmin) return "ADMIN";
  const grant = await prisma.programStaff.findUnique({
    where: { userId_programId: { userId: user.id, programId } },
    select: { role: true },
  });
  if (!grant) return null;
  return grant.role === "LEADER" || grant.role === "SALES"
    ? grant.role
    : "ADMIN";
}

/** May this person administer this program? */
export async function canManageProgram(
  user: User,
  programId: string
): Promise<boolean> {
  return scopeCovers(await adminScope(user), programId);
}

/**
 * May this person administer this student? Their programs decide — ANY of
 * them.
 *
 * Overlap, not equality, since a student may study in several: an admin of the
 * Master's Program administers a student who is also in Global Admissions,
 * because one of the two is theirs. What that admin may then SEE of the
 * student is a narrower question — `studentScope` below — and the two are
 * deliberately separate: reaching the page must not mean reading another
 * program's ledger on it.
 */
export async function canManageStudent(
  user: User,
  profile: { enrollments: readonly { programId: string }[] }
): Promise<boolean> {
  const scope = await adminScope(user);
  if (scope === "ALL") return profile.enrollments.length > 0;
  return profile.enrollments.some((e) => scope.has(e.programId));
}

/**
 * WHICH of a student's programs this person may read — the answer every page
 * about one student filters its ledger by.
 *
 * A platform admin gets every program the student is in; anybody else gets the
 * intersection with their grants. Empty means they administer none of the
 * student's programs, which `canManageStudent` has already turned away.
 */
export async function studentScope(
  user: User,
  profile: { enrollments: readonly { programId: string }[] }
): Promise<string[]> {
  const scope = await adminScope(user);
  const ids = profile.enrollments.map((e) => e.programId);
  if (scope === "ALL") return ids;
  return ids.filter((id) => scope.has(id));
}

/**
 * May this person administer this mentor?
 *
 * A mentor belongs to programs, not to an admin, so the rule is overlap: at
 * least one program they are paired with is in this admin's scope. A mentor
 * who is paired with nothing — a fresh sign-up waiting to be placed — belongs
 * to no program and so is nobody's to edit but a platform admin's. Placing
 * them is a different question, asked of the target program instead
 * (`assignMentorToProgram`), which is how they get out of that state.
 */
export async function canManageMentor(
  user: User,
  mentorId: string
): Promise<boolean> {
  const scope = await adminScope(user);
  if (scope === "ALL") return true;
  if (scope.size === 0) return false;
  const shared = await prisma.mentorAssignment.findFirst({
    where: { mentorId, programId: { in: [...scope] } },
    select: { id: true },
  });
  return shared !== null;
}

/**
 * Does this mentor reach this student — the one reach rule, asked about one
 * person.
 *
 * The rule itself lives in `mentorReachWhere` beside the caseload it builds,
 * because "who are my students" and "is this one of mine" have to be the same
 * question or a mentor gets a student on their list they then cannot open. The
 * fifth leg — everyone else in a program they work in — is what makes a
 * meeting recordable before any grant exists, so it is included here and
 * excluded from the caseload.
 */
export async function mentorReaches(
  mentor: User,
  profile: { id: string }
): Promise<boolean> {
  const pairings = await prisma.mentorAssignment.findMany({
    where: { mentorId: mentor.id },
    select: { programId: true, cohortId: true },
  });
  const match = await prisma.studentProfile.findFirst({
    where: {
      id: profile.id,
      ...mentorReachWhere(mentor.id, { pairings, includeProgram: true }),
    },
    select: { id: true },
  });
  return match !== null;
}

/**
 * Scope check for a server action, as a returnable refusal.
 *
 *   const denied = await assertProgramScope(actor, profile.programId);
 *   if (denied) return denied;
 *
 * The sentence never says whether the program exists: an action is a poorer
 * place to leak that than a page, because it answers in milliseconds and can
 * be called in a loop.
 */
export async function assertProgramScope(
  actor: User | null,
  programId: string
): Promise<Denied | null> {
  if (!actor) return { ok: false, error: "Sign in to do that." };
  const scope = await adminScope(actor);
  if (scopeCovers(scope, programId)) return null;
  return {
    ok: false,
    error: "You don't administer that program.",
  };
}

/**
 * The same check, asked about a STUDENT rather than a program id: does the
 * actor administer any program this student is in?
 *
 * A separate function because the two refusals are different sentences and the
 * wrong one leaks. "You don't administer that program" is right when the caller
 * named a program; a student page never did — the actor picked a person, and
 * the honest answer is about the person.
 */
export async function assertStudentScope(
  actor: User | null,
  profile: { enrollments: readonly { programId: string }[] }
): Promise<Denied | null> {
  if (!actor) return { ok: false, error: "Sign in to do that." };
  if (await canManageStudent(actor, profile)) return null;
  return {
    ok: false,
    error: "You don't administer any program this student is in.",
  };
}

/**
 * Platform-only writes: creating a program, granting somebody access, and
 * changing a person's name or login email.
 *
 * The last one is not obvious and is the reason this exists separately. Once
 * admins are peers rather than one global set, an admin who can edit another
 * admin's email address can take their account — so the edit belongs to the
 * people who can already grant themselves anything.
 */
export function assertPlatformAdmin(actor: User | null): Denied | null {
  if (!actor) return { ok: false, error: "Sign in to do that." };
  if (actor.platformAdmin) return null;
  return {
    ok: false,
    error: "Only a platform admin can do that.",
  };
}

/**
 * The scope as a filter argument, where `undefined` means every program.
 *
 * That convention is `FilterScope.programIds`', and matching it is the whole
 * point: a list page's reach becomes one expression it passes down, and the
 * `where` builders already AND it in ahead of anything the URL says.
 */
export function scopeProgramFilter(
  scope: AdminScope
): readonly string[] | undefined {
  return scope === "ALL" ? undefined : [...scope];
}

/**
 * Every program in scope, as ids, for a query that needs a list.
 *
 * "ALL" has to become real ids somewhere, and this is the only place it does —
 * one query, `cache()`d with the scope it came from.
 */
export const scopeProgramIds = cache(
  async (scope: AdminScope): Promise<string[]> => {
    if (scope !== "ALL") return [...scope];
    const programs = await prisma.program.findMany({ select: { id: true } });
    return programs.map((p) => p.id);
  }
);
