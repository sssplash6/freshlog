import "server-only";

import { cache } from "react";

import { canActAsMentor, USER_STATUS } from "@/lib/constants";
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
 *
 * This is the READ answer — every level of grant reads the program. What a
 * grant lets its holder CHANGE is `adminWriteScope`, which is a different set.
 */
export const adminScope = cache(async (user: User): Promise<AdminScope> => {
  if (user.platformAdmin) return "ALL";
  const grants = await prisma.programStaff.findMany({
    where: { userId: user.id },
    select: { programId: true },
  });
  return new Set(grants.map((g) => g.programId));
});

/**
 * The programs this user may CHANGE — the write half of `adminScope`.
 *
 * `adminScope` counts every grant, because every level is a read: a LEADER
 * reads the program and its feedback, a SALES grant reads its students. Only
 * an ADMIN-level row writes — a grant that named a level and still let the
 * holder log, void and delete sessions would be a read-only badge on a
 * read-write key, which is exactly the bug the level select once shipped.
 *
 * Every write assertion below asks THIS scope; every page that reads asks
 * `adminScope`. Never answer a write question with the read set.
 */
export const adminWriteScope = cache(
  async (user: User): Promise<AdminScope> => {
    if (user.platformAdmin) return "ALL";
    const grants = await prisma.programStaff.findMany({
      where: { userId: user.id, role: "ADMIN" },
      select: { programId: true },
    });
    return new Set(grants.map((g) => g.programId));
  }
);

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
 * LEADER and SALES are the two old roles, kept as grant levels. Both are
 * read-only memberships of `adminScope`: they open the program's pages and
 * decide which nav a person gets, and `adminWriteScope` keeps them out of
 * every write. Only ADMIN changes the program.
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

/**
 * May this person administer this program — as a WRITE question.
 *
 * The name predates the split: it is only ever asked where a change is about
 * to happen (logging for somebody else, deleting a session), so it answers
 * from `adminWriteScope`, and a LEADER's read grant does not pass it.
 */
