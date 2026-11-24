import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import proxy from "@/proxy";

function signedOut(path: string) {
  return proxy(new NextRequest(new URL(path, "https://www.freshlog.net"), { method: "POST" }));
}

/** The page a redirect lands on, without the `?next=` it carries back. */
function landsOn(res: Response) {
  const location = res.headers.get("location");
  if (!location) return null;
  const url = new URL(location);
  return `${url.origin}${url.pathname}`;
}

describe("proxy", () => {
  it("lets Telegram's webhook through without a session", () => {
    const res = signedOut("/api/telegram/webhook");
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets a partner's student reach the feedback form without a session", () => {
    expect(signedOut("/f/cana").headers.get("location")).toBeNull();
    expect(signedOut("/f/cana/mentor").headers.get("location")).toBeNull();
  });

  // The prefix is "/f" exactly or "/f/…" — not every path that starts with an f.
  it("does not open /feedback along with /f", () => {
    const res = signedOut("/feedback");
    expect(landsOn(res)).toBe("https://www.freshlog.net/login");
  });

  // The pass cookie's path is the stored, lowercase slug; any other spelling
  // of the link would never get it back.
  it("sends a partner link spelt any other way to its stored spelling", () => {
    expect(signedOut("/f/CANA/mentor").headers.get("location")).toBe(
      "https://www.freshlog.net/f/cana/mentor"
    );
    expect(signedOut("/f/%20Cana").headers.get("location")).toBe(
      "https://www.freshlog.net/f/cana"
    );
    expect(signedOut("/f/cana/session").headers.get("location")).toBeNull();
  });

  it("still sends a signed-out visitor to /login", () => {
    const res = signedOut("/bugs/triage");
    expect(landsOn(res)).toBe("https://www.freshlog.net/login");
  });

  // So a filled-in form (the call logger's, say) survives signing in.
  it("tells the login page where the visitor was going", () => {
    const res = signedOut("/sessions/from-call?start=1&end=2");
    const next = new URL(res.headers.get("location")!).searchParams.get("next");
    expect(next).toBe("/sessions/from-call?start=1&end=2");
  });

  it("lets the app's API through without a cookie", () => {
    expect(signedOut("/api/v1/me").headers.get("location")).toBeNull();
  });

  it("lets anyone read the privacy policy and support pages", () => {
    expect(signedOut("/privacy").headers.get("location")).toBeNull();
    expect(signedOut("/support").headers.get("location")).toBeNull();
  });

  it("still sends a look-alike path to the login page", () => {
    expect(landsOn(signedOut("/api/v1x"))).toBe("https://www.freshlog.net/login");
  });
});
