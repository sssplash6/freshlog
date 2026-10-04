import { prisma } from "@/lib/prisma";
import { ROLES, SESSION_STATUS } from "@/lib/constants";

/**
 * Test fixtures. The factories build the smallest row that satisfies the
 * schema's required columns and its foreign keys, so a test states only what it
 * is actually about — `session({ minutes: 60, attended: false })` rather than
 * eleven columns of scaffolding.
 */

/** Delete order matters: children before the rows they point at. */
export async function resetDb() {
  await prisma.interviewAnswer.deleteMany();
  await prisma.interviewFeedback.deleteMany();
  await prisma.peerInterview.deleteMany();
  await prisma.interviewSlot.deleteMany();
  await prisma.session.deleteMany();
  await prisma.studentTask.deleteMany();
  await prisma.hourAllotmentChange.deleteMany();
  await prisma.hourAllocation.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.mentorFeedback.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.mentorAssignment.deleteMany();
  await prisma.programStaff.deleteMany();
  await prisma.studentEnrollment.deleteMany();
  await prisma.studentProfile.deleteMany();
  await prisma.avatarImage.deleteMany();
  await prisma.bugReportImage.deleteMany();
  await prisma.bugReport.deleteMany();
  await prisma.user.deleteMany();
  await prisma.cohort.deleteMany();
  await prisma.programLevel.deleteMany();
  await prisma.program.deleteMany();
}

/** Unique-per-call email, so two factories in one test never collide. */
let seq = 0;
const nextEmail = (prefix: string) => `${prefix}-${++seq}@test.invalid`;

export const DAY = 24 * 60 * 60 * 1000;
/**
 * Offsets from today, not from a pinned day. The engine reads the real clock
 * (`Date.now()`), so a deadline "30 days out" must be 30 real days out — a
 * fixed NOW went stale on 4 October 2026, every fixture grant expired at
 * once, and 22 tests failed for the day they ran on.
 */
export const NOW = new Date();
export const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);

export async function program(name = "Test Program") {
  return prisma.program.create({ data: { name } });
}

export async function mentor(name = "Test Mentor") {
  return prisma.user.create({
    data: { email: nextEmail("mentor"), name, role: ROLES.MENTOR },
  });
}

export async function admin(name = "Test Admin") {
  return prisma.user.create({
    data: { email: nextEmail("admin"), name, role: ROLES.ADMIN },
  });
}

/** Runs the platform: every program, without a grant. */
export async function platformAdmin(name = "Test Platform Admin") {
  return prisma.user.create({
    data: {
      email: nextEmail("platform"),
      name,
      role: ROLES.ADMIN,
      platformAdmin: true,
    },
  });
}

/** One person may administer one program. */
export async function grant(opts: {
  userId: string;
  programId: string;
  role?: string;
}) {
  return prisma.programStaff.create({
    data: {
      userId: opts.userId,
      programId: opts.programId,
      role: opts.role ?? "ADMIN",
    },
  });
}

/** A mentor paired with a program, or narrowed to one level or cohort in it. */
export async function pairing(opts: {
  mentorId: string;
  programId: string;
  levelId?: string | null;
  cohortId?: string | null;
}) {
  return prisma.mentorAssignment.create({
    data: {
      mentorId: opts.mentorId,
      programId: opts.programId,
      levelId: opts.levelId ?? null,
      cohortId: opts.cohortId ?? null,
    },
  });
}

/**
 * A level inside a program — "Emerging" under "Research". The standard pair
 * is optional: a level with no pair falls back to the program's grant.
 */
export async function level(opts: {
  programId: string;
  name?: string;
  standardMinutes?: number | null;
  standardDays?: number | null;
}) {
  return prisma.programLevel.create({
    data: {
      programId: opts.programId,
      name: opts.name ?? `Level ${++seq}`,
      standardMinutes: opts.standardMinutes ?? null,
      standardDays: opts.standardDays ?? null,
    },
  });
}

/** A cohort inside a program — flat, or under one of its levels. */
export async function cohort(opts: {
  programId: string;
  levelId?: string | null;
  name?: string;
}) {
  return prisma.cohort.create({
    data: {
      programId: opts.programId,
      levelId: opts.levelId ?? null,
      name: opts.name ?? `Cohort ${++seq}`,
    },
  });
}

/**
 * A student and their profile; the profile id is what the hours engine takes.
 *
 * `programId` is the program they are enrolled in — one, because that is the
 * ordinary case and a test that does not say otherwise should get it. A student
 * in several is `enroll()` called again, which is what the app does too. The
 * returned row carries `enrollments`, since almost everything that takes a
 * profile now asks it which programs it is in.
 */
export async function student(
  opts: {
    programId?: string;
    name?: string;
    levelId?: string | null;
    cohortId?: string | null;
    /** ACTIVE by default; PENDING is a self-signup nobody has approved. */
    status?: string;
  } = {}
) {
  const programId = opts.programId ?? (await program()).id;
  const [user, createdBy] = await Promise.all([
    prisma.user.create({
      data: {
        email: nextEmail("student"),
        name: opts.name ?? "Test Student",
        role: ROLES.STUDENT,
        ...(opts.status ? { status: opts.status } : {}),
      },
    }),
    admin("Creator"),
  ]);
  return prisma.studentProfile.create({
    data: {
      userId: user.id,
      createdById: createdBy.id,
      enrollments: {
        create: {
          programId,
          levelId: opts.levelId ?? null,
          cohortId: opts.cohortId ?? null,
        },
      },
    },
    include: { enrollments: true },
  });
}

