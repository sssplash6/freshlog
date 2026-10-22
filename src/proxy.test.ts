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

  it("still sends a signed-out visitor to /login", () => {
    const res = signedOut("/bugs/triage");
    expect(res.headers.get("location")).toBe("https://www.freshlog.net/login");
  });

  it("lets the app's API through without a cookie", () => {
    expect(signedOut("/api/v1/me").headers.get("location")).toBeNull();
  });

  it("still sends a look-alike path to the login page", () => {
    expect(signedOut("/api/v1x").headers.get("location")).toBe("https://www.freshlog.net/login");
  });
});
