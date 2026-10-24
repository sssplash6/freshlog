import { describe, expect, it } from "vitest";

import { redirect } from "next/navigation";

import { fromAction, fromRedirectingAction, inactive, noContent, ok, refused, signInAgain } from "@/lib/api/v1/respond";

describe("respond", () => {
  it("signInAgain is a 401 the app recognises", async () => {
    const res = signInAgain();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Sign in again.", code: "unauthenticated" });
  });

  it("inactive is a 403 the app recognises", async () => {
    const res = inactive();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "Your account isn't active yet.", code: "inactive" });
  });

  it("fromAction answers an action's refusal with 400 and its own words", async () => {
    const res = fromAction({ ok: false, error: "Student not found.", field: "studentProfileId" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Student not found.", field: "studentProfileId" });
  });

  it("fromAction keeps a refusal's words and field, and not the values it echoed", async () => {
    const res = fromAction({ ok: false, error: "Pick a valid date.", field: "date", values: { note: "private" } });
    expect(await res.json()).toEqual({ ok: false, error: "Pick a valid date.", field: "date" });
  });

  it("fromAction answers success with 200 and the action's own sentence", async () => {
    expect((await fromAction({ ok: true, message: "Session voided; hours returned." }).json()).message)
      .toBe("Session voided; hours returned.");
  });

  // The contract's WriteResult is `{ ok, message?, receipt? }`. What else an
  // action adds to a success is for the website: `editSession` echoes back the
  // session it saved, the mentor's note included, and that note is not for
  // everyone who may edit (never for the student it is about, even one who also
  // administers the program).
  it("fromAction answers a success with only ok, message and receipt", async () => {
    const receipt = { id: "s1", headline: "Logged 90 min with Aziza.", notes: ["2 h remaining."] };
    const res = fromAction({
      ok: true,
      message: "Session updated.",
      receipt,
      session: {
        minutes: 45,
        date: "2026-10-22T00:00:00.000Z",
        note: "private",
        assignmentId: null,
        attended: true,
        late: false,
        status: "ACTIVE",
        withinPlan: true,
        task: null,
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "Session updated.", receipt });
  });

  it("fromAction drops anything else an action adds to a success, too", async () => {
    const state = { ok: true as const, message: "Done.", somethingNew: "private" };
    expect(await fromAction(state).json()).toEqual({ ok: true, message: "Done." });
  });

  it("fromAction answers a success with nothing to say as just ok", async () => {
    expect(await fromAction({ ok: true }).json()).toEqual({ ok: true });
  });

  it("never lets a JSON answer be cached", () => {
    expect(ok({ a: 1 }).headers.get("cache-control")).toBe("no-store");
  });

  it("fromAction answers a receipt of the contract's three fields with 200, as it is", async () => {
    const state = {
      ok: true as const,
      message: "Logged 90 min with Aziza.",
      receipt: { id: "s1", headline: "Logged 90 min with Aziza.", notes: ["2 h remaining."] },
    };
    const res = fromAction(state);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(state);
  });

  // `logSession`'s receipt also names the student it logged for (`subject`), for
  // the website's receipt. The contract's receipt is `{ id, headline, notes }`.
  it("fromAction answers a receipt with the contract's three fields, and not the subject an action adds", async () => {
    const res = fromAction({
      ok: true,
      message: "Logged 90 min with Aziza.",
      receipt: {
        id: "s1",
        headline: "Logged 90 min with Aziza.",
        notes: ["2 h remaining."],
        subject: { kind: "student", id: "p1", name: "Aziza Karimova" },
      },
    });
    const sent = await res.json();
    expect(Object.keys(sent.receipt).sort()).toEqual(["headline", "id", "notes"]);
    expect(sent).toEqual({
      ok: true,
      message: "Logged 90 min with Aziza.",
      receipt: { id: "s1", headline: "Logged 90 min with Aziza.", notes: ["2 h remaining."] },
    });
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
    const forbidden = refused("This account isn't active.", 403, { code: "inactive" });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ ok: false, error: "This account isn't active.", code: "inactive" });

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
      inactive(),
      fromAction({ ok: true }),
      fromAction({ ok: false, error: "No." }),
      fromAction(null),
    ];
    for (const res of answers) expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("fromRedirectingAction answers a redirect as success", async () => {
    const res = await fromRedirectingAction(async () => redirect("/admin"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("fromRedirectingAction answers a refusal as fromAction does", async () => {
    const res = await fromRedirectingAction(async () => ({ ok: false, error: "Program not found." }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Program not found." });
  });

  it("fromRedirectingAction lets any other error through", async () => {
    await expect(fromRedirectingAction(async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
  });
});
