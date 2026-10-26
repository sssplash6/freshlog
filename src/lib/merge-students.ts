import type { Prisma } from "@/generated/prisma/client";
import { ROLES } from "@/lib/constants";

/**
 * Folds one student's account into another: the same person, entered twice
 * ("Arslan Hodjaev" in Global Admissions, "Arslan Khodjayev" in SAT
 * Individuals). Every row the dropped account owns moves to the kept one, the
 * dropped profile and user are deleted, and the kept account's name and email
 * stand.
 *
 * Nothing is summed or chosen. A row the move would put twice under one key is
 * either a pure duplicate with nothing of the ledger in it (a preference, a
 * dismissal, a draft), which is dropped and counted, or a decision somebody
 * has to make (two memberships of one program, two grants from one mentor),
 * which refuses the whole merge and names it. Resolve those by hand, then run
 * again.
 *
 * Takes a transaction and writes through it, so a caller that throws after
 * reading the report rolls everything back: that is the dry run.
 */

type Tx = Prisma.TransactionClient;

export type MergeReport = {
  keep: string;
  drop: string;
  /** Rows moved to the kept account, by what they are. */
  moved: Record<string, number>;
  /** Duplicates the move would have made, deleted instead. */
  discarded: Record<string, number>;
  notes: string[];
};

export class MergeRefused extends Error {
  constructor(readonly clashes: string[]) {
    super(`Refused: ${clashes.join("; ")}`);
  }
}

