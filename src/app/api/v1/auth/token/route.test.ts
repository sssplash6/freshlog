import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/auth/token/route";
import { CODE_FAILED, issueSignInCode, userForToken } from "@/lib/api/tokens";
import { prisma } from "@/lib/prisma";
import { DAY, mentor } from "@/test/db";

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"; // RFC 7636, appendix B
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const APP = "freshlog://auth";

/**
 * `token` is the sign-in itself: it has no session to check, and the code with
 * the verifier is all the proof it asks for. So every way a request can be wrong
 * has the same answer, and none of them is a crash.
 */
const request = (raw: string) => new Request("http://test/api/v1/auth/token", { method: "POST", body: raw });
const json = (body: unknown) => request(JSON.stringify(body));
const send = (body: unknown) => POST(json(body));
const sendRaw = (raw: string) => POST(request(raw));

async function aCode() {
  const m = await mentor();
  return { m, code: await issueSignInCode(m.id, CHALLENGE, APP) };
}

const refusal = { ok: false, error: CODE_FAILED };

describe("POST /api/v1/auth/token", () => {
  it("swaps a code for a token that finds its user", async () => {
    const m = await mentor();
    const code = await issueSignInCode(m.id, CHALLENGE, "freshlog://auth");
    const res = await POST(json({ code, code_verifier: VERIFIER, redirect_uri: "freshlog://auth", device_name: "iPhone 17 Pro" }));
    expect(res.status).toBe(200);
    expect((await userForToken((await res.json()).token))?.id).toBe(m.id);
  });

  it("refuses a code used twice", async () => {
    const m = await mentor();
    const body = { code: await issueSignInCode(m.id, CHALLENGE, "freshlog://auth"), code_verifier: VERIFIER, redirect_uri: "freshlog://auth" };
    expect((await POST(json(body))).status).toBe(200);
    const again = await POST(json(body));
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ ok: false, error: CODE_FAILED });
  });

  it("refuses a body without a code", async () => {
    expect((await POST(json({ code_verifier: VERIFIER }))).status).toBe(400);
  });
});

describe("the token it hands over", () => {
  it("is the token and the time it runs out, as an ISO date about 90 days away", async () => {
    const { code } = await aCode();
    const res = await send({ code, code_verifier: VERIFIER, redirect_uri: APP });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "token"]);
    expect(typeof body.token).toBe("string");
    expect(new Date(body.expiresAt).toISOString()).toBe(body.expiresAt);
    expect(Math.abs(new Date(body.expiresAt).getTime() - (Date.now() + 90 * DAY))).toBeLessThan(60_000);
  });

  it("is never kept by a cache", async () => {
    const { code } = await aCode();
    expect((await send({ code, code_verifier: VERIFIER, redirect_uri: APP })).headers.get("cache-control")).toBe("no-store");
    expect((await send({})).headers.get("cache-control")).toBe("no-store");
  });

  it("is a new one each time, for the person the code was made for", async () => {
    const a = await aCode();
    const b = await aCode();
    const first = await (await send({ code: a.code, code_verifier: VERIFIER, redirect_uri: APP })).json();
    const second = await (await send({ code: b.code, code_verifier: VERIFIER, redirect_uri: APP })).json();
    expect(first.token).not.toBe(second.token);
    expect((await userForToken(first.token))?.id).toBe(a.m.id);
    expect((await userForToken(second.token))?.id).toBe(b.m.id);
  });

  it("is kept only as a hash, so what comes back is the one place it can be read", async () => {
    const { code } = await aCode();
    const { token } = await (await send({ code, code_verifier: VERIFIER, redirect_uri: APP })).json();
    expect(JSON.stringify(await prisma.apiToken.findMany())).not.toContain(token);
  });
});

