import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import { PartnerFeedbackView } from "@/components/partner-feedback-view";
import { signPass } from "@/lib/partner-feedback";
import { prisma } from "@/lib/prisma";
import { partner, partnerEmail, partnerStaffEmail } from "@/test/db";

// Nobody here is signed in; the auth module is only on the import path.
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k)! } : undefined),
  }),
}));

// `openPartner` is wrapped in React's `cache`; a fresh module per test keeps
// one test's partner from answering for the next.
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-for-partner-passes");
  jar.clear();
});

const staffPage = async () => (await import("@/app/f/[slug]/staff/page")).default;
const at = (slug: string) => ({
  params: Promise.resolve({ slug }),
  searchParams: Promise.resolve({}),
});

/**
 * Whether the rendered tree reaches the feedback view, or stops at the email
 * step. By name, not identity: `resetModules` gives the page its own copy of
 * the component.
 */
function showsFeedback(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(showsFeedback);
  const el = node as ReactElement<{ children?: unknown }>;
  if (typeof el.type === "function" && el.type.name === PartnerFeedbackView.name) return true;
  return showsFeedback(el.props?.children);
}

async function render(slug: string) {
  const Page = await staffPage();
  try {
    return { tree: await Page(at(slug)), digest: null };
  } catch (error) {
    return { tree: null, digest: String((error as { digest?: string }).digest ?? error) };
  }
}

describe("/f/[slug]/staff", () => {
  it("shows the email step, not the feedback, without a pass", async () => {
    await partner({ slug: "cana" });
    const { tree } = await render("cana");
    expect(showsFeedback(tree)).toBe(false);
  });

  it("shows the feedback to a listed staff member", async () => {
    const p = await partner({ slug: "cana" });
    await partnerStaffEmail(p.id, "head@cana.uz");
    jar.set("pfs_cana", signPass("cana", "head@cana.uz", new Date(), "staff").value);
    const { tree } = await render("cana");
    expect(showsFeedback(tree)).toBe(true);
  });

  it("does not let a student's pass in, even copied into the staff cookie", async () => {
    const p = await partner({ slug: "cana" });
    await partnerEmail(p.id, "a@x.uz");
    const student = signPass("cana", "a@x.uz", new Date()).value;
    jar.set("pf_cana", student);
    jar.set("pfs_cana", student);
    const { tree } = await render("cana");
    expect(showsFeedback(tree)).toBe(false);
  });

  it("closes to a staff member taken off the list while their pass is live", async () => {
    const p = await partner({ slug: "cana" });
    await partnerStaffEmail(p.id, "head@cana.uz");
    jar.set("pfs_cana", signPass("cana", "head@cana.uz", new Date(), "staff").value);
    await prisma.partnerStaff.deleteMany();
    const { tree } = await render("cana");
    expect(showsFeedback(tree)).toBe(false);
  });

  it("answers a switched-off partner with not-found, pass or no pass", async () => {
    const p = await partner({ slug: "cana", active: false });
    await partnerStaffEmail(p.id, "head@cana.uz");
    jar.set("pfs_cana", signPass("cana", "head@cana.uz", new Date(), "staff").value);
    const { digest } = await render("cana");
    expect(digest).toContain("404");
  });
});
