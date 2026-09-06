// Imports the Master's Program history out of the team's "Master's Hours"
// workbook — one tab per student — into the platform.
//
//   python3 scripts/parse-masters-sheet.py ~/Downloads/"Master's Hours.xlsx"
//   npm run import:masters                     # dry run: reports, writes nothing
//   IMPORT_CONFIRM=WRITE npm run import:masters # writes
//
// WHAT IT BRINGS IN
//   students  — one per tab, with the full name from the "Student List" tab.
//               Emails are placeholders (<name>@import.invalid): the sheet has
//               none, and a student can't exist without one. They are ACTIVE so
//               mentors can log against them, and their weekly email is OFF
//               until a real address replaces the placeholder.
//   tasks     — the plan half of each tab (Purpose / Consultant / Hour Limit /
//               Deadline / Progress). A Progress cell that says more than its
//               state keeps the rest as the task's note.
//   sessions  — the log half (Consultant / Duration / Date / Notes), each one
//               attached to the task it most likely went toward.
//
// WHAT IT DELIBERATELY DOES NOT BRING IN
//   hour allocations. Hours are granted in the app, per mentor, with the use-by
//   date and (for Master's) the amount paid — so the sheet's package total stays
//   out of this and the report ends with what to allocate instead. Until hours
//   are allocated an imported student reads as overdrawn by their own history,
//   which is arithmetic, not a bug: allotted is still zero.
//
// Re-running is safe: a task or session already in the database is left alone.

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { MASTERS_PROGRAM_NAME } from "../config/app-config";

const SHEET = "sheet-import/masters-hours.json";
const MENTOR_MAP = "sheet-import/mentor-map.json";
const WRITE = process.env.IMPORT_CONFIRM === "WRITE";
/** Placeholder domain: reserved by RFC 2606, so it can never reach anyone. */
const PLACEHOLDER_DOMAIN = "import.invalid";
/** What a plan row with hours but no written purpose is called until renamed. */
const UNTITLED = "Untitled task — name this";

type SheetSession = {
  row: number;
  consultant: string;
  hours: number;
  date: string | null;
  rawDate: string | null;
  note: string | null;
};
type SheetTask = {
  row: number;
  purpose: string | null;
  consultant: string;
  hourLimit: number | null;
  deadline: string | null;
  deadlineDate: string | null;
  progress: string | null;
};
type SheetStudent = {
  tab: string;
  sessions: SheetSession[];
  tasks: SheetTask[];
  totals: { hours?: number; completed?: number; remain?: number };
  warnings: string[];
};
type Sheet = {
  source: string;
  parsedOn: string;
  students: SheetStudent[];
  roster: { fullName: string; email: string | null; telegram: string | null }[];
};
type MentorEntry = { email: string; name: string; create?: boolean };

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const log = (line = "") => console.log(line);
/** Same rounding the app's own hour fields use, so sums stay clean. */
/**
 * The sheet's decimal hours as the whole minutes the ledger stores. Same
 * conversion the durations_in_minutes migration used on the existing rows, so a
 * re-import lines up with what is already there rather than landing a minute
 * out.
 */
const toMinutes = (n: number) => Math.round(n * 60);
const notes: string[] = [];
const note = (line: string) => notes.push(line);

/** "Nafisa Nurmatova" → "nafisa.nurmatova", the local part of the placeholder. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

/** The state a Progress cell states, and whatever else it says. */
function readProgress(raw: string | null): {
  progress: "NOT_STARTED" | "IN_PROGRESS" | "DONE";
  pinned: boolean;
  note: string | null;
} {
  const text = (raw ?? "").trim();
  if (!text) return { progress: "NOT_STARTED", pinned: false, note: null };
  const lower = text.toLowerCase();

  if (lower.startsWith("done")) {
    // A person said this is finished, so pin it: the work was often finished
    // under budget and logged hours must not reopen it.
    const rest = text.slice(4).replace(/^[\s;:.,-]+/, "").trim();
    return { progress: "DONE", pinned: true, note: rest || null };
  }
  if (lower.startsWith("in progress")) {
    const rest = text.slice(11).replace(/^[\s;:.,-]+/, "").trim();
    // Left unpinned: hours logged later should be free to finish it.
    return { progress: "IN_PROGRESS", pinned: false, note: rest || null };
  }
  // Anything else ("Missed 1 hour of meeting. Not excused") is not a state at
  // all — keep every word of it and let the hours decide the state.
  return { progress: "NOT_STARTED", pinned: false, note: text };
}

