// More sample data for the STUDENT side, LOCAL development only.
//
// `sample-data.ts` gives eight students a ledger; the other thirty-odd have one
// session and nothing else, which is what a student sees the moment they sign in
// as one of them — a page of empty states. This fills twelve of them in the way
// a real student's weeks look: sessions over ten weeks (most confirmed and
// rated, the newest still waiting for an answer), an agenda, tasks at every
// stage, notifications, a second mentor for a few, mentor ratings, and peer
// interviews (open times, one booked, two done with answers and feedback).
//
// Idempotent: a student who already has more than three sessions is skipped,
// interviews are keyed on the offered time. Never deletes anything.
//
// Run with: npx tsx prisma/student-sample-data.ts

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
/** A wall-clock time in a UTC field, the way interview slots are stored. */
const at = (offset: number, hh: number, mm = 0) => {
  const d = day(offset);
  d.setUTCHours(hh, mm, 0, 0);
  return d;
};

const TARGETS = [
  "Abdulahad Nabiev",
  "Abdullohikromov Ikromov",
  "Akobir Oblokulov",
  "Aslbek Boyxo'rozov",
  "Aziza Kurbanoba",
  "Azizbek Beshimov",
  "Feruza Ismoilova",
  "Husniddin Mirzaakhmedov",
  "Laylo Normatova",
  "Bektosh Ruzikulov",
  "Gulnoza Sharipova",
  "Madina Xolmatova",
];

// What a mentor writes after a meeting, in the order an application season goes.
const NOTES = [
  "First meeting. Mapped the whole season: deadlines, essays, what to do first. Agreed to start with the personal statement.",
  "Read the first draft of the personal statement. The opening story is strong; the middle explains instead of showing. Rewrite paragraph two with one concrete scene.",
  "University shortlist: went from 14 down to 9 — three reaches, four targets, two safeties. Checked each one's deadline and essay count.",
  "Second draft of the personal statement. Much tighter. Cut the conclusion's summary and end on the robotics lab image instead.",
  "Activities list pass one. Moved verbs to the front and put numbers on everything — 40 volunteers, 6 months, 3 events.",
  "Supplemental essay brainstorm: picked the story about the school library. Outlined 'Why this university' for the first two schools.",
  "Mock interview, 25 minutes. Good on academics; vague on why this university. Practised a 60-second answer until it stopped sounding rehearsed.",
  "Went through the recommendation-letter brag sheet together and decided which two teachers to ask first.",
  "Final read of the personal statement and two supplements. Only small edits left — read it aloud once more before submitting.",
  "Short check-in on the application portal: fixed a wrong date in the education section, uploaded the transcript.",
];
const STUDENT_NOTES = [
  "Really useful — I finally know which schools I'm applying to.",
  "Clear feedback. I rewrote the middle of my essay the same evening.",
  "Good session, a bit rushed at the end.",
  "She explained why the second paragraph wasn't working and it clicked.",
];
const ANSWERS = [
  "Tell me about yourself.",
  "Why do you want to study this subject?",
  "Why this university in particular?",
];

