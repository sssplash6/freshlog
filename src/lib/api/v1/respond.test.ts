import { describe, expect, it } from "vitest";

import { fromAction, noContent, ok, refused, signInAgain } from "@/lib/api/v1/respond";

describe("respond", () => {
  it("signInAgain is a 401 the app recognises", async () => {
    const res = signInAgain();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Sign in again.", code: "unauthenticated" });
  });

  it("fromAction answers an action's refusal with 400 and its own words", async () => {
    const res = fromAction({ ok: false, error: "Student not found.", field: "studentProfileId" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Student not found.", field: "studentProfileId" });
  });

  it("fromAction answers success with 200 and the state unchanged", async () => {
    expect((await fromAction({ ok: true, message: "Session voided; hours returned." }).json()).message)
      .toBe("Session voided; hours returned.");
  });

  it("never lets a JSON answer be cached", () => {
    expect(ok({ a: 1 }).headers.get("cache-control")).toBe("no-store");
  });

  it("fromAction passes a receipt through untouched, and answers it with 200", async () => {
    const state = {
      ok: true as const,
      message: "Logged 90 min with Aziza.",
      receipt: { id: "s1", headline: "Logged 90 min with Aziza.", notes: ["2 h remaining."] },
    };
    const res = fromAction(state);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(state);
  });

  it("fromAction answers an action that returned nothing with 500 and a plain apology", async () => {
    const res = fromAction(null);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Something went wrong. Try again." });
  });

  it("ok answers 200 with the data itself as JSON, or 201 when asked", async () => {
    const res = ok({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ a: 1 });
    expect(ok({ id: "x" }, 201).status).toBe(201);
  });

  it("noContent is a 204 with nothing in it", async () => {
    const res = noContent();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("refused answers with the status, the words, and only the field or code it was given", async () => {
    const inactive = refused("This account isn't active.", 403, { code: "inactive" });
    expect(inactive.status).toBe(403);
    expect(await inactive.json()).toEqual({ ok: false, error: "This account isn't active.", code: "inactive" });

    const bad = refused("Pick a date.", 400, { field: "date" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: "Pick a date.", field: "date" });

    const missing = refused("Not found.", 404);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: "Not found." });

    expect(refused("Too many tries.", 429).status).toBe(429);
  });

  it("no helper forgets to forbid caching, whatever it answers", () => {
    const answers = [
      ok({ a: 1 }),
      ok({ a: 1 }, 201),
      noContent(),
      refused("No.", 400),
      signInAgain(),
      fromAction({ ok: true }),
      fromAction({ ok: false, error: "No." }),
      fromAction(null),
    ];
    for (const res of answers) expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