/** A purpose cell that swallowed a paragraph: keep the first line as the name. */
function splitPurpose(raw: string): { purpose: string; note: string | null } {
  const cleaned = raw.replace(/\r/g, "").trim();
  const [first, ...rest] = cleaned.split("\n");
  const head = first.trim().replace(/[\s:;-]+$/, "");
  const tail = rest.join(" ").trim();
  if (!tail && head.length <= 200) return { purpose: head, note: null };
  return { purpose: head.slice(0, 200), note: tail || null };
}

/**
 * Was the student a no-show? Only a note that says exactly that — "Missed the
 * deadline" is about the work, not the meeting, and charging it as a no-show
 * would put an hour in the missed column that nobody missed.
 */
function isNoShow(note: string | null): boolean {
  const text = (note ?? "").trim().toLowerCase().replace(/[.;,!]+$/, "");
  if (!text) return false;
  return (
    text === "missed" ||
    text === "missed session" ||
    text === "missed meeting" ||
    /^(no[- ]?show|did ?n['o]?t (show|attend)|student did not show)/.test(text)
  );
}

/** Which of this mentor's tasks a logged session most likely went toward. */
function matchTask(
  session: SheetSession,
  tasks: { id: string; purpose: string; mentorId: string | null }[],
  mentorId: string
): { id: string; purpose: string } | null {
  const mine = tasks.filter((t) => t.mentorId === mentorId);
  if (mine.length === 0) return null;

  const note = (session.note ?? "").toLowerCase();
  if (note) {
    const hit = mine.find((t) => {
      const purpose = t.purpose.toLowerCase();
      return note.includes(purpose) || purpose.includes(note);
    });
    if (hit) return hit;
    // Softer: share a distinctive word ("recommendation", "essays", "research").
    const words = new Set(note.split(/[^a-z]+/).filter((w) => w.length > 4));
    const partial = mine.find((t) =>
      t.purpose
        .toLowerCase()
        .split(/[^a-z]+/)
        .some((w) => w.length > 4 && words.has(w))
    );
    if (partial) return partial;
  }
  // One task with this mentor and nothing to disambiguate: it's that one.
  return mine.length === 1 ? mine[0] : null;
}

async function resolveMentors(names: string[]) {
  const candidates = await prisma.user.findMany({
    where: { OR: [{ role: "MENTOR" }, { isMentor: true }] },
    orderBy: { name: "asc" },
  });

  if (!existsSync(MENTOR_MAP)) {
    // First run: guess, then stop. Who "Sharof" is on the platform is not a
    // guess worth making silently — a wrong mentor owns someone else's hours.
    const draft: Record<string, MentorEntry> = {};
    for (const name of names) {
      const lower = name.toLowerCase();
      const hit =
        candidates.find((c) => (c.name ?? "").toLowerCase() === lower) ??
        candidates.find((c) => (c.name ?? "").toLowerCase().split(" ")[0] === lower) ??
        candidates.find((c) => (c.name ?? "").toLowerCase().startsWith(lower));
      draft[name] = hit
        ? { email: hit.email, name: hit.name ?? name }
        : { email: `${slug(name)}@freshman.academy`, name, create: true };
    }
    writeFileSync(MENTOR_MAP, `${JSON.stringify(draft, null, 2)}\n`);
    log(`Wrote a draft ${MENTOR_MAP} — check every line before importing:\n`);
    for (const [sheetName, entry] of Object.entries(draft)) {
      log(
        `  ${sheetName.padEnd(12)} → ${entry.email}${entry.create ? "   (would be created)" : "   (existing account)"}`
      );
    }
    log(`\nEdit that file, then re-run. Nothing was written to the database.`);
    return null;
  }

  const map: Record<string, MentorEntry> = JSON.parse(readFileSync(MENTOR_MAP, "utf8"));
  const missing = names.filter((n) => !map[n]?.email);
  if (missing.length > 0) {
    log(`${MENTOR_MAP} has no entry for: ${missing.join(", ")}`);
    log("Add them and re-run. Nothing was written.");
    return null;
  }

  const resolved = new Map<string, { id: string; label: string; created: boolean }>();
  for (const name of names) {
    const entry = map[name];
    const email = entry.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role !== "MENTOR" && !(existing.role === "ADMIN" && existing.isMentor)) {
        log(`${email} exists but can't act as a mentor (role ${existing.role}).`);
        log("Fix the account or the map, then re-run. Nothing was written.");
        return null;
      }
      resolved.set(name, {
        id: existing.id,
        label: existing.name ?? existing.email,
        created: false,
      });
      continue;
    }
    if (!entry.create) {
      log(`${email} has no account and the map doesn't say to create one.`);
      log(`Set "create": true for ${name}, or point it at an existing mentor.`);
      return null;
    }
    if (!WRITE) {
      resolved.set(name, { id: `(new) ${email}`, label: entry.name, created: true });
      continue;
    }
    const created = await prisma.user.create({
      data: { email, name: entry.name, role: "MENTOR", status: "ACTIVE" },
    });
    resolved.set(name, { id: created.id, label: entry.name, created: true });
  }
  return resolved;
}