export async function mergeStudents(tx: Tx, keepId: string, dropId: string): Promise<MergeReport> {
  if (keepId === dropId) throw new MergeRefused(["that is the same student twice"]);
  const load = (id: string) =>
    tx.studentProfile.findUniqueOrThrow({
      where: { id },
      include: {
        user: {
          include: {
            avatarImage: { select: { userId: true } },
            googleConnection: { select: { userId: true } },
            _count: {
              select: {
                mentorAssignments: true,
                staffGrants: true,
                grantsMade: true,
                mentorSessions: true,
                mentorClasses: true,
                hourAllocations: true,
                assignments: true,
                tasksSet: true,
                mentorTasksSet: true,
                mentorTasks: true,
                allotmentChanges: true,
                allotmentMentions: true,
                mentorFeedback: true,
                exchangesSent: true,
                exchangesReturned: true,
                bugsTriaged: true,
                meetDrafts: true,
              },
            },
            interviewSlots: { select: { startsAt: true } },
          },
        },
        enrollments: { include: { program: { select: { name: true } } } },
        hourAllocations: { select: { programId: true, mentorId: true } },
        application: { select: { id: true } },
      },
    });
  const [keep, drop] = await Promise.all([load(keepId), load(dropId)]);
  const name = (p: typeof keep) => `${p.user.name ?? "(no name)"} <${p.user.email}>`;

  // Decisions, not duplicates: any of these stops the merge.
  const clashes: string[] = [];
  for (const p of [keep, drop]) {
    const staffRows = Object.entries(p.user._count).filter(([, n]) => n > 0);
    if (p.user.role !== ROLES.STUDENT || staffRows.length > 0) {
      clashes.push(
        `${name(p)} is not only a student (${p.user.role}${staffRows.map(([k, n]) => `, ${n} ${k}`).join("")})`
      );
    }
  }
  const keptPrograms = new Set(keep.enrollments.map((e) => e.programId));
  for (const e of drop.enrollments) {
    if (keptPrograms.has(e.programId)) clashes.push(`both are in ${e.program.name}`);
  }
  const keptGrants = new Set(keep.hourAllocations.map((a) => `${a.programId}:${a.mentorId}`));
  if (drop.hourAllocations.some((a) => keptGrants.has(`${a.programId}:${a.mentorId}`))) {
    clashes.push("both hold time from the same mentor in the same program");
  }
  if (keep.application && drop.application) clashes.push("both have an application");
  // Practice interviews are keyed on the USER, not the profile.
  const keepUser = keep.userId;
  const dropUser = drop.userId;
  const keptSlots = new Set(keep.user.interviewSlots.map((s) => s.startsAt.getTime()));
  if (drop.user.interviewSlots.some((s) => keptSlots.has(s.startsAt.getTime()))) {
    clashes.push("both offered an interview slot at the same time");
  }
  const between = await tx.peerInterview.count({
    where: {
      OR: [
        { hostId: keepUser, guestId: dropUser },
        { hostId: dropUser, guestId: keepUser },
      ],
    },
  });
  if (between > 0) clashes.push("they practised an interview with each other");
  if (clashes.length > 0) throw new MergeRefused(clashes);

  const moved: Record<string, number> = {};
  const discarded: Record<string, number> = {};
  const notes: string[] = [];
  const count = (into: Record<string, number>, what: string, n: number) => {
    if (n > 0) into[what] = (into[what] ?? 0) + n;
  };
  const toKeep = { studentId: keepId };
  const ofDrop = { where: { studentId: dropId } };

  /* The student's rows. */
  count(moved, "program memberships", (await tx.studentEnrollment.updateMany({ ...ofDrop, data: toKeep })).count);
  count(moved, "exchanges", (await tx.programExchange.updateMany({ ...ofDrop, data: toKeep })).count);
  count(moved, "hour grants", (await tx.hourAllocation.updateMany({ ...ofDrop, data: toKeep })).count);
  count(moved, "grant changes", (await tx.hourAllotmentChange.updateMany({ ...ofDrop, data: toKeep })).count);
  count(moved, "sessions", (await tx.session.updateMany({ ...ofDrop, data: toKeep })).count);
  count(moved, "scheduled classes", (await tx.scheduledClass.updateMany({ ...ofDrop, data: toKeep })).count);
  count(moved, "tasks", (await tx.assignment.updateMany({ ...ofDrop, data: toKeep })).count);
  count(moved, "student tasks", (await tx.studentTask.updateMany({ ...ofDrop, data: toKeep })).count);
  count(moved, "mentor feedback", (await tx.mentorFeedback.updateMany({ ...ofDrop, data: toKeep })).count);
  count(moved, "interview slots", (await tx.interviewSlot.updateMany({ where: { userId: dropUser }, data: { userId: keepUser } })).count);
  count(moved, "interviews hosted", (await tx.peerInterview.updateMany({ where: { hostId: dropUser }, data: { hostId: keepUser } })).count);
  count(moved, "interviews booked", (await tx.peerInterview.updateMany({ where: { guestId: dropUser }, data: { guestId: keepUser } })).count);
  // Absence names a side by user id; a student is never the mentor side, but
  // the column is asked anyway so no row is left naming the dropped account.
  await tx.peerInterview.updateMany({ where: { absentId: dropUser }, data: { absentId: keepUser } });
  await tx.peerInterview.updateMany({ where: { mentorId: dropUser }, data: { mentorId: keepUser } });
  count(moved, "interview answers", (await tx.interviewAnswer.updateMany({ where: { userId: dropUser }, data: { userId: keepUser } })).count);
  count(moved, "interview feedback", (await tx.interviewFeedback.updateMany({ where: { fromId: dropUser }, data: { fromId: keepUser } })).count);
  count(moved, "application", (await tx.studentApplication.updateMany({ ...ofDrop, data: toKeep })).count);

  // Keyed on the student as well as something else: a row the kept account
  // already has is a duplicate, and goes.
  const keptUnis = (await tx.studentUniversity.findMany({ where: toKeep, select: { universityId: true } })).map((u) => u.universityId);
  count(discarded, "universities", (await tx.studentUniversity.deleteMany({ where: { studentId: dropId, universityId: { in: keptUnis } } })).count);
  count(moved, "universities", (await tx.studentUniversity.updateMany({ ...ofDrop, data: toKeep })).count);

  const keptTasks = (await tx.mentorTaskStudent.findMany({ where: toKeep, select: { taskId: true } })).map((t) => t.taskId);
  count(discarded, "mentor-task links", (await tx.mentorTaskStudent.deleteMany({ where: { studentId: dropId, taskId: { in: keptTasks } } })).count);
  count(moved, "mentor-task links", (await tx.mentorTaskStudent.updateMany({ ...ofDrop, data: toKeep })).count);

  for (const d of await tx.meetDraft.findMany({ where: { studentId: dropId } })) {
    const twin = await tx.meetDraft.findFirst({ where: { studentId: keepId, mentorId: d.mentorId, eventId: d.eventId } });
    if (twin) {
      await tx.meetDraft.delete({ where: { id: d.id } });
      count(discarded, "Meet drafts", 1);
    } else {
      await tx.meetDraft.update({ where: { id: d.id }, data: toKeep });
      count(moved, "Meet drafts", 1);
    }
  }

  /* The user's rows. */
  count(moved, "notifications", (await tx.notification.updateMany({ where: { userId: dropUser }, data: { userId: keepUser } })).count);
  await tx.notification.updateMany({ where: { actorId: dropUser }, data: { actorId: keepUser } });
  count(moved, "bug reports", (await tx.bugReport.updateMany({ where: { reporterId: dropUser }, data: { reporterId: keepUser } })).count);
  await tx.studentApplication.updateMany({ where: { updatedById: dropUser }, data: { updatedById: keepUser } });
  await tx.university.updateMany({ where: { createdById: dropUser }, data: { createdById: keepUser } });
  await tx.studentEnrollment.updateMany({ where: { createdById: dropUser }, data: { createdById: keepUser } });
  await tx.assignment.updateMany({ where: { createdById: dropUser }, data: { createdById: keepUser } });
  // A self-signup created its own profile; that one is deleted below.
  await tx.studentProfile.updateMany({ where: { createdById: dropUser, id: { not: dropId } }, data: { createdById: keepUser } });

  const keptPrefs = (await tx.notificationPreference.findMany({ where: { userId: keepUser }, select: { category: true } })).map((p) => p.category);
  count(discarded, "notification settings", (await tx.notificationPreference.deleteMany({ where: { userId: dropUser, category: { in: keptPrefs } } })).count);
  await tx.notificationPreference.updateMany({ where: { userId: dropUser }, data: { userId: keepUser } });

  for (const d of await tx.statusDismissal.findMany({ where: { userId: dropUser } })) {
    const key = { userId: keepUser, type: d.type, subjectId: d.subjectId === dropId ? keepId : d.subjectId };
    const twin = await tx.statusDismissal.findUnique({ where: { userId_type_subjectId: key } });
    await tx.statusDismissal.delete({ where: { userId_type_subjectId: { userId: d.userId, type: d.type, subjectId: d.subjectId } } });
    if (!twin) await tx.statusDismissal.create({ data: { ...key, createdAt: d.createdAt } });
  }

  if (drop.user.avatarImage) {
    if (keep.user.avatarImage) {
      count(discarded, "photo", 1);
    } else {
      await tx.avatarImage.update({ where: { userId: dropUser }, data: { userId: keepUser } });
      await tx.user.update({ where: { id: keepUser }, data: { avatarUpdatedAt: drop.user.avatarUpdatedAt } });
      count(moved, "photo", 1);
    }
  }
  if (drop.user.googleConnection) {
    if (keep.user.googleConnection) count(discarded, "Google connection", 1);
    else {
      await tx.googleConnection.update({ where: { userId: dropUser }, data: { userId: keepUser } });
      count(moved, "Google connection", 1);
    }
  }

  /* Other people's rows that name the dropped account in a string. */
  for (const n of await tx.notification.findMany({
    where: { OR: [{ href: { contains: dropId } }, { href: { contains: dropUser } }] },
    select: { id: true, href: true },
  })) {
    await tx.notification.update({
      where: { id: n.id },
      data: { href: n.href!.replaceAll(dropId, keepId).replaceAll(dropUser, keepUser) },
    });
    count(moved, "notification links", 1);
  }
  for (const d of await tx.statusDismissal.findMany({ where: { subjectId: { in: [dropId, dropUser] } } })) {
    const subjectId = d.subjectId === dropId ? keepId : keepUser;
    const twin = await tx.statusDismissal.findUnique({ where: { userId_type_subjectId: { userId: d.userId, type: d.type, subjectId } } });
    await tx.statusDismissal.delete({ where: { userId_type_subjectId: { userId: d.userId, type: d.type, subjectId: d.subjectId } } });
    if (!twin) await tx.statusDismissal.create({ data: { userId: d.userId, type: d.type, subjectId, createdAt: d.createdAt } });
  }

  /* What the kept profile lacks and the dropped one knows. */
  const fill = {
    telegramUsername: keep.telegramUsername ?? drop.telegramUsername,
    telegramReminderAt: keep.telegramReminderAt ?? drop.telegramReminderAt,
    folderUrl: keep.folderUrl ?? drop.folderUrl,
  };
  for (const [k, v] of Object.entries(fill)) {
    if (v != null && keep[k as keyof typeof fill] == null) notes.push(`${k} taken from the dropped account: ${String(v)}`);
  }
  if (keep.user.status !== drop.user.status) {
    notes.push(`statuses differ: kept ${keep.user.status}, dropped ${drop.user.status}; the kept one stands`);
  }
  // Meet recognises a participant by their Google id, so the kept account
  // takes it over when it has none of its own.
  const googleId = keep.user.googleId ?? drop.user.googleId;
  if (drop.user.googleId && keep.user.googleId) {
    notes.push(`Meet will no longer recognise ${drop.user.email}'s Google account as this student`);
  }

  await tx.studentProfile.delete({ where: { id: dropId } });
  await tx.user.delete({ where: { id: dropUser } });
  await tx.studentProfile.update({ where: { id: keepId }, data: fill });
  if (googleId !== keep.user.googleId) await tx.user.update({ where: { id: keepUser }, data: { googleId } });
  notes.push(`${drop.user.email} no longer signs in; signing in with it again makes a new pending student`);

  return { keep: name(keep), drop: name(drop), moved, discarded, notes };
}
