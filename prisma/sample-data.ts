// Sample data for LOCAL development only — fills the empty ledger so the app
// has something to show on a phone: students, mentors, allocations, sessions,
// tasks, notifications, feedback. Idempotent by email/name keys; never deletes.
//
// Run with: npx tsx prisma/sample-data.ts

import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const day = (offset: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

async function main() {
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: "tech@freshman.academy" },
  });
  const programs = await prisma.program.findMany();
  const byName = Object.fromEntries(programs.map((p) => [p.name, p]));
  const global = byName["Global Admissions Program"];
  const flexible = byName["Flexible Program"];
  const masters = byName["Master's Program"];
  if (!global || !flexible || !masters) {
    throw new Error("Run `npx prisma db seed` first — programs are missing.");
  }

  /* ---- Mentors ----------------------------------------------------- */
  const mentorSpecs = [
    { name: "Dilnoza Yusupova", email: "dilnoza@freshman.academy", calendly: "https://calendly.com/dilnoza/30min" },
    { name: "Akmal Karimov", email: "akmal@freshman.academy", calendly: "https://calendly.com/akmal/mentoring" },
    { name: "Sarvar Alimov", email: "sarvar@freshman.academy", calendly: null },
    { name: "Nilufar Rashidova", email: "nilufar@freshman.academy", calendly: null },
  ];
  const mentors: Record<string, { id: string }> = {};
  for (const m of mentorSpecs) {
    const u = await prisma.user.upsert({
      where: { email: m.email },
      update: { name: m.name },
      create: {
        email: m.email,
        name: m.name,
        role: "MENTOR",
        status: "ACTIVE",
      },
    });
    mentors[m.name] = u;
  }
  // The admin mentors too — that's what the isMentor flag exists for.
  await prisma.user.update({
    where: { id: admin.id },
    data: { isMentor: true },
  });

  /* ---- Mentor↔program pairings -------------------------------------- */
  const pair = async (mentorName: string, programId: string, calendly: string | null) => {
    const mentorId = mentors[mentorName].id;
    const existing = await prisma.mentorAssignment.findFirst({
      where: { mentorId, programId },
    });
    if (existing) return;
    await prisma.mentorAssignment.create({
      data: { mentorId, programId, calendlyUrl: calendly },
    });
  };
  await pair("Dilnoza Yusupova", global.id, mentorSpecs[0].calendly);
  await pair("Dilnoza Yusupova", masters.id, mentorSpecs[0].calendly);
  await pair("Akmal Karimov", global.id, mentorSpecs[1].calendly);
  await pair("Akmal Karimov", flexible.id, mentorSpecs[1].calendly);
  await pair("Sarvar Alimov", flexible.id, null); // no booking link — an attention row
  await pair("Nilufar Rashidova", masters.id, mentorSpecs[3].calendly);

  /* ---- Students ----------------------------------------------------- */
  // (name, program, mentor, allocatedMin, deadlineOffsetDays, paid?)
  const studentSpecs: {
    name: string;
    email: string;
    telegram: string | null;
    program: typeof global;
    mentor: string;
    minutes: number;
    deadline: number;
    paid?: number;
  }[] = [
    { name: "Malika Rahimova", email: "malika@student.example.com", telegram: "malika_r", program: global, mentor: "Dilnoza Yusupova", minutes: 720, deadline: 24 },
    { name: "Jasur Tursunov", email: "jasur@student.example.com", telegram: "jasur_t", program: global, mentor: "Dilnoza Yusupova", minutes: 480, deadline: 5 },
    { name: "Sitora Karimova", email: "sitora@student.example.com", telegram: "sitora_k", program: global, mentor: "Akmal Karimov", minutes: 600, deadline: -2 },
    { name: "Timur Nazarov", email: "timur@student.example.com", telegram: "timur_n", program: flexible, mentor: "Akmal Karimov", minutes: 360, deadline: 40 },
    { name: "Gulnora Saidova", email: "gulnora@student.example.com", telegram: "gulnora_s", program: flexible, mentor: "Sarvar Alimov", minutes: 300, deadline: 12 },
    { name: "Bobur Azimov", email: "bobur@student.example.com", telegram: "bobur_a", program: masters, mentor: "Nilufar Rashidova", minutes: 900, deadline: 55, paid: 2400 },
    { name: "Madina Usmonova", email: "madina@student.example.com", telegram: "madina_u", program: masters, mentor: "Dilnoza Yusupova", minutes: 540, deadline: 30, paid: 1600 },
    { name: "Aziz Kholmatov", email: "aziz@student.example.com", telegram: null, program: global, mentor: "Akmal Karimov", minutes: 240, deadline: 18 },
  ];

  const students: Record<string, { id: string; programId: string }> = {};
  for (const s of studentSpecs) {
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: { name: s.name },
      create: {
        email: s.email,
        name: s.name,
        role: "STUDENT",
        status: "ACTIVE",
      },
    });
    const profile = await prisma.studentProfile.upsert({
      where: { userId: user.id },
      update: { telegramUsername: s.telegram },
      create: {
        userId: user.id,
        telegramUsername: s.telegram,
        createdById: admin.id,
      },
    });
    const enrollment = await prisma.studentEnrollment.findFirst({
      where: { studentId: profile.id, programId: s.program.id },
    });
    if (!enrollment) {
      await prisma.studentEnrollment.create({
        data: { studentId: profile.id, programId: s.program.id, createdById: admin.id },
      });
    }
    students[s.name] = { id: profile.id, programId: s.program.id };

    // The allocation, audited once.
    const alloc = await prisma.hourAllocation.findFirst({
      where: {
        studentId: profile.id,
        programId: s.program.id,
        mentorId: mentors[s.mentor].id,
      },
    });
    if (!alloc) {
      await prisma.hourAllocation.create({
        data: {
          studentId: profile.id,
          programId: s.program.id,
          mentorId: mentors[s.mentor].id,
          minutes: s.minutes,
          amountPaid: s.paid ?? null,
          deadline: day(s.deadline),
        },
      });
      await prisma.hourAllotmentChange.create({
        data: {
          studentId: profile.id,
          programId: s.program.id,
          mentorId: mentors[s.mentor].id,
          changedById: admin.id,
          oldMinutes: 0,
          newMinutes: s.minutes,
        },
      });
    }

    /* ---- Agenda items (assignments) -------------------------------- */
    const presets = [
      "Personal Statement Review",
      "University Selection",
      "Supplemental Essays",
    ];
    for (let i = 0; i < 2; i++) {
      const purpose = presets[(studentSpecs.indexOf(s) + i) % presets.length];
      const exists = await prisma.assignment.findFirst({
        where: { studentId: profile.id, programId: s.program.id, purpose },
      });
      if (!exists) {
        await prisma.assignment.create({
          data: {
            studentId: profile.id,
            programId: s.program.id,
            mentorId: mentors[s.mentor].id,
            purpose,
            minuteLimit: i === 0 ? 240 : 120,
            dueOn: day(10 + i * 14),
            progress: i === 0 ? "IN_PROGRESS" : "NOT_STARTED",
            position: i,
            createdById: admin.id,
          },
        });
      }
    }

    /* ---- A student task -------------------------------------------- */
    const taskExists = await prisma.studentTask.findFirst({
      where: { studentId: profile.id, programId: s.program.id },
    });
    if (!taskExists) {
      await prisma.studentTask.create({
        data: {
          studentId: profile.id,
          programId: s.program.id,
          mentorId: mentors[s.mentor].id,
          title: "Draft the activities section",
          note: "Ten entries, verbs first — we review on Friday.",
          dueOn: day(6),
          percent: studentSpecs.indexOf(s) % 3 === 0 ? 50 : 0,
        },
      });
    }
  }

  /* ---- Sessions ----------------------------------------------------- */
  // Spread over the last eight weeks; the shapes a ledger should show.
  const names = Object.keys(students);
  const notePool = [
    "Reviewed the personal statement draft — thesis is there, structure needs work.",
    "University shortlist: cut from 14 to 9, added two safeties.",
    "Mock interview. Strong on academics, vague on 'why this school'.",
    "Supplemental essay brainstorm — picked the robotics story.",
    "Went through the recommendation-letter brag sheet together.",
    "EC descriptions pass two — quantified the volunteer hours.",
    null,
    "Rescheduled twice this week; finally sat down for the essay plan.",
  ];
  const attendancePool: { attended: boolean; late: boolean; status: string; withinPlan?: boolean }[] = [
    { attended: true, late: false, status: "ACTIVE" },
    { attended: true, late: false, status: "ACTIVE" },
    { attended: true, late: false, status: "ACTIVE" },
    { attended: true, late: true, status: "ACTIVE" },
    { attended: true, late: false, status: "ACTIVE" },
    { attended: false, late: false, status: "ACTIVE" }, // no-show, still charged
    { attended: true, late: false, status: "ACTIVE" },
    { attended: true, late: false, status: "ACTIVE", withinPlan: false }, // out of plan
    { attended: true, late: false, status: "VOIDED" },
    { attended: true, late: false, status: "RESCHEDULED" },
  ];

  let made = 0;
  for (let i = 0; i < 34; i++) {
    const sName = names[i % names.length];
    const spec = studentSpecs.find((x) => x.name === sName)!;
    const student = students[sName];
    const mentorId = mentors[spec.mentor].id;
    const att = attendancePool[i % attendancePool.length];
    const date = day(-(i * 2 + 1));
    const minutes = [30, 45, 60, 60, 90, 90, 120][i % 7];

    // Skip exact dupes (same student+mentor+date+minutes) on re-runs.
    const dupe = await prisma.session.findFirst({
      where: { studentId: student.id, mentorId, date, minutes },
    });
    if (dupe) continue;

    const assignment = await prisma.assignment.findFirst({
      where: { studentId: student.id, programId: student.programId },
    });
    const answered = i % 4 === 0;
    const disputed = i === 12;
    await prisma.session.create({
      data: {
        studentId: student.id,
        programId: student.programId,
        mentorId,
        assignmentId: i % 3 === 0 ? assignment?.id : undefined,
        minutes,
        date,
        attended: att.attended,
        late: att.late,
        status: att.status,
        withinPlan: att.withinPlan ?? true,
        note: notePool[i % notePool.length],
        studentAnswer: disputed ? "DISPUTED" : answered ? "CONFIRMED" : undefined,
        studentAnsweredAt: answered || disputed ? day(-(i * 2)) : undefined,
        studentRating: answered ? [5, 4, 5, 3][i % 4] : undefined,
        studentNote: disputed
          ? "We only met for half an hour, not ninety minutes."
          : i === 8
            ? "Really useful — finally know which schools I'm applying to."
            : undefined,
      },
    });
    made++;
  }
  console.log(`sessions created: ${made}`);

  /* ---- Mentor feedback ---------------------------------------------- */
  for (const [sName, rating, comment] of [
    ["Malika Rahimova", 5, "Dilnoza pushes me every session — exactly what I needed."],
    ["Bobur Azimov", 4, "Nilufar knows the GMAT inside out."],
    ["Timur Nazarov", 5, null],
  ] as const) {
    const s = students[sName];
    const spec = studentSpecs.find((x) => x.name === sName)!;
    const exists = await prisma.mentorFeedback.findFirst({
      where: { studentId: s.id, mentorId: mentors[spec.mentor].id },
    });
    if (!exists) {
      await prisma.mentorFeedback.create({
        data: {
          studentId: s.id,
          mentorId: mentors[spec.mentor].id,
          rating,
          comment,
        },
      });
    }
  }

  /* ---- Notifications for the admin ---------------------------------- */
  const notifs: { type: string; category: string; message: string; href?: string; read: boolean; ago: number }[] = [
    { type: "SESSION_ANSWERED", category: "SESSIONS", message: "Aziz Kholmatov disputed a 90 min session — says it ran 30.", href: "/sessions", read: false, ago: -1 },
    { type: "FEEDBACK_RECEIVED", category: "ACCOUNTS", message: "Malika Rahimova rated Dilnoza Yusupova 5/5.", href: "/mentors", read: false, ago: -1 },
    { type: "TASK_MOVED", category: "TASKS", message: "Timur Nazarov moved “Draft the activities section” to 50%.", href: "/students", read: false, ago: -2 },
    { type: "HOURS_DEADLINE", category: "DEADLINES", message: "Sitora Karimova's allocation deadline passed with time left.", href: "/students", read: false, ago: -3 },
    { type: "STUDENT_SIGNUP", category: "ACCOUNTS", message: "Madina Usmonova finished signing in.", read: true, ago: -5 },
    { type: "GOAL_DONE", category: "TASKS", message: "“Personal Statement Review” for Jasur Tursunov reached its budget.", href: "/students", read: true, ago: -7 },
    { type: "WEEKLY_SUMMARY", category: "ACCOUNTS", message: "Your week: 14 sessions logged, 3 deadlines approaching.", read: true, ago: -8 },
  ];
  for (const n of notifs) {
    const exists = await prisma.notification.findFirst({
      where: { userId: admin.id, message: n.message },
    });
    if (!exists) {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          type: n.type,
          category: n.category,
          message: n.message,
          href: n.href,
          read: n.read,
          createdAt: day(n.ago),
        },
      });
    }
  }

  const counts = {
    users: await prisma.user.count(),
    students: await prisma.studentProfile.count(),
    sessions: await prisma.session.count(),
    allocations: await prisma.hourAllocation.count(),
    notifications: await prisma.notification.count(),
  };
  console.log("sample data in place:", counts);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Done.");
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