async function main() {
  if (!existsSync(SHEET)) {
    log(`No ${SHEET}. Parse the workbook first:`);
    log(`  python3 scripts/parse-masters-sheet.py ~/Downloads/"Master's Hours.xlsx"`);
    process.exit(1);
  }
  const sheet: Sheet = JSON.parse(readFileSync(SHEET, "utf8"));

  const program = await prisma.program.findUnique({
    where: { name: MASTERS_PROGRAM_NAME },
  });
  if (!program) {
    log(`No program called "${MASTERS_PROGRAM_NAME}" — run \`npm run db:seed\` first.`);
    process.exit(1);
  }
  const actor =
    (await prisma.user.findFirst({ where: { role: "ADMIN", email: "tech@freshman.academy" } })) ??
    (await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } }));
  if (!actor) {
    log("No admin account to attribute the import to — run `npm run db:seed` first.");
    process.exit(1);
  }

  log(`${WRITE ? "IMPORTING" : "DRY RUN"} — ${sheet.source}, parsed ${sheet.parsedOn}`);
  log(`Program: ${program.name}    attributed to: ${actor.email}`);
  log("");

  const names = [
    ...new Set(
      sheet.students.flatMap((s) => [
        ...s.sessions.map((x) => x.consultant),
        ...s.tasks.map((x) => x.consultant),
      ])
    ),
  ].sort();
  const mentors = await resolveMentors(names);
  if (!mentors) return;

  log("Consultants:");
  for (const name of names) {
    const m = mentors.get(name)!;
    log(`  ${name.padEnd(12)} → ${m.label}${m.created ? " (new mentor account)" : ""}`);
  }
  log("");

  // Mentors need to be in the program to see it and to hold hours there.
  if (WRITE) {
    for (const m of mentors.values()) {
      const pairing = await prisma.mentorAssignment.findFirst({
        where: { mentorId: m.id, programId: program.id },
      });
      if (!pairing) {
        await prisma.mentorAssignment.create({
          data: { mentorId: m.id, programId: program.id, cohortId: null },
        });
        note(`assigned ${m.label} to ${program.name}`);
      }
    }
  }

  let addedStudents = 0;
  let addedTasks = 0;
  let addedSessions = 0;
  let skippedTasks = 0;
  let skippedSessions = 0;
  let unimported = 0;

  for (const student of sheet.students) {
    const first = student.tab.trim();
    const roster = sheet.roster.find(
      (r) => r.fullName.toLowerCase().split(" ")[0] === first.toLowerCase()
    );
    const fullName = roster?.fullName ?? first;
    const email = roster?.email?.trim().toLowerCase() || `${slug(fullName)}@${PLACEHOLDER_DOMAIN}`;

    log(`${fullName}  (tab "${student.tab}")`);
    log(`  ${email}${email.endsWith(PLACEHOLDER_DOMAIN) ? "   ← placeholder, replace with their real address" : ""}`);

    // Find them by the address first. Failing that, by their name inside this
    // program — which is what makes a SECOND run after the sheet's Emails column
    // is filled in upgrade the placeholder rather than create a twin.
    let profile = await prisma.studentProfile.findFirst({
      where: { user: { email } },
      include: { user: true, enrollments: { select: { programId: true } } },
    });
    let matchedByName = false;
    if (!profile) {
      const byName = await prisma.studentProfile.findFirst({
        where: {
          enrollments: { some: { programId: program.id } },
          user: { name: fullName },
        },
        include: { user: true, enrollments: { select: { programId: true } } },
      });
      if (byName) {
        profile = byName;
        matchedByName = true;
      }
    }

    if (!profile) {
      // The address might already belong to somebody who isn't a student here —
      // a mentor, a staff account, a test row. Creating would throw on the unique
      // email and take the whole import down, so this student is reported and
      // stepped over instead.
      const taken = await prisma.user.findUnique({ where: { email } });
      if (taken) {
        log(`  ! ${email} already belongs to an existing ${taken.role} account — student SKIPPED`);
        note(`${fullName}: ${email} already belongs to an existing ${taken.role} account, so nothing was imported for them. Give them a different address in the sheet, or sort the account out first.`);
        log("");
        continue;
      }
      if (WRITE) {
        const user = await prisma.user.create({
          data: {
            email,
            name: fullName,
            role: "STUDENT",
            status: "ACTIVE",
            // Nothing can reach a placeholder address, so the Monday email stays
            // off until a real one replaces it.
            weeklyDigest: !email.endsWith(PLACEHOLDER_DOMAIN),
          },
        });
        profile = await prisma.studentProfile.create({
          data: {
            userId: user.id,
            createdById: actor.id,
            enrollments: {
              create: { programId: program.id, createdById: actor.id },
            },
          },
          include: { user: true, enrollments: { select: { programId: true } } },
        });
      }
      addedStudents += 1;
      log(`  + new student`);
    } else {
      const stored = profile.user.email;
      log(`  · already on the platform${matchedByName ? " (matched by name)" : ""}`);

      // A placeholder giving way to a real address: the one edit worth making to
      // a student who is already here, because until it happens they can't sign in.
      if (
        stored !== email &&
        stored.endsWith(PLACEHOLDER_DOMAIN) &&
        !email.endsWith(PLACEHOLDER_DOMAIN)
      ) {
        const clash = await prisma.user.findUnique({ where: { email } });
        if (clash) {
          log(`  ! ${email} is taken by an existing ${clash.role} account — their placeholder stays`);
          note(`${fullName}: could not take ${email} (an existing ${clash.role} account has it), so they keep ${stored}.`);
        } else {
          if (WRITE) {
            await prisma.user.update({
              where: { id: profile.userId },
              // A reachable address means the weekly hours email can find them,
              // so it goes back to the app's default.
              data: { email, weeklyDigest: true },
            });
          }
          log(`  ↻ email ${stored} → ${email}`);
          note(`${fullName}: placeholder replaced with ${email}; their weekly hours email is on.`);
        }
      } else if (stored !== email && !stored.endsWith(PLACEHOLDER_DOMAIN)) {
        note(`${fullName}: the sheet says ${email}, the platform says ${stored} — left alone. Change it under Corrections if the sheet is right.`);
      }

      // A student may now be in several programs, so being in another one is
      // no longer a warning — being in this one is the question. If they are
      // not, they are enrolled here as well as wherever they already were,
      // which is what importing this program's sheet says about them.
      if (!profile.enrollments.some((e) => e.programId === program.id)) {
        const elsewhere = profile.enrollments.length > 0;
        if (WRITE) {
          await prisma.studentEnrollment.create({
            data: {
              studentId: profile.id,
              programId: program.id,
              createdById: actor.id,
            },
          });
          profile.enrollments.push({ programId: program.id });
        }
        log(`  + enrolled in ${program.name}`);
        if (elsewhere) {
          note(`${fullName} was already in another program; ${program.name} was added alongside it rather than replacing it.`);
        }
      }
    }

    // ---- tasks (the plan half) ----
    const existingTasks = profile
      ? await prisma.assignment.findMany({ where: { studentId: profile.id } })
      : [];
    let position =
      existingTasks.reduce((max, t) => Math.max(max, t.position), -1) + 1;
    const importedTasks: { id: string; purpose: string; mentorId: string | null }[] =
      existingTasks.map((t) => ({ id: t.id, purpose: t.purpose, mentorId: t.mentorId }));

    for (const task of student.tasks) {
      const mentor = mentors.get(task.consultant)!;
      // A plan row with hours but no name still has to arrive — the hours are
      // real. It lands with a name that asks to be replaced.
      const { purpose, note: purposeNote } = task.purpose
        ? splitPurpose(task.purpose)
        : { purpose: UNTITLED, note: null };
      const state = readProgress(task.progress);
      const combined = [purposeNote, state.note].filter(Boolean).join(" — ") || null;

      // The same sheet row twice is the same task; a changed row is a new one.
      const already = existingTasks.find(
        (t) =>
          t.mentorId === mentor.id &&
          t.purpose === purpose &&
          (t.dueNote ?? "") === (task.deadline ?? "") &&
          (t.minuteLimit ?? null) ===
            (task.hourLimit == null ? null : toMinutes(task.hourLimit))
      );
      if (already) {
        skippedTasks += 1;
        continue;
      }

      log(
        `  + task  ${purpose.slice(0, 44).padEnd(44)} ${mentor.label.padEnd(20)}` +
          `${task.hourLimit != null ? `${toMinutes(task.hourLimit)}m` : "—"}`.padEnd(6) +
          `${(task.deadline ?? "—").padEnd(12)} ${state.progress}${state.pinned ? " (pinned)" : ""}`
      );
      if (combined) log(`          note: ${combined.slice(0, 110)}`);
      if (purpose === UNTITLED) {
        note(`${fullName}: ${toMinutes(task.hourLimit ?? 0)} min with ${mentor.label} had no purpose written in the sheet — imported as "${UNTITLED}"`);
      }

      if (WRITE && profile) {
        const created = await prisma.assignment.create({
          data: {
            studentId: profile.id,
            programId: program.id,
            mentorId: mentor.id,
            purpose,
            minuteLimit: task.hourLimit == null ? null : toMinutes(task.hourLimit),
            // The sheet's due column is prose as often as it is a date, so it
            // lands in the note half. Nothing imported gets a dueOn.
            dueNote: task.deadline,
            note: combined,
            progress: state.progress,
            progressManual: state.pinned,
            position: position++,
            createdById: actor.id,
          },
        });
        importedTasks.push({
          id: created.id,
          purpose: created.purpose,
          mentorId: created.mentorId,
        });
      } else {
        importedTasks.push({
          id: `(new) ${purpose}`,
          purpose,
          mentorId: mentor.id,
        });
      }
      addedTasks += 1;
    }

    // ---- sessions (the log half) ----
    const existingSessions = profile
      ? await prisma.session.findMany({ where: { studentId: profile.id } })
      : [];

    for (const session of student.sessions) {
      const mentor = mentors.get(session.consultant)!;
      if (!session.date) {
        note(
          `${fullName}: ${toMinutes(session.hours)} min with ${mentor.label} has no date in the sheet (row ${session.row}) — NOT imported. ` +
            `Fill the date in and re-run, or log it in the app.`
        );
        unimported += 1;
        continue;
      }
      const date = new Date(`${session.date}T00:00:00.000Z`);
      const already = existingSessions.find(
        (s) =>
          s.mentorId === mentor.id &&
          s.minutes === toMinutes(session.hours) &&
          s.date.getTime() === date.getTime() &&
          (s.note ?? "") === (session.note ?? "")
      );
      if (already) {
        skippedSessions += 1;
        continue;
      }

      const attended = !isNoShow(session.note);
      const task = matchTask(session, importedTasks, mentor.id);
      log(
        `  + ${session.date}  ${String(toMinutes(session.hours)).padStart(5)}m  ${mentor.label.padEnd(20)}` +
          `${attended ? "" : "NO-SHOW  "}→ ${task ? task.purpose.slice(0, 34) : "(no task — link it in the app)"}`
      );
      if (!task) {
        note(`${fullName}: ${session.date} ${toMinutes(session.hours)} min with ${mentor.label} has no task — a mentor can attach one with "Correct"`);
      }
      if (!attended) {
        note(`${fullName}: ${session.date} ${toMinutes(session.hours)} min with ${mentor.label} imported as a no-show ("${session.note}")`);
      }

      if (WRITE && profile) {
        await prisma.session.create({
          data: {
            studentId: profile.id,
            programId: program.id,
            mentorId: mentor.id,
            assignmentId: task && !task.id.startsWith("(new)") ? task.id : null,
            minutes: toMinutes(session.hours),
            date,
            attended,
            note: session.note,
          },
        });
      }
      addedSessions += 1;
    }

    // ---- what the sheet says vs what the platform will show ----
    const budget = student.tasks.reduce((sum, t) => sum + (t.hourLimit ?? 0), 0);
    const logged = student.sessions.reduce((sum, s) => sum + s.hours, 0);
    const sheetCompleted = student.totals.completed;
    const agrees =
      sheetCompleted == null || Math.abs(sheetCompleted - budget) < 0.01
        ? "matches the sheet"
        : `⚠ sheet says ${sheetCompleted}`;
    log(
      `  tasks budget ${budget.toFixed(2)}h (${agrees}) · sessions logged ${logged.toFixed(2)}h` +
        `${student.totals.hours ? ` · package ${student.totals.hours}h` : ""}`
    );

    // The use-by dates to enter when allocating: each mentor's last deadline.
    const byMentor = new Map<string, { hours: number; latest: string | null }>();
    for (const t of student.tasks) {
      const key = mentors.get(t.consultant)!.label;
      const row = byMentor.get(key) ?? { hours: 0, latest: null };
      row.hours += t.hourLimit ?? 0;
      if (t.deadlineDate && (!row.latest || t.deadlineDate > row.latest)) {
        row.latest = t.deadlineDate;
      }
      byMentor.set(key, row);
    }
    for (const s of student.sessions) {
      const key = mentors.get(s.consultant)!.label;
      const row = byMentor.get(key) ?? { hours: 0, latest: null };
      byMentor.set(key, row);
    }
    log(`  to allocate in the app:`);
    for (const [mentorLabel, row] of byMentor) {
      const loggedWith = student.sessions
        .filter((s) => mentors.get(s.consultant)!.label === mentorLabel)
        .reduce((sum, s) => sum + s.hours, 0);
      log(
        `    ${mentorLabel.padEnd(20)} ${toMinutes(row.hours)} min budgeted, ${toMinutes(loggedWith)} min already logged` +
          `   use by ${row.latest ?? "—"}`
      );
    }
    for (const w of student.warnings) note(`${fullName}: ${w}`);
    log("");
  }

  log("─".repeat(72));
  log(
    `${WRITE ? "Imported" : "Would import"}: ${addedStudents} students, ${addedTasks} tasks, ${addedSessions} sessions` +
      (skippedTasks || skippedSessions
        ? `   (already there: ${skippedTasks} tasks, ${skippedSessions} sessions)`
        : "")
  );
  if (unimported > 0) {
    log(`${unimported} session${unimported === 1 ? "" : "s"} could NOT be imported — see below.`);
  }
  const placeholders = sheet.students
    .map((student) => {
      const first = student.tab.trim();
      const roster = sheet.roster.find(
        (r) => r.fullName.toLowerCase().split(" ")[0] === first.toLowerCase()
      );
      return roster?.email?.trim() ? null : (roster?.fullName ?? first);
    })
    .filter(Boolean);
  if (placeholders.length > 0) {
    log(
      `\n${placeholders.length} student${placeholders.length === 1 ? "" : "s"} still on a placeholder address (no email in the sheet's Student List): ${placeholders.join(", ")}.`
    );
    log("They cannot sign in until it's replaced — fill the sheet in and re-run, or fix it under Corrections.");
  }
  if (notes.length > 0) {
    log(`\n${notes.length} things to know:`);
    for (const n of notes) log(`  · ${n}`);
  }
  log(
    WRITE
      ? "\nNext: allocate each student's minutes per mentor in the app (Master's → Students → open one → Allocate time), using the numbers above."
      : "\nNothing was written. Re-run with IMPORT_CONFIRM=WRITE to import."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
