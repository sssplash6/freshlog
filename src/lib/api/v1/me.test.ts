import { describe, expect, it } from "vitest";

import { meFor } from "@/lib/api/v1/me";
import { prisma } from "@/lib/prisma";
import { admin, grant, mentor, platformAdmin, program, student } from "@/test/db";

const withTelegram = (s: { id: string }) =>
  prisma.studentProfile.update({ where: { id: s.id }, data: { telegramUsername: "malika_r" } });
const userOf = (s: { userId: string }) => prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
const rename = (userId: string, name: string | null) =>
  prisma.user.update({ where: { id: userId }, data: { name } });

describe("meFor: who and which roles", () => {
  it("gives a set-up student one role and nothing left to do", async () => {
    const s = await student({ name: "Malika Rahimova" });
    await withTelegram(s);
    expect(await meFor(await userOf(s))).toMatchObject({ roles: ["student"], onboarding: null, studentProfileId: s.id });
  });

  it("answers with the contract's fields and no others", async () => {
    const s = await student({ name: "Malika Rahimova" });
    await withTelegram(s);
    const user = await userOf(s);
    expect(await meFor(user)).toEqual({
      id: user.id,
      studentProfileId: s.id,
      name: "Malika Rahimova",
      email: user.email,
      status: "ACTIVE",
      roles: ["student"],
      platformAdmin: false,
      staffLevel: null,
      classes: false,
      avatarPath: null,
      unread: 0,
      onboarding: null,
      deletionRequestedAt: null,
    });
  });

  it("says the widest staff grant as the website's nav reads it", async () => {
    const ga = await program("Global Admissions");
    const imkon = await program("Imkon");
    const sales = await admin("Sami Sales");
    await grant({ userId: sales.id, programId: ga.id, role: "SALES" });
    expect((await meFor(sales)).staffLevel).toBe("SALES");
    // Leading one program and selling into another is the wider of the two.
    await grant({ userId: sales.id, programId: imkon.id, role: "LEADER" });
    expect((await meFor(sales)).staffLevel).toBe("LEADER");
    const boss = await admin("Nodira Aliyeva");
    await grant({ userId: boss.id, programId: ga.id });
    expect((await meFor(boss)).staffLevel).toBe("ADMIN");
  });

  it("puts admin first for a mentor who administers a program", async () => {
    const p = await program();
    const m = await mentor("Dilnoza Yusupova");
    await grant({ userId: m.id, programId: p.id });
    expect((await meFor(m)).roles).toEqual(["admin", "mentor"]);
  });

  it("gives a platform admin the admin role", async () => {
    expect((await meFor(await platformAdmin())).roles[0]).toBe("admin");
  });

  it("says who runs the platform, and nobody else", async () => {
    expect((await meFor(await platformAdmin())).platformAdmin).toBe(true);
    expect((await meFor(await mentor())).platformAdmin).toBe(false);
  });

  it("lists a student who also mentors and administers as student, admin, mentor", async () => {
    const p = await program();
    const s = await student({ name: "Malika Rahimova", programId: p.id });
    await withTelegram(s);
    await grant({ userId: s.userId, programId: p.id });
    const user = await prisma.user.update({ where: { id: s.userId }, data: { isMentor: true } });
    expect(await meFor(user)).toMatchObject({ roles: ["student", "admin", "mentor"], onboarding: null });
  });

  it("gives staff with no grant yet the admin side, as `requireStaff` lets them into /admin", async () => {
    const none = await admin("Nodira Aliyeva");
    expect(await meFor(none)).toMatchObject({ roles: ["admin"], onboarding: null });
    const flagged = await prisma.user.update({ where: { id: none.id }, data: { isMentor: true } });
    expect(await meFor(flagged)).toMatchObject({ roles: ["admin", "mentor"], onboarding: null });
  });
});