/** A second (or third) program for a student already in one. */
export async function enroll(opts: {
  studentId: string;
  programId: string;
  levelId?: string | null;
  cohortId?: string | null;
}) {
  return prisma.studentEnrollment.create({
    data: {
      studentId: opts.studentId,
      programId: opts.programId,
      levelId: opts.levelId ?? null,
      cohortId: opts.cohortId ?? null,
    },
  });
}

/** The program a fixture row belongs to, when the caller did not say. */
async function programOfStudent(studentId: string): Promise<string> {
  const first = await prisma.studentEnrollment.findFirst({
    where: { studentId },
    orderBy: { createdAt: "asc" },
  });
  if (!first) throw new Error("Student is in no program — enroll them first.");
  return first.programId;
}

export async function allocation(opts: {
  studentId: string;
  /** Defaults to the student's only (or first) program. */
  programId?: string;
  mentorId?: string | null;
  minutes: number;
  /** Days from NOW; negative is an expired allocation. Default: 30 days out. */
  deadlineInDays?: number;
  amountPaid?: number | null;
}) {
  return prisma.hourAllocation.create({
    data: {
      studentId: opts.studentId,
      programId: opts.programId ?? (await programOfStudent(opts.studentId)),
      mentorId: opts.mentorId ?? null,
      minutes: opts.minutes,
      deadline: inDays(opts.deadlineInDays ?? 30),
      amountPaid: opts.amountPaid ?? null,
    },
  });
}

export async function session(opts: {
  studentId: string;
  /** Defaults to the student's only (or first) program. */
  programId?: string;
  mentorId: string;
  minutes: number;
  attended?: boolean;
  late?: boolean;
  status?: string;
  withinPlan?: boolean;
  assignmentId?: string | null;
}) {
  return prisma.session.create({
    data: {
      studentId: opts.studentId,
      programId: opts.programId ?? (await programOfStudent(opts.studentId)),
      mentorId: opts.mentorId,
      minutes: opts.minutes,
      date: inDays(-1),
      attended: opts.attended ?? true,
      late: opts.late ?? false,
      status: opts.status ?? SESSION_STATUS.ACTIVE,
      withinPlan: opts.withinPlan ?? true,
      assignmentId: opts.assignmentId ?? null,
    },
  });
}

export async function assignment(opts: {
  studentId: string;
  /** Defaults to the student's only (or first) program. */
  programId?: string;
  mentorId?: string | null;
  purpose?: string;
  minuteLimit?: number | null;
  position?: number;
}) {
  const createdBy = await admin("Assigner");
  return prisma.assignment.create({
    data: {
      studentId: opts.studentId,
      programId: opts.programId ?? (await programOfStudent(opts.studentId)),
      mentorId: opts.mentorId ?? null,
      purpose: opts.purpose ?? "Essay writing",
      minuteLimit: opts.minuteLimit ?? null,
      position: opts.position ?? 0,
      createdById: createdBy.id,
    },
  });
}

/**
 * Work a mentor set the student — the OTHER plan table. No hours, no budget,
 * and a required mentor: a task nobody set is a task nobody can be asked
 * about, which is what `Assignment.mentorId` is nullable for instead.
 */
export async function studentTask(opts: {
  studentId: string;
  mentorId: string;
  /** Defaults to the student's only (or first) program. */
  programId?: string;
  title?: string;
  percent?: number;
  dueInDays?: number;
  completedAt?: Date | null;
}) {
  return prisma.studentTask.create({
    data: {
      studentId: opts.studentId,
      programId: opts.programId ?? (await programOfStudent(opts.studentId)),
      mentorId: opts.mentorId,
      title: opts.title ?? "Rewrite the draft",
      percent: opts.percent ?? 0,
      dueOn: inDays(opts.dueInDays ?? 7),
      completedAt: opts.completedAt ?? null,
    },
  });
}

/** The eight-byte PNG signature plus padding: enough for `sniffImageType`. */
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

export async function bugReport(
  opts: {
    reporterId?: string | null;
    reporterRole?: string;
    title?: string;
    description?: string;
    status?: string;
    resolution?: string | null;
    resolvedAt?: Date | null;
    changelogDate?: string | null;
    pagePath?: string | null;
    createdAt?: Date;
    image?: boolean;
  } = {}
) {
  return prisma.bugReport.create({
    data: {
      reporterId: opts.reporterId ?? null,
      reporterRole: opts.reporterRole ?? ROLES.STUDENT,
      title: opts.title ?? "Hours look wrong",
      description: opts.description ?? "The total says 3h but I logged 4h.",
      pagePath: opts.pagePath ?? null,
      status: opts.status ?? "PENDING",
      resolution: opts.resolution ?? null,
      resolvedAt: opts.resolvedAt ?? null,
      changelogDate: opts.changelogDate ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      ...(opts.image
        ? { image: { create: { bytes: PNG_BYTES, mimeType: "image/png" } } }
        : {}),
    },
  });
}