describe("a code that does not work", () => {
  it("is refused with the same words whichever way it fails", async () => {
    const wrongVerifier = await aCode();
    const wrongRedirect = await aCode();
    const expired = await mentor();
    const late = await issueSignInCode(expired.id, CHALLENGE, APP, new Date(Date.now() - 3 * 60_000));
    const used = await aCode();
    await send({ code: used.code, code_verifier: VERIFIER, redirect_uri: APP });
    expect(await prisma.apiToken.count()).toBe(1); // the one that used it up

    const answers = [
      await send({ code: "no-such-code", code_verifier: VERIFIER, redirect_uri: APP }),
      await send({ code: wrongVerifier.code, code_verifier: "x".repeat(43), redirect_uri: APP }),
      await send({ code: wrongRedirect.code, code_verifier: VERIFIER, redirect_uri: "freshlog://elsewhere" }),
      await send({ code: late, code_verifier: VERIFIER, redirect_uri: APP }),
      await send({ code: used.code, code_verifier: VERIFIER, redirect_uri: APP }),
    ];
    for (const res of answers) {
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(refusal);
    }
    expect(await prisma.apiToken.count()).toBe(1); // still only that one
  });

  it("is used up by a wrong verifier, so it cannot be guessed at", async () => {
    const { code } = await aCode();
    expect((await send({ code, code_verifier: "x".repeat(43), redirect_uri: APP })).status).toBe(400);
    expect((await send({ code, code_verifier: VERIFIER, redirect_uri: APP })).status).toBe(400);
    expect(await prisma.apiToken.count()).toBe(0);
  });

  it("is used up by a wrong redirect, so it cannot be guessed at", async () => {
    const { code } = await aCode();
    expect((await send({ code, code_verifier: VERIFIER, redirect_uri: "freshlog://elsewhere" })).status).toBe(400);
    expect((await send({ code, code_verifier: VERIFIER, redirect_uri: APP })).status).toBe(400);
    expect(await prisma.apiToken.count()).toBe(0);
  });

  it("gives one token, and a plain refusal to the rest, when requests race to use it", async () => {
    const { code } = await aCode();
    const body = { code, code_verifier: VERIFIER, redirect_uri: APP };
    // `allSettled`, so a request that threw would show up as one and not vanish.
    const answers = await Promise.allSettled([send(body), send(body), send(body)]);
    expect(answers.map((a) => (a.status === "fulfilled" ? a.value.status : "threw")).sort()).toEqual([200, 400, 400]);
    expect(await prisma.apiToken.count()).toBe(1);
  });
});

describe("a body that is not a token request", () => {
  it.each([
    ["bad JSON", "{"],
    ["no body", ""],
    ["null", "null"],
    ["a list", "[]"],
    ["a string", '"code"'],
    ["a number", "42"],
    ["an empty object", "{}"],
  ])("is refused: %s", async (_name, raw) => {
    const res = await sendRaw(raw);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(refusal);
  });

  it("is refused when a field is left out, and the code is not touched", async () => {
    const { code } = await aCode();
    const whole = { code, code_verifier: VERIFIER, redirect_uri: APP };
    for (const field of Object.keys(whole)) {
      const rest: Record<string, string> = { ...whole };
      delete rest[field];
      const res = await send(rest);
      expect(res.status, field).toBe(400);
      expect(await res.json(), field).toEqual(refusal);
    }
    expect((await send(whole)).status).toBe(200);
  });

  it("is refused when a field is not text or is empty, without ever reaching the code", async () => {
    const { code } = await aCode();
    const whole = { code, code_verifier: VERIFIER, redirect_uri: APP };
    for (const field of Object.keys(whole)) {
      for (const bad of [123, null, true, {}, [], ["x"], ""]) {
        const res = await send({ ...whole, [field]: bad });
        expect(res.status, `${field}: ${JSON.stringify(bad)}`).toBe(400);
        expect(await res.json(), `${field}: ${JSON.stringify(bad)}`).toEqual(refusal);
      }
    }
    expect(await prisma.apiToken.count()).toBe(0);
    // None of that spent the code: it never got as far as the database.
    expect((await send(whole)).status).toBe(200);
  });

  it("is answered the same for a real code as for a made-up one, so the answer says nothing about the code", async () => {
    const { code } = await aCode();
    const real = await send({ code, code_verifier: 12345, redirect_uri: APP });
    const madeUp = await send({ code: "no-such-code", code_verifier: 12345, redirect_uri: APP });
    expect(real.status).toBe(madeUp.status);
    expect(await real.json()).toEqual(await madeUp.json());
  });

  it("does not crash on a verifier that is not text, which would be a 500 only a real code could cause", async () => {
    const { code } = await aCode();
    await expect(send({ code, code_verifier: 12345, redirect_uri: APP })).resolves.toHaveProperty("status", 400);
    await expect(send({ code, code_verifier: { a: 1 }, redirect_uri: APP })).resolves.toHaveProperty("status", 400);
    await expect(send({ code, code_verifier: VERIFIER, redirect_uri: 12345 })).resolves.toHaveProperty("status", 400);
  });
});

describe("the device name", () => {
  const sign = async (extra: Record<string, unknown>) => {
    const { code } = await aCode();
    const res = await send({ code, code_verifier: VERIFIER, redirect_uri: APP, ...extra });
    expect(res.status).toBe(200);
    return (await prisma.apiToken.findFirstOrThrow()).deviceName;
  };

  it("is kept with the token", async () => {
    expect(await sign({ device_name: "iPhone 17 Pro" })).toBe("iPhone 17 Pro");
  });

  it("is cut to 100 characters", async () => {
    expect(await sign({ device_name: "x".repeat(150) })).toBe("x".repeat(100));
  });

  it("is left out when it is not text", async () => {
    for (const bad of [42, true, {}, ["iPhone"], null]) {
      await prisma.apiToken.deleteMany();
      expect(await sign({ device_name: bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  it("is left out when it is not sent, or says nothing", async () => {
    expect(await sign({})).toBeNull();
    await prisma.apiToken.deleteMany();
    expect(await sign({ device_name: "   " })).toBeNull();
  });
});