describe("meFor: what a student still has to do", () => {
  it("asks a student without a Telegram username to finish their profile", async () => {
    const s = await student({ name: "Malika Rahimova" });
    expect((await meFor(await userOf(s))).onboarding).toBe("student-profile");
  });

  it("asks a student who has no profile yet for one, and has no profile id to give", async () => {
    const user = await prisma.user.create({
      data: { email: "new-student@test.invalid", name: "Aziz Tursunov", role: "STUDENT", status: "PENDING" },
    });
    expect(await meFor(user)).toMatchObject({
      roles: ["student"],
      studentProfileId: null,
      onboarding: "student-profile",
    });
  });

  it.each([null, "", "   "])("asks a student whose name is %j for it", async (name) => {
    const s = await student({ name: "Malika Rahimova" });
    await withTelegram(s);
    expect((await meFor(await rename(s.userId, name))).onboarding).toBe("student-profile");
  });

  it("asks for the profile before it mentions the wait for approval", async () => {
    const s = await student({ name: "Malika Rahimova", status: "PENDING" });
    expect((await meFor(await userOf(s))).onboarding).toBe("student-profile");
  });

  it("tells a pending student they are waiting for approval", async () => {
    const s = await student({ name: "Malika Rahimova", status: "PENDING" });
    await withTelegram(s);
    expect((await meFor(await userOf(s))).onboarding).toBe("pending-approval");
  });
});

describe("meFor: what a mentor still has to do", () => {
  it("opens an unassigned mentor's home, as the website's, with the status that says they wait", async () => {
    const m = await prisma.user.update({ where: { id: (await mentor("Akmal Karimov")).id }, data: { status: "UNASSIGNED" } });
    expect(await meFor(m)).toMatchObject({ status: "UNASSIGNED", onboarding: null });
  });

  it.each([null, "", "   "])("asks a mentor whose name is %j for it", async (name) => {
    const m = await rename((await mentor()).id, name);
    expect(await meFor(m)).toMatchObject({ roles: ["mentor"], onboarding: "mentor-name" });
  });

  it("asks for the name before it mentions being unassigned", async () => {
    const m = await prisma.user.update({
      where: { id: (await mentor()).id },
      data: { name: null, status: "UNASSIGNED" },
    });
    expect((await meFor(m)).onboarding).toBe("mentor-name");
  });

  it("leaves a named, assigned mentor with nothing to do", async () => {
    expect(await meFor(await mentor("Akmal Karimov"))).toMatchObject({ roles: ["mentor"], onboarding: null });
  });

  it("asks a mentor who administers for their name too, as /onboarding asks any mentor", async () => {
    const p = await program();
    const m = await prisma.user.update({
      where: { id: (await mentor()).id },
      data: { name: null, status: "UNASSIGNED" },
    });
    await grant({ userId: m.id, programId: p.id });
    expect(await meFor(m)).toMatchObject({ roles: ["admin", "mentor"], onboarding: "mentor-name" });
  });

  it("gives an admin nothing to set up, even without a name", async () => {
    const root = await prisma.user.update({ where: { id: (await platformAdmin()).id }, data: { name: null } });
    expect((await meFor(root)).onboarding).toBeNull();
  });
});

describe("meFor: the picture and the bell", () => {
  it("points at the picture with its upload time, or at nothing when there is none", async () => {
    const m = await mentor("Akmal Karimov");
    expect((await meFor(m)).avatarPath).toBeNull();
    const withPicture = await prisma.user.update({
      where: { id: m.id },
      data: { avatarUpdatedAt: new Date(1_790_000_000_000) },
    });
    expect((await meFor(withPicture)).avatarPath).toBe(`/api/v1/avatars/${m.id}?v=1790000000000`);
  });

  it("counts only this person's unread notifications", async () => {
    const [a, b] = [await mentor("A Person"), await mentor("B Person")];
    const note = (userId: string, read: boolean) =>
      prisma.notification.create({ data: { userId, type: "SESSION_LOGGED", message: "x", category: "SESSIONS", read } });
    await Promise.all([note(a.id, false), note(a.id, true), note(b.id, false)]);
    expect((await meFor(a)).unread).toBe(1);
  });
});
