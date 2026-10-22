import "server-only";

import type { ApiSession, SessionState, StudentAnswer } from "@/lib/api/v1/types";
import { adminScope, adminWriteScope, scopeCovers, type AdminScope } from "@/lib/authz";
import {
  attendanceOf,
  canActAsMentor,
  chargesAllocation,
  SESSION_ANSWER,
  SESSION_STATUS,
  timeKindOf,
  USER_STATUS,
} from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { sessionStatuses } from "@/lib/status";
import type { Prisma, Session, User } from "@/generated/prisma/client";

/**
 * Logged sessions as the freshlog app reads them, one at a time or a page at a
 * time.
 *
 * The website has no page for one session (a row's people carry the links,
 * `components/session-row.tsx`), so it never had to say who may read one. The
 * rule here is built from the rules the session actions already enforce, and
 * `sessions.test.ts` holds the two together: what `can` offers, the action
 * then allows.
 */

/** Who is reading, with what they may read and write. Built once per request. */
export type Reader = { user: User; studentProfileId: string | null; read: AdminScope; write: AdminScope };

/** `user` as a reader: their student record, when they have one, and the programs they read and write. */
export async function readerFor(user: User): Promise<Reader> {
  const [profile, read, write] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } }),
    adminScope(user),
    adminWriteScope(user),
  ]);
  return { user, studentProfileId: profile?.id ?? null, read, write };
}

/**
 * The include every session read uses. Each relation selects only what the
 * contract names, so nothing else of a person is ever loaded to be mapped away.
 */
export const SESSION_INCLUDE = {
  student: { select: { id: true, userId: true, user: { select: { name: true, email: true } } } },
  mentor: { select: { id: true, name: true, email: true } },
  program: { select: { id: true, name: true, colorIndex: true } },
  assignment: { select: { id: true, purpose: true } },
} satisfies Prisma.SessionInclude;

export type SessionRow = Prisma.SessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

const isStudentOf = (reader: Reader, row: Pick<Session, "studentId">) =>
  reader.studentProfileId !== null && row.studentId === reader.studentProfileId;

/**
 * May `reader` see this session: its student, the mentor who logged it, or
 * anyone whose read scope covers its program. Nobody else.
 *
 * That leaves out another mentor of the same student, whom the website's
 * student page shows it to. The app has no page of that kind, and narrower is
 * safer.
 *
 * The session's own program decides the admin half, never the student's
 * enrollments (AGENTS.md, "Ask the row, not the student"): an admin of one of a
 * student's two programs reads that program's sessions and not the other's.
 */
export function canRead(reader: Reader, row: Pick<Session, "studentId" | "mentorId" | "programId">): boolean {
  return isStudentOf(reader, row) || row.mentorId === reader.user.id || scopeCovers(reader.read, row.programId);
}

/** A person as a row names them: their name, or their email when they have none. */
const nameOf = (person: { name: string | null; email: string }) => person.name ?? person.email;

/**
 * One session in the contract's shape, as `reader` may be told it.
 *
 * It takes a row the reader may already see, from `canRead` or from a list that
 * asked only for their own, and decides what each field says to them.
 */
export function toApiSession(reader: Reader, row: SessionRow, now: Date): ApiSession {
  const isStudent = isStudentOf(reader, row);
  const loggedIt = row.mentorId === reader.user.id;
  const voided = row.status === SESSION_STATUS.VOIDED;
  // Who may correct it, void it and restore it: the mentor who logged it, while
  // they are an active mentor, and anyone who may write its program. The same
  // two `requireSessionAuthority` and `restoreSession` let through, asked of a
  // row already in hand.
  const corrects =
    (loggedIt && canActAsMentor(reader.user) && reader.user.status === USER_STATUS.ACTIVE) ||
    scopeCovers(reader.write, row.programId);

  return {
    id: row.id,
    day: toDateInputValue(row.date),
    minutes: row.minutes,
    attendance: attendanceOf(row),
    kind: timeKindOf(row),
    // A string column that constants.ts keeps to these values, like `studentAnswer` below.
    state: row.status as SessionState,
    charged: chargesAllocation(row),
    answer: row.studentAnswer as StudentAnswer | null,
    // The student's own words go back to them. Anyone else reads them only on a
    // dispute, which is addressed to the mentor. The rating is never sent.
    answerNote: isStudent || row.studentAnswer === SESSION_ANSWER.DISPUTED ? row.studentNote : null,
    // The website's own question, its window included: is the student being asked?
    needsAnswer: sessionStatuses(row, { audience: "student", userId: row.student.userId, now }).some(
      (status) => status.type === "SESSION_UNCONFIRMED"
    ),
    student: { id: row.student.id, userId: row.student.userId, name: nameOf(row.student.user) },
    mentor: { id: row.mentor.id, name: nameOf(row.mentor) },
    program: { id: row.program.id, name: row.program.name, colorIndex: row.program.colorIndex },
    task: row.assignment ? { id: row.assignment.id, purpose: row.assignment.purpose } : null,
    // `withoutMentorNotes`' rule: the write-up is for the mentor who wrote it and
    // the people who run the program, and never for the student it is about,
    // even one who also administers it.
    note: !isStudent && (loggedIt || scopeCovers(reader.read, row.programId)) ? row.note : null,
    can: {
      edit: corrects && !voided,
      void: corrects && !voided,
      // `restoreSession` also refuses a session whose student has since left
      // its program. That is the action's to say when it is tried, in its words.
      restore: corrects && voided,
      // `answerSession`: the student, about a session that still stands.
      answer: isStudent && row.status === SESSION_STATUS.ACTIVE,
    },
  };
}

/** The session as `reader` may see it; null when it doesn't exist or isn't theirs to see. */
export async function sessionFor(reader: Reader, id: string, now: Date = new Date()): Promise<ApiSession | null> {
  const row = await prisma.session.findUnique({ where: { id }, include: SESSION_INCLUDE });
  // Loaded first and gated second, with one answer for both: a session that
  // isn't theirs must read exactly like one that doesn't exist.
  if (!row || !canRead(reader, row)) return null;
  return toApiSession(reader, row, now);
}
