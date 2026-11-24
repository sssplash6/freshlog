import { describe, expect, it } from "vitest";

import { loginFor, safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it("keeps a path on this site with its query", () => {
    expect(safeNext("/sessions/new?minutes=47&call=15%3A02")).toBe("/sessions/new?minutes=47&call=15%3A02");
    expect(safeNext("/sessions/from-call?p=1~%D0%90")).toBe("/sessions/from-call?p=1~%D0%90");
  });

  it("refuses anything that leaves the site", () => {
    for (const bad of ["https://evil.example", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "evil", ""]) {
      expect(safeNext(bad), bad).toBeUndefined();
    }
    expect(safeNext("/a\nb")).toBeUndefined();
    expect(safeNext(["/x"])).toBeUndefined();
  });

  it("never loops back to sign-in", () => {
    expect(safeNext("/login?next=/x")).toBeUndefined();
    expect(safeNext("/api/auth/signout")).toBeUndefined();
  });
});

describe("loginFor", () => {
  it("carries the path, and leaves plain /login for home", () => {
    expect(loginFor("/sessions/new?minutes=47")).toBe("/login?next=%2Fsessions%2Fnew%3Fminutes%3D47");
    expect(loginFor("/")).toBe("/login");
    expect(loginFor("//evil.example")).toBe("/login");
  });
});
