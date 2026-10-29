// The people the parity checks read pages as, on top of the sample data (prisma/sample-data.ts and
// prisma/student-sample-data.ts): a mentor who also runs a program, a read-only Leader and a Sales admin. LOCAL
// development only. Idempotent by email; never deletes.
//
// Run with: npx tsx scripts/parity/personas.ts
import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! }) });

async function main() {
  const programs = Object.fromEntries((await prisma.program.findMany()).map((p) => [p.name, p]));
  const global = programs["Global Admissions Program"];
  const flexible = programs["Flexible Program"];
  if (!global || !flexible) throw new Error("Run the seed and the sample data first.");

  // Akmal mentors in Global and Flexible; here he also runs Global.
  const akmal = await prisma.user.findUniqueOrThrow({ where: { email: "akmal@freshman.academy" } });
  await prisma.programStaff.upsert({
    where: { userId_programId: { userId: akmal.id, programId: global.id } },
    update: { role: "ADMIN" },
    create: { userId: akmal.id, programId: global.id, role: "ADMIN" },
  });

  for (const [email, name, program, role] of [
    ["lola.leader@freshman.academy", "Lola Leader", global, "LEADER"],
    ["sami.sales@freshman.academy", "Sami Sales", flexible, "SALES"],
  ] as const) {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, role: "ADMIN", status: "ACTIVE" },
    });
    await prisma.programStaff.upsert({
      where: { userId_programId: { userId: user.id, programId: program.id } },
      update: { role },
      create: { userId: user.id, programId: program.id, role },
    });
  }
  console.log("Personas ready.");
}

main().finally(() => prisma.$disconnect());
