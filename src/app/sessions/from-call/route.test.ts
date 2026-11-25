import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentor, pairing, program, student } from "@/test/db";

/**
 * A call whose student put their Freshlog email in their Meet name logs
 * itself; anything less certain, and the same call opened twice, opens the
 * filled-in form instead.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("redirect"), { url });
  },
}));
vi.mock("@/lib/dal", () => {
  const me = async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null;
  return { getCurrentUser: me, requireMentor: me };
});

const { GET } = await import("@/app/sessions/from-call/route");

const MIN = 60 * 1000;

/** Where the route sent the mentor. */
async function open(people: string[]): Promise<string> {
  const start = Date.now() - 60 * MIN;
  const url = new URL("https://www.freshlog.net/sessions/from-call");
  url.searchParams.set("start", String(start));
  url.searchParams.set("end", String(start + 50 * MIN));
  for (const name of people) url.searchParams.append("p", `${start}~${name}`);
  try {
    await GET(new NextRequest(url));
  } catch (e) {
    if (e instanceof Error && "url" in e) return String(e.url);
    throw e;
  }
  throw new Error("no redirect");
}

async function setup() {
  const p = await program("SAT Individuals");
  const s = await student({ programId: p.id, name: "Jasur Tursunov" });
  const m = await mentor("Dilnoza Karimova");
  await pairing({ mentorId: m.id, programId: p.id });
  actor.value = m;
  const { email } = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
  return { p, s, m, email };
}

describe("/sessions/from-call", () => {
  it("logs the call itself when the student's email is in their Meet name", async () => {
    const { p, s, m, email } = await setup();

    const to = await open(["Dilnoza Karimova", `Jasur Tursunov ${email.toUpperCase()}`]);

    const session = await prisma.session.findFirstOrThrow({ where: { studentId: s.id } });
    expect(session).toMatchObject({ mentorId: m.id, programId: p.id, minutes: 50, attended: true });
    expect(to).toBe(`/sessions?edit=${session.id}#session-${session.id}`);
  });

  it("logs it once: the same call opened again goes to the form", async () => {
    const { s, email } = await setup();

    await open([`Jasur Tursunov ${email}`]);
    const again = await open([`Jasur Tursunov ${email}`]);

    expect(again).toMatch(/^\/sessions\/new\?/);
    expect(again).toContain(`studentProfileId=${s.id}`);
    await expect(prisma.session.count({ where: { studentId: s.id } })).resolves.toBe(1);
  });

  it("only fills in the form when the student is matched by name", async () => {
    const { s } = await setup();

    const to = await open(["Jasur Tursunov"]);

    expect(to).toMatch(/^\/sessions\/new\?/);
    expect(to).toContain(`studentProfileId=${s.id}`);
    await expect(prisma.session.count({ where: { studentId: s.id } })).resolves.toBe(0);
  });

  it("does not log a student in two programs when nothing says which", async () => {
    const { s, m, email } = await setup();
    const other = await program("Master's");
    await prisma.studentEnrollment.create({ data: { studentId: s.id, programId: other.id } });
    await pairing({ mentorId: m.id, programId: other.id });

    const to = await open([email]);

    expect(to).toMatch(/^\/sessions\/new\?/);
    await expect(prisma.session.count({ where: { studentId: s.id } })).resolves.toBe(0);
  });
});
