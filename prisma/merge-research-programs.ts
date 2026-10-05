// Merges the three research programs into one "Research Program" with levels.
//
//   npm run db:merge-research                          # dry run: reports, writes nothing
//   RESEARCH_CONFIRM=WRITE npm run db:merge-research   # writes
//
// WHAT IT DOES
//   - finds or creates "Research Program"
//   - creates the Emerging / Advanced / Frontiers levels on it, each carrying
//     the canonical grant (2h, 15h, 20h — the owner's numbers) with the days
//     the old program's own standard carried
//   - moves each old program's cohorts under its level
//   - rewrites programId on every program-owned row: enrollments (with the
//     level the old program stood for), allocations, sessions, assignments,
//     tasks, allotment changes, mentor pairings, staff grants
//   - retargets exchanges that named an old research program; a placement
//     whose two ends both become Research closes — a program cannot visit
//     itself
//   - ARCHIVES the three old programs rather than deleting them: their pages
//     stay readable and nothing is unrecoverable
//
// COLLISIONS — the cases a merge cannot avoid, each resolved by a stated rule:
//   - a student with two research memberships keeps ONE: a live visit (an
//     OPEN exchange into one of the three) wins if it is their only research
//     row; otherwise the membership at the HIGHER level survives
//     (Frontiers > Advanced > Emerging) and the rest are dropped
//   - the same mentor holding the same student's time in two of them sums the
//     minutes and keeps the later deadline — the rule a top-up already follows
//   - a second mentor pairing or staff grant for the same person keeps the
//     higher/wider one
//   - a cohort whose name is already taken under its level folds its people
//     into the cohort already there
//
// Re-running is safe: rows already moved are found in their new home and
// skipped, so a second run converges to no writes.
//
// Run the dry run FIRST and read it. Every collision the merge resolves is a
// decision somebody may want to overturn by hand — the report is where they
// learn it happened.

import "dotenv/config";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { RESEARCH_INSTITUTE_NAME } from "../config/app-config";
import { EXCHANGE_STATUS, PROGRAM_STATUS } from "../src/lib/constants";
import { nextColorIndex } from "../src/lib/program-tone";

const WRITE = process.env.RESEARCH_CONFIRM === "WRITE";

/** The merged program. Found by name, created when absent. */
const TARGET_NAME = "Research Program";

/**
 * The programs being folded in, each naming the level it becomes and the
 * grant that level carries. `rank` is the collision rule: a student in two of
 * them keeps the HIGHER level.
 */
const SOURCES = [
  { program: "Emerging Researchers Program", level: "Emerging", standardMinutes: 120, rank: 1 },
  { program: "Advanced Research Program", level: "Advanced", standardMinutes: 900, rank: 2 },
  { program: "Frontiers Researchers Program", level: "Frontiers", standardMinutes: 1200, rank: 3 },
];

/** Higher wins when one person lands with two grants on Research. */
const ROLE_RANK: Record<string, number> = { ADMIN: 3, LEADER: 2, SALES: 1 };

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

type SourceRow = {
  id: string;
  name: string;
  level: { name: string; rank: number; minutes: number; days: number | null };
};

