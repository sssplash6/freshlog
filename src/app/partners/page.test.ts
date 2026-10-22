import { beforeEach, describe, expect, it, vi } from "vitest";

import { admin, partner, platformAdmin } from "@/test/db";

const session = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (session.id ? { user: { id: session.id } } : null),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// `getCurrentUser` reads the request's Authorization header, and outside a
// request there are no headers to read. A browser sends none, so none it is.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// `getCurrentUser` is wrapped in React's `cache`; a fresh module per test keeps
// one test's user from answering for the next.
beforeEach(() => {
  vi.resetModules();
  session.id = null;
});

const digestOf = async (render: () => Promise<unknown>) => {
  try {
    await render();
  } catch (error) {
    return String((error as { digest?: string }).digest ?? error);
  }
  return "rendered";
};

const listPage = async () => (await import("@/app/partners/page")).default;
const partnerPage = async () => (await import("@/app/partners/[slug]/page")).default;
const settingsPage = async () =>
  (await import("@/app/partners/[slug]/settings/page")).default;

const at = (slug: string) => ({
  params: Promise.resolve({ slug }),
  searchParams: Promise.resolve({}),
});

describe("/partners", () => {
  it("answers a plain admin with not-found", async () => {
    session.id = (await admin()).id;
    const Page = await listPage();
    expect(await digestOf(() => Page())).toContain("404");
  });

  it("renders for a platform admin", async () => {
    session.id = (await platformAdmin()).id;
    const Page = await listPage();
    expect(await digestOf(() => Page())).toBe("rendered");
  });
});

describe("/partners/[slug]", () => {
  it("answers a plain admin with not-found, even for a partner that exists", async () => {
    const p = await partner({ slug: "khana" });
    session.id = (await admin()).id;
    const Page = await partnerPage();
    expect(await digestOf(() => Page(at(p.slug)))).toContain("404");
    const Settings = await settingsPage();
    expect(await digestOf(() => Settings(at(p.slug)))).toContain("404");
  });

  it("answers an unknown slug like a forbidden one", async () => {
    session.id = (await platformAdmin()).id;
    const Page = await partnerPage();
    expect(await digestOf(() => Page(at("nobody")))).toContain("404");
  });

  it("renders a partner, and its settings, for a platform admin", async () => {
    const p = await partner({ slug: "khana", active: false });
    session.id = (await platformAdmin()).id;
    const Page = await partnerPage();
    expect(await digestOf(() => Page(at(p.slug)))).toBe("rendered");
    const Settings = await settingsPage();
    expect(await digestOf(() => Settings(at(p.slug)))).toBe("rendered");
  });
});
