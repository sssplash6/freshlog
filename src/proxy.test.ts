import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import proxy from "@/proxy";

function signedOut(path: string) {
  return proxy(new NextRequest(new URL(path, "https://www.freshlog.net"), { method: "POST" }));
}

describe("proxy", () => {
  it("lets Telegram's webhook through without a session", () => {
    const res = signedOut("/api/telegram/webhook");
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets a partner's student reach the feedback form without a session", () => {
    expect(signedOut("/f/khana").headers.get("location")).toBeNull();
    expect(signedOut("/f/khana/mentor").headers.get("location")).toBeNull();
  });

  // The prefix is "/f" exactly or "/f/…" — not every path that starts with an f.
  it("does not open /feedback along with /f", () => {
    const res = signedOut("/feedback");
    expect(res.headers.get("location")).toBe("https://www.freshlog.net/login");
  });

  it("still sends a signed-out visitor to /login", () => {
    const res = signedOut("/bugs/triage");
    expect(res.headers.get("location")).toBe("https://www.freshlog.net/login");
  });
});