async function main() {
  const programs = await prisma.program.findMany({
    where: { name: { in: SOURCES.map((s) => s.program) } },
    select: { id: true, name: true, standardDays: true, status: true },
  });
  const byName = new Map(programs.map((p) => [p.name, p]));

  console.log(
    `\n${WRITE ? "APPLYING" : "DRY RUN"} — research merge into "${TARGET_NAME}"\n`
  );

  const sources: SourceRow[] = [];
  for (const s of SOURCES) {
    const p = byName.get(s.program);
    if (!p) {
      console.log(`  ? ${s.program} — not in this database, skipped`);
      continue;
    }
    if (p.status === PROGRAM_STATUS.ARCHIVED) {
      console.log(`  · ${s.program} — already archived (a previous run?), its rows still merge`);
    }
    sources.push({
      id: p.id,
      name: p.name,
      level: { name: s.level, rank: s.rank, minutes: s.standardMinutes, days: p.standardDays },
    });
  }
  if (sources.length === 0) {
    console.log("\nNothing to merge.");
    return;
  }
  const sourceIds = sources.map((s) => s.id);

  const target = await prisma.program.findFirst({ where: { name: TARGET_NAME } });
  console.log(
    target
      ? `\nTarget: "${TARGET_NAME}" exists — merging into it\n`
      : `\nTarget: "${TARGET_NAME}" will be created\n`
  );
  console.log(
    target?.spaceName
      ? `Institute: already named "${target.spaceName}" — left as it is\n`
      : `Institute: shown as "${RESEARCH_INSTITUTE_NAME}" to the people who work only in it\n`
  );

  // ------------------------------------------------------------- the plan

  const cohorts = await prisma.cohort.findMany({
    where: { programId: { in: sourceIds } },
    select: { id: true, name: true, programId: true },
  });
  const targetCohorts = target
    ? await prisma.cohort.findMany({
        where: { programId: target.id },
        select: { id: true, name: true, levelId: true, level: { select: { name: true } } },
      })
    : [];
  const cohortPlan = cohorts.map((c) => {
    const levelName = sources.find((s) => s.id === c.programId)!.level.name;
    const clash = targetCohorts.find(
      (t) => t.name === c.name && t.level?.name === levelName
    );
    return { id: c.id, name: c.name, levelName, mergeIntoId: clash?.id ?? null };
  });

  const exchanges = await prisma.programExchange.findMany({
    where: {
      OR: [
        { fromProgramId: { in: sourceIds } },
        { toProgramId: { in: sourceIds } },
      ],
    },
    select: { id: true, status: true, fromProgramId: true, toProgramId: true },
  });
  // An exchange goes internal when BOTH its ends read as Research afterwards —
  // either it named an old program, or the merged target itself.
  const endsOnTarget = (programId: string) =>
    sourceIds.includes(programId) || programId === target?.id;
  const isInternal = (x: (typeof exchanges)[number]) =>
    endsOnTarget(x.fromProgramId) && endsOnTarget(x.toProgramId);
  const exchangeById = new Map(exchanges.map((x) => [x.id, x]));

  const enrollments = await prisma.studentEnrollment.findMany({
    where: { programId: { in: sourceIds } },
    include: { student: { include: { user: { select: { email: true, name: true } } } } },
  });
  const targetEnrollments = target
    ? await prisma.studentEnrollment.findMany({ where: { programId: target.id } })
    : [];

  type EnrollMove = {
    id: string;
    label: string;
    to: string;
    kind: "move" | "convert" | "visit" | "drop";
    why?: string;
  };
  const enrollmentPlan: EnrollMove[] = [];
  const exchangeCloses = new Set<string>();

  const byStudent = new Map<string, typeof enrollments>();
  for (const e of enrollments) {
    const list = byStudent.get(e.studentId) ?? [];
    list.push(e);
    byStudent.set(e.studentId, list);
  }
  for (const [studentId, rows] of byStudent) {
    const label = rows[0].student.user.name ?? rows[0].student.user.email;
    const targetRow = targetEnrollments.find((r) => r.studentId === studentId);

    // The candidates, in words: a live external visit stays a visit; a visit
    // that collapses onto Research converts into the membership it was hosted
    // as; a plain enrollment moves to its source's level.
    const visitors = rows.filter((e) => {
      const x = e.exchangeId ? exchangeById.get(e.exchangeId) : null;
      return e.exchangeId && x && !isInternal(x) && x.status !== EXCHANGE_STATUS.RETURNED;
    });
    const converts = rows.filter((e) => {
      const x = e.exchangeId ? exchangeById.get(e.exchangeId) : null;
      return e.exchangeId && (!x || isInternal(x) || x.status === EXCHANGE_STATUS.RETURNED);
    });
    const owns = rows.filter((e) => !e.exchangeId);

    // Highest-ranked own-membership candidate, real or converted.
    const ownCandidates = [
      ...owns.map((e) => ({ e, levelName: sources.find((s) => s.id === e.programId)!.level.name, rank: sources.find((s) => s.id === e.programId)!.level.rank, convert: false, xid: null as string | null })),
      ...converts.map((e) => {
        const x = e.exchangeId ? exchangeById.get(e.exchangeId) : null;
        const host = x ? sources.find((s) => s.id === x.toProgramId) : null;
        const levelName = host?.level.name ?? sources.find((s) => s.id === e.programId)!.level.name;
        const rank = host?.level.rank ?? sources.find((s) => s.id === e.programId)!.level.rank;
        return { e, levelName, rank, convert: true, xid: e.exchangeId };
      }),
    ].sort((a, b) => b.rank - a.rank);
    const ownWinner = ownCandidates[0] ?? null;

    // A student who lands as a MEMBER of Research cannot also be visiting it:
    // any live external visit ends, and only the membership survives. The
    // visit wins only when it is all they have.
    const visitor = visitors[0] ?? null;
    const keepVisitor = visitor && !ownWinner && !targetRow;
    const keepOwn = ownWinner && !targetRow;

    for (const v of visitors) {
      if (keepVisitor && v === visitor) {
        enrollmentPlan.push({ id: v.id, label, to: "Research (visit)", kind: "visit" });
      } else {
        const x = v.exchangeId ? exchangeById.get(v.exchangeId) : null;
        if (x) exchangeCloses.add(x.id);
        enrollmentPlan.push({
          id: v.id, label, to: "", kind: "drop",
          why: "a live visit cannot sit beside their own Research membership — the exchange closes",
        });
      }
    }
    for (const c of ownCandidates) {
      if (keepOwn && c === ownWinner) {
        if (c.xid) exchangeCloses.add(c.xid);
        enrollmentPlan.push({
          id: c.e.id, label, to: c.levelName,
          kind: c.convert ? "convert" : "move",
        });
      } else {
        if (c.xid) exchangeCloses.add(c.xid);
        enrollmentPlan.push({
          id: c.e.id, label, to: "", kind: "drop",
          why: targetRow
            ? `already in ${TARGET_NAME}`
            : `also in ${ownWinner?.levelName} — the higher level wins`,
        });
      }
    }
  }

  // Allocations: retarget, then merge (student, mentor) pairs that land twice —
  // minutes sum, the later deadline stands, exactly the top-up rule.
  const allocations = await prisma.hourAllocation.findMany({
    where: { programId: { in: sourceIds } },
    select: { id: true, studentId: true, mentorId: true, minutes: true, deadline: true },
  });
  const targetAllocations = target
    ? await prisma.hourAllocation.findMany({
        where: { programId: target.id },
        select: { id: true, studentId: true, mentorId: true, minutes: true, deadline: true },
      })
    : [];
  type AllocMove = { loserId: string; winnerId: string };
  const allocationMerges: AllocMove[] = [];
  {
    const groups = new Map<string, { id: string; minutes: number; deadline: Date }[]>();
    for (const a of [...allocations, ...targetAllocations]) {
      const k = `${a.studentId}:${a.mentorId ?? "pool"}`;
      const list = groups.get(k) ?? [];
      list.push(a);
      groups.set(k, list);
    }
    for (const rows of groups.values()) {
      const inSources = rows.filter((r) =>
        allocations.some((a) => a.id === r.id)
      );
      if (inSources.length < (rows.some((r) => targetAllocations.some((t) => t.id === r.id)) ? 1 : 2)) continue;
      const onTarget = rows.find((r) => targetAllocations.some((t) => t.id === r.id));
      const winner =
        onTarget ??
        [...inSources].sort(
          (a, b) => b.minutes - a.minutes || b.deadline.getTime() - a.deadline.getTime()
        )[0];
      for (const loser of rows) {
        if (loser !== winner && inSources.some((r) => r.id === loser.id)) {
          allocationMerges.push({ loserId: loser.id, winnerId: winner.id });
        }
      }
    }
  }

  const pairings = await prisma.mentorAssignment.findMany({
    where: { programId: { in: sourceIds } },
    include: {
      mentor: { select: { email: true, name: true } },
      cohort: { select: { name: true } },
    },
  });

  const [sessionCount, assignmentCount, taskCount, changeCount, staffCount] =
    await Promise.all([
      prisma.session.count({ where: { programId: { in: sourceIds } } }),
      prisma.assignment.count({ where: { programId: { in: sourceIds } } }),
      prisma.studentTask.count({ where: { programId: { in: sourceIds } } }),
      prisma.hourAllotmentChange.count({ where: { programId: { in: sourceIds } } }),
      prisma.programStaff.count({ where: { programId: { in: sourceIds } } }),
    ]);

  // --------------------------------------------------------------- report

  for (const s of sources) {
    console.log(
      `  + level ${s.level.name} — standard ${s.level.minutes} min${s.level.days ? ` / ${s.level.days} days` : " (no days on the old program — inherits Research's)"}`
    );
  }
  for (const c of cohortPlan) {
    console.log(
      c.mergeIntoId
        ? `  ~ cohort ${c.name} → ${c.levelName} — folds into the ${c.levelName} cohort of that name already there`
        : `  → cohort ${c.name} → ${c.levelName}`
    );
  }
  for (const e of enrollmentPlan) {
    console.log(
      e.kind === "drop"
        ? `  ! ${e.label} — membership dropped (${e.why})`
        : `  → ${e.label} → ${e.to}${e.kind === "convert" ? " — their exchange became a membership" : ""}`
    );
  }
  console.log(
    `Allocations: ${allocations.length} in the old programs, ${allocationMerges.length} merge into a surviving grant`
  );
  console.log(
    `Sessions ${sessionCount} · assignments ${assignmentCount} · to-dos ${taskCount} · grant history ${changeCount} · staff grants ${staffCount}`
  );
  for (const p of pairings) {
    const levelName = sources.find((s) => s.id === p.programId)!.level.name;
    console.log(
      `  → ${p.mentor.name ?? p.mentor.email} paired to ${p.cohort ? `${levelName} / ${p.cohort.name}` : levelName}`
    );
  }
  console.log(
    `Exchanges: ${exchanges.filter((x) => !isInternal(x)).length} retarget to Research, ${exchangeCloses.size} close (a program cannot visit itself)`
  );
  for (const s of sources) {
    console.log(`  ~ archive ${s.name}`);
  }

  if (!WRITE) {
    console.log("\nNothing written. Re-run with RESEARCH_CONFIRM=WRITE to apply.");
    return;
  }

  // ------------------------------------------------------------- the write

  await prisma.$transaction(async (tx) => {
    let targetId = target?.id;
    if (!targetId) {
      targetId = (
        await tx.program.create({
          data: {
            name: TARGET_NAME,
            status: PROGRAM_STATUS.ACTIVE,
            colorIndex: nextColorIndex(
              (
                await tx.program.findMany({
                  where: { status: PROGRAM_STATUS.ACTIVE },
                  select: { colorIndex: true },
                })
              ).map((p) => p.colorIndex)
            ),
          },
        })
      ).id;
    }

    // The merged program is the Research Institute to the people who work
    // only in it (lib/space.ts). Unless somebody already named it — then the
    // platform admin has decided, and the merge leaves it alone.
    await tx.program.updateMany({
      where: { id: targetId, spaceName: null },
      data: { space: "INSTITUTE", spaceName: RESEARCH_INSTITUTE_NAME },
    });

    // Levels: create what is missing; where the level already exists (the
    // seed creates it on boot), the canonical minutes and the SOURCE program's
    // days win — that carry is the point of the merge.
    const levelIdByName = new Map<string, string>();
    for (const s of sources) {
      const existing = await tx.programLevel.findFirst({
        where: { programId: targetId, name: s.level.name },
      });
      const level =
        existing ??
        (await tx.programLevel.create({
          data: {
            programId: targetId,
            name: s.level.name,
            standardMinutes: s.level.minutes,
            standardDays: s.level.days,
          },
        }));
      if (existing) {
        await tx.programLevel.update({
          where: { id: existing.id },
          data: {
            standardMinutes: s.level.minutes,
            ...(s.level.days !== null ? { standardDays: s.level.days } : {}),
          },
        });
      }
      levelIdByName.set(s.level.name, level.id);
    }

    // Cohorts under their level; a name clash folds the old one's people onto
    // the cohort already there.
    const cohortRemap = new Map<string, string>();
    for (const c of cohortPlan) {
      if (c.mergeIntoId) {
        await tx.studentEnrollment.updateMany({
          where: { cohortId: c.id },
          data: { cohortId: c.mergeIntoId },
        });
        await tx.mentorAssignment.updateMany({
          where: { cohortId: c.id },
          data: { cohortId: c.mergeIntoId },
        });
        await tx.cohort.delete({ where: { id: c.id } });
        cohortRemap.set(c.id, c.mergeIntoId);
      } else {
        await tx.cohort.update({
          where: { id: c.id },
          data: { programId: targetId, levelId: levelIdByName.get(c.levelName)! },
        });
      }
    }

    // Enrollments: winners retarget (visitors stay level-less), losers go —
    // their ledger rows are program-scoped and move on regardless.
    for (const e of enrollmentPlan) {
      if (e.kind === "drop") {
        await tx.studentEnrollment.delete({ where: { id: e.id } });
        continue;
      }
      await tx.studentEnrollment.update({
        where: { id: e.id },
        data: {
          programId: targetId,
          levelId: e.kind === "visit" ? null : (levelIdByName.get(e.to) ?? null),
          // A visit never named a cohort or a level; a converted visit starts
          // as the level it was hosted into.
          ...(e.kind === "visit" ? { cohortId: null } : {}),
          ...(e.kind === "convert" ? { exchangeId: null, cohortId: null } : {}),
        },
      });
    }

    // Allocations fold (student, mentor) pairs that landed twice: the winner
    // gains the loser's minutes, keeps the later deadline, and takes the
    // exchange tag when only the loser carried it — the top-up rule, exactly.
    for (const merge of allocationMerges) {
      const [loser, winner] = await Promise.all([
        tx.hourAllocation.findUnique({ where: { id: merge.loserId } }),
        tx.hourAllocation.findUnique({ where: { id: merge.winnerId } }),
      ]);
      if (!loser || !winner) continue;
      const later = winner.deadline > loser.deadline ? winner.deadline : loser.deadline;
      await tx.hourAllocation.update({
        where: { id: winner.id },
        data: {
          minutes: winner.minutes + loser.minutes,
          deadline: later,
          ...(later.getTime() !== winner.deadline.getTime()
            ? { deadlineStage: null }
            : {}),
          amountPaid:
            winner.amountPaid != null || loser.amountPaid != null
              ? Number(((winner.amountPaid ?? 0) + (loser.amountPaid ?? 0)).toFixed(2))
              : null,
          exchangeId: winner.exchangeId ?? loser.exchangeId,
        },
      });
      await tx.hourAllocation.delete({ where: { id: loser.id } });
    }
    await tx.hourAllocation.updateMany({
      where: { programId: { in: sourceIds } },
      data: { programId: targetId },
    });

    await tx.session.updateMany({
      where: { programId: { in: sourceIds } },
      data: { programId: targetId },
    });
    await tx.assignment.updateMany({
      where: { programId: { in: sourceIds } },
      data: { programId: targetId },
    });
    await tx.studentTask.updateMany({
      where: { programId: { in: sourceIds } },
      data: { programId: targetId },
    });
    await tx.hourAllotmentChange.updateMany({
      where: { programId: { in: sourceIds } },
      data: { programId: targetId },
    });

    // Pairings: program-wide in an old program becomes LEVEL-wide in Research
    // ("worked in Emerging" ≠ "works in Research"); a cohort pairing keeps its
    // cohort, now sitting under the level. Duplicates keep one row.
    for (const p of pairings) {
      const levelId = p.cohortId ? null : levelIdByName.get(sources.find((s) => s.id === p.programId)!.level.name)!;
      const cohortId = p.cohortId ? (cohortRemap.get(p.cohortId) ?? p.cohortId) : null;
      const dup = await tx.mentorAssignment.findFirst({
        where: { mentorId: p.mentorId, programId: targetId, levelId, cohortId },
      });
      if (dup) {
        await tx.mentorAssignment.delete({ where: { id: p.id } });
        continue;
      }
      await tx.mentorAssignment.update({
        where: { id: p.id },
        data: { programId: targetId, levelId },
      });
    }

    // Staff grants: one row per person, keeping the higher role they held.
    const staff = await tx.programStaff.findMany({
      where: { programId: { in: sourceIds } },
      include: { user: { select: { id: true } } },
    });
    const bestByUser = new Map<string, string>();
    for (const g of [
      ...staff,
      ...(await tx.programStaff.findMany({ where: { programId: targetId } })),
    ]) {
      const best = bestByUser.get(g.userId);
      if (!best || (ROLE_RANK[g.role] ?? 0) > (ROLE_RANK[best] ?? 0)) {
        bestByUser.set(g.userId, g.role);
      }
    }
    const keptByUser = new Set<string>();
    for (const g of staff) {
      const existing = await tx.programStaff.findUnique({
        where: { userId_programId: { userId: g.userId, programId: targetId } },
      });
      if (existing) {
        await tx.programStaff.delete({ where: { id: g.id } });
        if ((ROLE_RANK[bestByUser.get(g.userId)!] ?? 0) > (ROLE_RANK[existing.role] ?? 0)) {
          await tx.programStaff.update({
            where: { id: existing.id },
            data: { role: bestByUser.get(g.userId)! },
          });
        }
        continue;
      }
      if (keptByUser.has(g.userId)) {
        await tx.programStaff.delete({ where: { id: g.id } });
        continue;
      }
      keptByUser.add(g.userId);
      await tx.programStaff.update({
        where: { id: g.id },
        data: { programId: targetId, role: bestByUser.get(g.userId)! },
      });
    }

    // Exchanges: retarget the ends that named an old program, then close the
    // placements that ended up inside one program.
    await tx.programExchange.updateMany({
      where: { fromProgramId: { in: sourceIds } },
      data: { fromProgramId: targetId },
    });
    await tx.programExchange.updateMany({
      where: { toProgramId: { in: sourceIds } },
      data: { toProgramId: targetId },
    });
    for (const id of exchangeCloses) {
      await tx.programExchange.update({
        where: { id },
        data: {
          status: EXCHANGE_STATUS.RETURNED,
          returnedAt: new Date(),
          returnNote: "Closed by the research merge: both ends are the same program now.",
        },
      });
    }

    await tx.program.updateMany({
      where: { id: { in: sourceIds } },
      data: { status: PROGRAM_STATUS.ARCHIVED, archivedAt: new Date() },
    });
  });

  console.log("\nDone.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
