// What each person sees on each page the app mirrors, as plain text, from a local server started with
// `DEV_LOGIN=1 next dev -p 3101` on the sample data and scripts/parity/personas.ts. LOCAL development only.
//
// A page's data assembly moving into src/lib/screens is a move that must render the same (AGENTS.md, rule 4):
// take a snapshot before it, one after, and diff them.
//
//   npx tsx scripts/parity/pages.ts <out-dir> [page-filter]
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";

const BASE = process.env.PARITY_BASE ?? "http://localhost:3101";
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! }) });

/** Everybody the pages are read as: each role, and the mixes the map found differences in. */
const PEOPLE = [
  "tech@freshman.academy", // platform admin who mentors
  "akmal@freshman.academy", // mentor in two programs who runs one
  "dilnoza@freshman.academy", // mentor
  "lola.leader@freshman.academy", // read-only Leader
  "sami.sales@freshman.academy", // Sales
  "malika@student.example.com", // student
  "timur@student.example.com", // student in another program
];

/** The visible words of a page: no scripts, styles or tags, whitespace folded, a clock time blanked. */
function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "HH:MM")
    .replace(/\s+/g, " ")
    .replace(/ (?=[.,;:!?])/g, "")
    .trim()
    .split(/(?<=[.!?]) (?=[A-Z])/)
    .join("\n");
}

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/dev-login?email=${encodeURIComponent(email)}`, { redirect: "manual" });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error(`No sign-in for ${email}: ${res.status}`);
  return cookie;
}

async function main() {
  const [out, filter] = process.argv.slice(2);
  if (!out) throw new Error("Name a directory to write the snapshot into.");
  const programs = Object.fromEntries((await prisma.program.findMany()).map((p) => [p.name, p.id]));
  const student = await prisma.studentProfile.findFirstOrThrow({ where: { user: { email: "jasur@student.example.com" } } });
  const mentor = await prisma.user.findUniqueOrThrow({ where: { email: "dilnoza@freshman.academy" } });
  const pages = [
    "/mentor",
    "/admin",
    "/student",
    "/sessions",
    "/students",
    "/programs",
    `/programs/${programs["Global Admissions Program"]}`,
    `/programs/${programs["Flexible Program"]}`,
    `/programs/${programs["Global Admissions Program"]}/allocate`,
    `/programs/${programs["Global Admissions Program"]}/allocate?student=${student.id}`,
    `/students/${student.id}`,
    "/feedback",
    "/feedback?kind=meetings",
    "/feedback?kind=written&rating=1-3",
    "/feedback?sort=score&dir=asc",
    "/feedback?meetings=2",
    "/mentors",
    `/mentors/${mentor.id}`,
    `/mentors/${mentor.id}?period=30d`,
    `/mentors/${mentor.id}?period=all`,
    `/mentors/${mentor.id}?period=custom&from=2026-09-01&to=2026-10-15`,
    "/analytics",
    "/analytics?y=2025",
    "/analytics?m=9",
    "/classes",
    "/classes?month=2026-11",
    "/student/interviews",
    "/mentor/interviews",
  ].filter((p) => !filter || p.includes(filter));

  mkdirSync(out, { recursive: true });
  for (const email of PEOPLE) {
    const cookie = await signIn(email);
    for (const page of pages) {
      const res = await fetch(`${BASE}${page}`, { headers: { cookie }, redirect: "manual" });
      const body = res.status >= 300 && res.status < 400 ? `REDIRECT ${res.headers.get("location")}` : text(await res.text());
      const file = `${email.split("@")[0]}${page.replace(/[/?&=]/g, "_")}.txt`;
      writeFileSync(join(out, file), `${res.status}\n${body}\n`);
    }
    console.log(`${email}: ${pages.length} pages`);
  }
}

main().finally(() => prisma.$disconnect());
