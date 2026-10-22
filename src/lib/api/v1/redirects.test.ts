import { afterEach, describe, expect, it, vi } from "vitest";

import { allowedRedirect, S256_CHALLENGE } from "@/lib/api/v1/redirects";

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"; // RFC 7636, appendix B

afterEach(() => vi.unstubAllEnvs());

describe("allowedRedirect", () => {
  it("always allows the app's own scheme", () => expect(allowedRedirect("freshlog://auth")).toBe(true));

  it("refuses an exp:// redirect unless Expo redirects are allowed", () => {
    vi.stubEnv("API_ALLOW_EXPO_REDIRECTS", "");
    expect(allowedRedirect("exp://192.168.1.5:8081/--/auth")).toBe(false);
    vi.stubEnv("API_ALLOW_EXPO_REDIRECTS", "1");
    expect(allowedRedirect("exp://192.168.1.5:8081/--/auth")).toBe(true);
  });

  it("never allows a web address", () => expect(allowedRedirect("https://evil.example/auth")).toBe(false));

  it("keeps the app's scheme open whether or not Expo redirects are", () => {
    vi.stubEnv("API_ALLOW_EXPO_REDIRECTS", "1");
    expect(allowedRedirect("freshlog://auth")).toBe(true);
    vi.stubEnv("API_ALLOW_EXPO_REDIRECTS", "");
    expect(allowedRedirect("freshlog://auth")).toBe(true);
  });

  it("refuses exp:// when the setting is anything but exactly 1", () => {
    for (const value of ["0", "true", "yes", "11", " 1", "1 "]) {
      vi.stubEnv("API_ALLOW_EXPO_REDIRECTS", value);
      expect(allowedRedirect("exp://192.168.1.5:8081/--/auth"), `set to "${value}"`).toBe(false);
    }
  });

  it("refuses exp:// when the setting is not there at all", () => {
    vi.stubEnv("API_ALLOW_EXPO_REDIRECTS", undefined);
    expect(allowedRedirect("exp://192.168.1.5:8081/--/auth")).toBe(false);
  });

  it("never allows a web address, whatever the Expo setting is", () => {
    vi.stubEnv("API_ALLOW_EXPO_REDIRECTS", "1");
    expect(allowedRedirect("https://evil.example/auth")).toBe(false);
    expect(allowedRedirect("http://localhost:3000/auth")).toBe(false);
  });

  it("refuses an address that only looks like the app's", () => {
    for (const uri of [
      "",
      "freshlog:",
      "freshlog:auth",
      "freshlog:/auth",
      "xfreshlog://auth",
      "freshlog.evil.example://auth",
      "https://freshlog://auth",
      "https://evil.example/?next=freshlog://auth",
      "//evil.example/freshlog://auth",
      "javascript:alert(1)//freshlog://auth",
    ]) {
      expect(allowedRedirect(uri), uri).toBe(false);
    }
  });

  it("refuses an address with a space, a line break or any other invisible character in it", () => {
    vi.stubEnv("API_ALLOW_EXPO_REDIRECTS", "1");
    for (const uri of [
      " freshlog://auth",
      "freshlog://auth ",
      "freshlog://au th",
      "freshlog://auth\n",
      "freshlog://auth\r\nSet-Cookie: a=b",
      "freshlog://auth\t",
      "freshlog://auth\u0000",
      "freshlog://auth\u007f",
      "freshlog://auth​",
      "exp://192.168.1.5:8081/--/auth\r\nX: y",
    ]) {
      expect(allowedRedirect(uri), JSON.stringify(uri)).toBe(false);
    }
  });

  it("refuses an address that is not plain ASCII, which a header cannot carry", () => {
    for (const uri of ["freshlog://auth/é", "freshlog://auth/€", "freshlog://auth/😀"]) {
      expect(allowedRedirect(uri), uri).toBe(false);
    }
  });

  it("allows the app's address with a path, a query or an encoded character", () => {
    for (const uri of ["freshlog://auth/done", "freshlog://auth?from=signin", "freshlog://auth/a%20b"]) {
      expect(allowedRedirect(uri), uri).toBe(true);
    }
  });
});

describe("S256_CHALLENGE", () => {
  it("accepts a PKCE challenge, which is 43 base64url characters", () => {
    expect(S256_CHALLENGE.test(CHALLENGE)).toBe(true);
    expect(CHALLENGE).toHaveLength(43);
    expect(S256_CHALLENGE.test("A".repeat(43))).toBe(true);
    expect(S256_CHALLENGE.test("-_".repeat(21) + "0")).toBe(true);
  });

  it("refuses one that is too short or too long", () => {
    expect(S256_CHALLENGE.test("")).toBe(false);
    expect(S256_CHALLENGE.test("short")).toBe(false);
    expect(S256_CHALLENGE.test(CHALLENGE.slice(1))).toBe(false);
    expect(S256_CHALLENGE.test(CHALLENGE + "A")).toBe(false);
  });

  it("refuses plain base64 and padding, which base64url leaves out", () => {
    expect(S256_CHALLENGE.test(CHALLENGE.slice(0, 42) + "+")).toBe(false);
    expect(S256_CHALLENGE.test(CHALLENGE.slice(0, 42) + "/")).toBe(false);
    expect(S256_CHALLENGE.test(CHALLENGE.slice(0, 42) + "=")).toBe(false);
  });

  it("refuses a challenge with something trailing, a line break included", () => {
    expect(S256_CHALLENGE.test(CHALLENGE + "\n")).toBe(false);
    expect(S256_CHALLENGE.test("\n" + CHALLENGE)).toBe(false);
    expect(S256_CHALLENGE.test(CHALLENGE.slice(0, 42) + "\n")).toBe(false);
  });
});