async function main() {
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: "tech@freshman.academy" },
  });
  const mentors = Object.fromEntries(
    (await prisma.user.findMany({ where: { isMentor: true } })).map((m) => [m.name ?? m.email, m]),
  );
  const akmal = mentors["Akmal Karimov"];
  const global = await prisma.program.findFirstOrThrow({ where: { name: "Global Admissions Program" } });

  const profiles: Record<string, { id: string; userId: string }> = {};

  for (const [index, name] of TARGETS.entries()) {
    const user = await prisma.user.findFirst({ where: { name, role: "STUDENT" } });
    if (!user) continue;
    const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: user.id } });
    profiles[name] = { id: profile.id, userId: user.id };

    const have = await prisma.session.count({ where: { studentId: profile.id } });
    if (have > 3) {
      console.log(`${name}: already has ${have} sessions, skipping`);
      continue;
    }

    // ---- The grant: big enough that ten weeks of meetings fit inside it.
    const alloc = await prisma.hourAllocation.findFirstOrThrow({
      where: { studentId: profile.id, programId: global.id },
    });
    const mentorId = alloc.mentorId!;
    if (alloc.minutes < 600) {
      await prisma.hourAllocation.update({
        where: { id: alloc.id },
        data: { minutes: 600, deadline: day(35 + index * 4) },
      });
      await prisma.hourAllotmentChange.create({
        data: {
          studentId: profile.id,
          programId: global.id,
          mentorId,
          changedById: admin.id,
          oldMinutes: alloc.minutes,
          newMinutes: 600,
        },
      });
    }

    // ---- Agenda: what the time is for.
    const agendaSpecs = [
      { purpose: "Personal Statement Review", limit: 240, due: index % 3 === 0 ? -4 : 12, progress: index % 3 === 0 ? "DONE" : "IN_PROGRESS" },
      { purpose: "University Selection", limit: 180, due: 20, progress: index % 2 === 0 ? "IN_PROGRESS" : "NOT_STARTED" },
      { purpose: index % 2 === 0 ? "Interview Preparation" : "Supplemental Essays", limit: 120, due: 45, progress: "NOT_STARTED" },
    ];
    const agenda = [];
    for (const [position, a] of agendaSpecs.entries()) {
      agenda.push(
        await prisma.assignment.create({
          data: {
            studentId: profile.id,
            programId: global.id,
            mentorId,
            purpose: a.purpose,
            minuteLimit: a.limit,
            dueOn: day(a.due),
            progress: a.progress,
            position,
            createdById: admin.id,
          },
        }),
      );
    }

    // ---- Sessions: roughly weekly, oldest first, newest unanswered.
    const plan = [
      { ago: 68, minutes: 60, goal: 0 },
      { ago: 55, minutes: 45, goal: 0 },
      { ago: 41, minutes: 60, goal: 1 },
      { ago: 29, minutes: 45, goal: 0 },
      { ago: 17, minutes: 30, goal: 1 },
      { ago: 8, minutes: 60, goal: 2 },
      { ago: 2, minutes: 45, goal: 2 },
    ].slice(index % 3 === 2 ? 2 : 0); // a couple of students are newer to it
    const used = (await prisma.session.aggregate({ where: { studentId: profile.id }, _sum: { minutes: true } }))._sum.minutes ?? 0;
    let budget = Math.max(alloc.minutes, 600) - used - 60; // always leave an hour or more
    let n = 0;
    for (const [i, p] of plan.entries()) {
      if (p.minutes > budget) break;
      budget -= p.minutes;
      const newest = i === plan.length - 1;
      const noShow = index % 5 === 4 && i === 2;
      const answered = !newest && !noShow;
      await prisma.session.create({
        data: {
          studentId: profile.id,
          programId: global.id,
          mentorId,
          assignmentId: agenda[p.goal]?.id,
          minutes: p.minutes,
          date: day(-p.ago),
          attended: !noShow,
          late: index % 4 === 1 && i === 3,
          status: "ACTIVE",
          withinPlan: true,
          note: noShow ? "Did not join; message sent, rescheduling for next week." : NOTES[(index + i) % NOTES.length],
          studentAnswer: answered ? "CONFIRMED" : undefined,
          studentAnsweredAt: answered ? day(-p.ago + 1) : undefined,
          studentRating: answered ? [5, 4, 5, 4, 5][(index + i) % 5] : undefined,
          studentNote: answered && (index + i) % 4 === 0 ? STUDENT_NOTES[(index + i) % STUDENT_NOTES.length] : undefined,
        },
      });
      n++;
    }

    // ---- A second mentor for some: Akmal holds a smaller grant.
    if (index % 3 === 0 && akmal && mentorId !== akmal.id) {
      const has = await prisma.hourAllocation.findFirst({
        where: { studentId: profile.id, programId: global.id, mentorId: akmal.id },
      });
      if (!has) {
        await prisma.hourAllocation.create({
          data: { studentId: profile.id, programId: global.id, mentorId: akmal.id, minutes: 240, deadline: day(48) },
        });
        await prisma.hourAllotmentChange.create({
          data: { studentId: profile.id, programId: global.id, mentorId: akmal.id, changedById: admin.id, oldMinutes: 0, newMinutes: 240 },
        });
        for (const [k, ago] of [26, 10].entries()) {
          await prisma.session.create({
            data: {
              studentId: profile.id,
              programId: global.id,
              mentorId: akmal.id,
              minutes: k === 0 ? 45 : 30,
              date: day(-ago),
              attended: true,
              note: k === 0 ? "Mock interview with the admissions-officer template. Needs a shorter 'tell me about yourself'." : "Follow-up mock: much better structure, still too many 'um's on the why-this-school answer.",
              studentAnswer: k === 0 ? "CONFIRMED" : undefined,
              studentAnsweredAt: k === 0 ? day(-ago + 1) : undefined,
              studentRating: k === 0 ? 5 : undefined,
            },
          });
        }
      }
    }

    // ---- Tasks the mentor set the student, at every stage.
    const tasks = [
      { title: "Draft the personal statement outline", note: "One page, five beats. Send it before our next meeting.", due: -12, percent: 100, done: true },
      { title: "Shortlist eight universities", note: "Two reaches, four targets, two safeties — with deadlines.", due: 5, percent: 60 },
      { title: "Ask two teachers for recommendation letters", note: "Use the brag sheet we made. Give them three weeks.", due: 16, percent: 0 },
    ];
    if (index % 4 === 1) tasks[1] = { ...tasks[1], title: "Rewrite paragraph two of the personal statement", note: "One concrete scene instead of the explanation.", due: -3, percent: 30 };
    for (const t of tasks) {
      await prisma.studentTask.create({
        data: {
          studentId: profile.id,
          programId: global.id,
          mentorId,
          title: t.title,
          note: t.note,
          dueOn: day(t.due),
          percent: t.percent,
          completedAt: t.done ? day(t.due - 1) : undefined,
        },
      });
    }

    // ---- What the bell and Notifications show them.
    const mentorName = (await prisma.user.findUniqueOrThrow({ where: { id: mentorId } })).name ?? "Your mentor";
    const notices = [
      { type: "HOURS_GRANTED", category: "HOURS", message: `${mentorName} now holds 10 hours for you. Use them by ${day(35 + index * 4).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}.`, href: "/student", read: true, ago: -70 },
      { type: "GOAL_ASSIGNED", category: "TASKS", message: `${mentorName} set you a task: “${tasks[1].title}”.`, href: "/student", read: true, ago: -20 },
      { type: "SESSION_LOGGED", category: "SESSIONS", message: `${mentorName} logged a ${plan[plan.length - 1]?.minutes ?? 45} min session with you.`, href: "/student/meetings", read: false, ago: -2 },
      { type: "HOURS_DEADLINE", category: "DEADLINES", message: "Your time with " + mentorName + " expires in about five weeks.", href: "/student", read: index % 2 === 0, ago: -4 },
      { type: "TASK_MOVED", category: "TASKS", message: `${mentorName} marked “${tasks[0].title}” done.`, href: "/student", read: true, ago: -11 },
    ];
    for (const nf of notices) {
      await prisma.notification.create({
        data: { userId: user.id, type: nf.type, category: nf.category, message: nf.message, href: nf.href, read: nf.read, createdAt: day(nf.ago) },
      });
    }

    // ---- Some students have rated their mentor.
    if (index % 3 !== 2) {
      const exists = await prisma.mentorFeedback.findFirst({ where: { studentId: profile.id, mentorId } });
      if (!exists) {
        await prisma.mentorFeedback.create({
          data: {
            studentId: profile.id,
            mentorId,
            rating: index % 4 === 3 ? 4 : 5,
            comment: ["Explains clearly and never rushes me.", "Pushes me to rewrite until it is actually good.", null, "Very organised — I always know what is next."][index % 4],
          },
        });
      }
    }
    console.log(`${name}: ${n} sessions, 3 agenda items, 3 tasks`);
  }

  // ---- Peer interviews ----------------------------------------------------
  const P = (name: string) => profiles[name];
  const offer = async (name: string, startsAt: Date, minutes: number) => {
    const s = P(name);
    if (!s) return null;
    const existing = await prisma.interviewSlot.findFirst({ where: { userId: s.userId, startsAt } });
    return (
      existing ??
      prisma.interviewSlot.create({
        data: { userId: s.userId, startsAt, minutes, meetingUrl: "https://meet.google.com/abc-defg-hij" },
      })
    );
  };

  // Open times anybody can book.
  for (const [name, off, hh, len] of [
    ["Aslbek Boyxo'rozov", 3, 15, 45],
    ["Akobir Oblokulov", 4, 11, 60],
    ["Feruza Ismoilova", 6, 17, 30],
    ["Laylo Normatova", 8, 14, 45],
    ["Madina Xolmatova", 10, 16, 60],
    ["Bektosh Ruzikulov", 12, 10, 45],
  ] as const) {
    await offer(name, at(off, hh), len);
  }

  const book = async (host: string, guest: string, startsAt: Date, minutes: number, template: string, completed: boolean) => {
    const slot = await offer(host, startsAt, minutes);
    if (!slot || !P(guest)) return;
    const exists = await prisma.peerInterview.findUnique({ where: { slotId: slot.id } });
    if (exists) return;
    const iv = await prisma.peerInterview.create({
      data: {
        slotId: slot.id,
        hostId: P(host).userId,
        guestId: P(guest).userId,
        template,
        completedAt: completed ? new Date(startsAt.getTime() + minutes * 60_000) : undefined,
        hostNotes: completed ? "Strong opening. Should slow down on the why-this-university answer." : undefined,
        guestNotes: completed ? "Asked good follow-ups. I rushed the last question." : undefined,
      },
    });
    if (completed) {
      for (const [who, q] of [[guest, 0], [guest, 1], [guest, 2]] as const) {
        await prisma.interviewAnswer.create({
          data: {
            interviewId: iv.id,
            userId: P(who).userId,
            questionIndex: q,
            question: ANSWERS[q],
            text: [
              "I'm from Samarkand and I have spent the last two years building small robots with my school's club. I want to study engineering because I like making things that move.",
              "Because every project I enjoyed started as a problem I could not solve at first. Engineering is a way of getting better at that feeling.",
              "Your first-year design studio lets students build something real in the first term, which is exactly what I want to do.",
            ][q],
          },
        });
      }
      await prisma.interviewFeedback.create({
        data: {
          interviewId: iv.id,
          fromId: P(host).userId,
          summary: "A clear, confident interview with a few places to tighten.",
          wentWell: "Specific examples (the robotics club) and a calm voice.",
          toImprove: "Answer 'why this university' with one detail only that school has.",
          submittedAt: new Date(startsAt.getTime() + minutes * 60_000 + 3_600_000),
        },
      });
      await prisma.interviewFeedback.create({
        data: {
          interviewId: iv.id,
          fromId: P(guest).userId,
          summary: "Helpful questions and kind feedback.",
          wentWell: "Good follow-up questions that made me expand my answers.",
          toImprove: "Leave a little more silence after a question.",
          submittedAt: new Date(startsAt.getTime() + minutes * 60_000 + 7_200_000),
        },
      });
    }
  };

  // Done: Abdulahad practised with Akobir; Aziza with Husniddin.
  await book("Akobir Oblokulov", "Abdulahad Nabiev", at(-9, 13), 45, "university-admissions", true);
  await book("Husniddin Mirzaakhmedov", "Aziza Kurbanoba", at(-5, 16), 30, "behavioral", true);
  // Coming up: Abdulahad's own offered time has been booked; he has booked one too.
  await book("Abdulahad Nabiev", "Gulnoza Sharipova", at(5, 18), 45, "university-admissions", false);
  await book("Azizbek Beshimov", "Abdulahad Nabiev", at(2, 12), 30, "scholarship", false);
  // And two open times he offered himself.
  await offer("Abdulahad Nabiev", at(9, 15), 60);
  await offer("Abdulahad Nabiev", at(14, 11), 45);

  console.log({
    sessions: await prisma.session.count(),
    agenda: await prisma.assignment.count(),
    tasks: await prisma.studentTask.count(),
    notifications: await prisma.notification.count(),
    slots: await prisma.interviewSlot.count(),
    interviews: await prisma.peerInterview.count(),
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