export async function canManageProgram(
  user: User,
  programId: string
): Promise<boolean> {
  return scopeCovers(await adminWriteScope(user), programId);
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
 * May this person WRITE this student's record — the `canManageStudent` rule
 * asked of `adminWriteScope` instead. Every affordance for a change and every
 * action that takes one asks this question; `canManageStudent` remains the
 * read answer.
 */
export async function canAdministerStudent(
  user: User,
  profile: { enrollments: readonly { programId: string }[] }
): Promise<boolean> {
  const scope = await adminWriteScope(user);
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
 * May this person CHANGE this mentor's record — `canManageMentor` asked of
 * `adminWriteScope`, for the edit affordance and the actions behind it.
 */
export async function canAdministerMentor(
  user: User,
  mentorId: string
): Promise<boolean> {
  const scope = await adminWriteScope(user);
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
 * fifth leg — everyone else enrolled in a program they work in — is what makes
 * a meeting recordable before any grant exists, so it is included here and
 * excluded from the caseload.
 *
 * That fifth leg is the whole of the mentor half of the model, stated once: a
 * mentor assigned to a program may log hours with anybody in that program.
 * Nothing further has to be granted for the meeting to be recordable, and
 * every other gate in the app defers to this function rather than re-deriving
 * it — which is what stops a picker offering somebody the form then refuses,
 * or a page disabling a button the action would have accepted.
 */
export async function mentorReaches(
  mentor: User,
  profile: { id: string }
): Promise<boolean> {
  const match = await prisma.studentProfile.findFirst({
    where: {
      id: profile.id,
      ...mentorReachWhere(mentor.id, { includeProgram: true }),
    },
    select: { id: true },
  });
  return match !== null;
}

/**
 * Has this mentor EVER worked with this student — a grant, a session or a task,
 * current or long gone.
 *
 * Narrower than `mentorReaches`, which also admits every mentor in the
 * student's program: that is the right width for logging an hour, and the wrong
 * one for reading what a student wrote in a practice interview. Those are
 * answers and private notes, so only the mentors who have actually held time
 * with them — and who stay mentors of theirs after a grant expires or is
 * forfeited — may read them.
 */
export async function mentorHasWorkedWith(
  mentor: User,
  profile: { id: string }
): Promise<boolean> {
  const match = await prisma.studentProfile.findFirst({
    where: { id: profile.id, ...mentorReachWhere(mentor.id) },
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
  const scope = await adminWriteScope(actor);
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
  if (await canAdministerStudent(actor, profile)) return null;
  return {
    ok: false,
    error: "You don't administer any program this student is in.",
  };
}

/**
 * May this actor correct a fact about the STUDENT themselves — their name?
 *
 * Two ways in, and they are the two people who ever find out a name is wrong.
 * An admin of any program the student is in, which is `assertStudentScope`.
 * And the mentor who reaches them: a mentor sits with the person every week
 * and is the one who learns that the roster says "Malika" and she is Malika
 * Karimova, or that the import transliterated her surname. Sending them to
 * find an admin for a spelling is how a roster stays wrong.
 *
 * Deliberately NARROWER than the Details panel beside it. An email address is
 * a sign-in — changing one hands somebody a working login as that person — and
 * a folder link and an enrollment are the program's own records. A display
 * name grants nothing and reveals nothing, so it is the one fact of a
 * student's that a mentor may put right.
 *
 * Reach, not assignment, unlike `assertTaskScope`: a mentor who can log a
 * session with somebody can read their name on every row they write, so they
 * are already close enough to know it.
 */
export async function assertStudentReach(
  actor: User | null,
  profile: { id: string; enrollments: readonly { programId: string }[] }
): Promise<Denied | null> {
  if (!actor) return { ok: false, error: "Sign in to do that." };
  if (await canAdministerStudent(actor, profile)) return null;
  if (canActAsMentor(actor) && (await mentorReaches(actor, profile))) {
    return null;
  }
  return {
    ok: false,
    error: "You don't work with that student.",
  };
}

/**
 * May this actor correct a TASK?
 *
 * Two ways in, and the second is new. An admin whose scope covers the task's
 * own program may always correct it — that is `assertProgramScope`, and it was
 * the only rule until 9 September 2026. The mentor the task belongs to may now
 * correct it too, because they are the person who finds out it is wrong: they
 * are the one who discovers the budget was set for the wrong essay, that the
 * deadline moved, or that the work is further along than the row says. Sending
 * them to find an admin to change a note on their own task is how a plan stops
 * describing the work.
 *
 * The task's OWN `programId` decides the admin half, never the student's
 * enrollments: a student in two programs must not have their Master's Program
 * plan corrected by Global Admissions' admin.
 *
 * Assignment, not reach. A mentor who merely has access to the student is not
 * the owner of somebody else's task, and an UNASSIGNED task belongs to nobody
 * — giving it a mentor is the admin write that creates the ownership this
 * checks for.
 */
export async function assertTaskScope(
  actor: User | null,
  task: { programId: string; mentorId: string | null }
): Promise<Denied | null> {
  if (!actor) return { ok: false, error: "Sign in to do that." };
  if (
    task.mentorId === actor.id &&
    canActAsMentor(actor) &&
    actor.status === USER_STATUS.ACTIVE
  ) {
    return null;
  }
  const scope = await adminWriteScope(actor);
  if (scopeCovers(scope, task.programId)) return null;
  return {
    ok: false,
    error: "That task is not yours to change.",
  };
}

/**
 * May this actor set this student a TASK — work to go away and do — inside this
 * program?
 *
 * Two people, and they are the two who sit close enough to the work to know
 * what it should be. A mentor who works in the program: this is the feature's
 * whole point, because the person who finds out that a draft needs rewriting
 * before Thursday is the one who just read it. And an admin of the program,
 * because they administer the plan the task hangs off and are the person a
 * mentor's departure leaves it with.
 *
 * Narrower than `assertStudentReach`, which a mentor passes by merely holding a
 * task somebody moved onto their list. Setting work in a program's name is an
 * act on that PROGRAM's behalf — the same reasoning as `assertExchangeSender` —
 * so the mentor must actually work there and the student must actually be
 * there. A student visiting on an exchange counts: the placement made them a
 * member of the host program for as long as the hours last, and the tasks of
 * that visit are the host's to set, exactly as the sessions are.
 *
 * The refusals deliberately say the same thing about a program that does not
 * exist and one the actor has nothing to do with.
 */
export async function assertTaskAssigner(
  actor: User | null,
  profile: { enrollments: readonly { programId: string }[] },
  programId: string
): Promise<Denied | null> {
  if (!actor) return { ok: false, error: "Sign in to do that." };
  const enrolled = profile.enrollments.some((e) => e.programId === programId);
  if (enrolled) {
    const scope = await adminWriteScope(actor);
    if (scopeCovers(scope, programId)) return null;
    if (canActAsMentor(actor) && actor.status === USER_STATUS.ACTIVE) {
      const works = await prisma.mentorAssignment.findFirst({
        where: { mentorId: actor.id, programId },
        select: { id: true },
      });
      if (works) return null;
    }
  }
  return {
    ok: false,
    error: "You don't work with that student in that program.",
  };
}

/**
 * May this actor lend this student to another program?
 *
 * The sending program decides, and two people speak for it: an admin of it, and
 * a mentor who works in it. The mentor half is the point of the feature — the
 * person who finds out that a student needs seven hours of another program's
 * help is the mentor sitting with them, and making them find an admin first is
 * how the arrangement goes on happening over Telegram instead.
 *
 * Assignment to the program, not reach of the student: `mentorReaches` includes
 * a mentor who merely holds a task moved onto their list, and lending somebody
 * out is an act on the PROGRAM's behalf — it commits that program's name to a
 * placement and spends nothing of the mentor's own. So the mentor must actually
 * work there, and the student must actually study there — the caller passes
 * their own enrollments, never a visit they are already on.
 *
 * What it does NOT check is the destination. Sending is a decision about your
 * own program; the host's admins decide what to do with it, up to and including
 * handing them straight back (`returnExchange`).
 */
export async function assertExchangeSender(
  actor: User | null,
  profile: { enrollments: readonly { programId: string }[] },
  fromProgramId: string
): Promise<Denied | null> {
  if (!actor) return { ok: false, error: "Sign in to do that." };
  if (!profile.enrollments.some((e) => e.programId === fromProgramId)) {
    return { ok: false, error: "That student doesn't study in that program." };
  }
  const scope = await adminWriteScope(actor);
  if (scopeCovers(scope, fromProgramId)) return null;
  if (canActAsMentor(actor) && actor.status === USER_STATUS.ACTIVE) {
    const works = await prisma.mentorAssignment.findFirst({
      where: { mentorId: actor.id, programId: fromProgramId },
      select: { id: true },
    });
    if (works) return null;
  }
  return {
    ok: false,
    error: "You don't work in the program that would be sending them.",
  };
}

/**
 * May this actor call an exchange off?
 *
 * Either end may, and they mean different things by it: the host says "we
 * cannot take this on", the sender says "never mind". Both are the same write
 * and both are refused once anything has been logged — a delivered hour is
 * history, not a placement anybody can undo.
 *
 * The mentor who sent them is included by name. They are usually not an admin
 * of anything, and a person who can make an arrangement should be able to
 * unmake it while it is still only an arrangement.
 */
export async function assertExchangeParty(
  actor: User | null,
  exchange: { fromProgramId: string; toProgramId: string; sentById: string }
): Promise<Denied | null> {
  if (!actor) return { ok: false, error: "Sign in to do that." };
  if (actor.id === exchange.sentById) return null;
  const scope = await adminWriteScope(actor);
  if (
    scopeCovers(scope, exchange.toProgramId) ||
    scopeCovers(scope, exchange.fromProgramId)
  ) {
    return null;
  }
  return {
    ok: false,
    error: "That exchange is between two programs you don't administer.",
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

/**
 * Logged sessions as the STUDENT they are about may read them.
 *
 * A session note is written by a mentor for the people who run the programme:
 * what was covered, what the student struggled with, what to pick up next. The
 * student is the SUBJECT of it, not its reader. They see that the meeting
 * happened, how long it ran, which agenda item it went toward and what it cost
 * them, and they can answer it — they do not read the write-up of themselves.
 *
 * Stripped HERE rather than by the row that draws it, and that is the whole
 * point of this function existing. `SessionRow` is a client component: a
 * version of it that simply does not print `note` still ships every note
 * inside the RSC payload, where it is one View Source away. A fact a reader
 * may not have must not be sent to them.
 *
 * Deliberately NOT keyed on `ViewerContext`. That type decides whose WORDS a
 * chip is in and says so at its definition — "never who may act" — and reusing
 * it as a permission is how a wording change silently becomes a disclosure.
 * The student's page names this call itself, the way every other gate here is
 * named at the place it applies.
 *
 * `studentNote` is untouched: those are the student's own words back, and they
 * wrote them.
 */
export function withoutMentorNotes<T extends { note: string | null }>(
  sessions: readonly T[]
): T[] {
  return sessions.map((session) => ({ ...session, note: null }));
}
