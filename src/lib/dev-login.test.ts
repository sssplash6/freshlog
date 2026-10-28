import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { devLoginEnabled } from "@/lib/dev-login";

/**
 * The rule that keeps sign-in-as-anybody off every server but a developer's own.
 * It lived in the /api/dev-login route until /api/v1/auth/dev needed the same
 * one. These pin that it came out of the move as it went in: a public deploy
 * that got it wrong would let a stranger in as an admin.
 */
afterEach(() => vi.unstubAllEnvs());

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });
const KEY = "k".repeat(16);

describe("devLoginEnabled", () => {
  it("is off unless DEV_LOGIN=1", () => {
    vi.stubEnv("DEV_LOGIN", "");
    expect(devLoginEnabled(req("http://localhost:3001/x", { host: "localhost:3001" }))).toBe(false);
  });

  it("is on for a localhost request", () => {
    vi.stubEnv("DEV_LOGIN", "1");
    expect(devLoginEnabled(req("http://localhost:3001/x", { host: "localhost:3001" }))).toBe(true);
  });

  it("is off behind a proxy that forwards a public host", () => {
    vi.stubEnv("DEV_LOGIN", "1");
    expect(devLoginEnabled(req("http://localhost:3001/x", { host: "localhost:3001", "x-forwarded-host": "www.freshlog.net" }))).toBe(false);
  });

  it("lets anyone in who carries a 16+ character key", () => {
    vi.stubEnv("DEV_LOGIN", "1");
    vi.stubEnv("DEV_LOGIN_KEY", "k".repeat(16));
    expect(devLoginEnabled(req(`http://192.168.1.5:3001/x?key=${"k".repeat(16)}`, { host: "192.168.1.5:3001" }))).toBe(true);
  });
});

describe("the flag", () => {
  const local = () => req("http://localhost:3001/x", { host: "localhost:3001" });

  it("is off when DEV_LOGIN is not set, which is how every deploy runs", () => {
    vi.stubEnv("DEV_LOGIN", undefined);
    expect(devLoginEnabled(local())).toBe(false);
  });

  it.each(["true", "0"])("is off when DEV_LOGIN is %j: only 1 turns it on", (value) => {
    vi.stubEnv("DEV_LOGIN", value);
    expect(devLoginEnabled(local())).toBe(false);
  });

  it("is not turned on by a key when DEV_LOGIN is not 1", () => {
    vi.stubEnv("DEV_LOGIN", "");
    vi.stubEnv("DEV_LOGIN_KEY", KEY);
    expect(devLoginEnabled(req(`http://192.168.1.5:3001/x?key=${KEY}`, { host: "192.168.1.5:3001" }))).toBe(false);
  });
});

describe("which hosts count as this machine", () => {
  beforeEach(() => vi.stubEnv("DEV_LOGIN", "1"));

  it.each(["localhost", "localhost:3001", "127.0.0.1:3001", "[::1]:3001"])("%s is", (host) => {
    expect(devLoginEnabled(req("http://example.test/x", { host }))).toBe(true);
  });

  it.each(["192.168.1.5:3001", "www.freshlog.net", "localhost.evil.test"])("%s is not", (host) => {
    expect(devLoginEnabled(req("http://example.test/x", { host }))).toBe(false);
  });

  it("is read from the URL when the request names none", () => {
    expect(devLoginEnabled(req("http://localhost:3001/x"))).toBe(true);
    expect(devLoginEnabled(req("http://192.168.1.5:3001/x"))).toBe(false);
  });
});

describe("the key that shares a local server through a tunnel", () => {
  beforeEach(() => vi.stubEnv("DEV_LOGIN", "1"));

  it("lets a request in from anywhere, through the tunnel's proxy too", () => {
    vi.stubEnv("DEV_LOGIN_KEY", KEY);
    const host = "abc.trycloudflare.com";
    expect(devLoginEnabled(req(`http://${host}/x?key=${KEY}`, { host, "x-forwarded-host": host }))).toBe(true);
    expect(devLoginEnabled(req(`http://${host}/x`, { host, "x-forwarded-host": host }))).toBe(false);
  });

  it.each(["j".repeat(16), "k", "k".repeat(15), "k".repeat(17)])(
    "turns away %j, which is not the key, without throwing",
    (given) => {
      vi.stubEnv("DEV_LOGIN_KEY", KEY);
      expect(devLoginEnabled(req(`http://192.168.1.5:3001/x?key=${given}`, { host: "192.168.1.5:3001" }))).toBe(false);
    }
  );

  it("is not a key under 16 characters, though a request carries it exactly", () => {
    vi.stubEnv("DEV_LOGIN_KEY", "k".repeat(15));
    expect(devLoginEnabled(req(`http://192.168.1.5:3001/x?key=${"k".repeat(15)}`, { host: "192.168.1.5:3001" }))).toBe(false);
  });

  it.each(["", KEY])("opens nothing when no key was set and a request sends %j", (given) => {
    vi.stubEnv("DEV_LOGIN_KEY", undefined);
    expect(devLoginEnabled(req(`http://192.168.1.5:3001/x?key=${given}`, { host: "192.168.1.5:3001" }))).toBe(false);
  });
});
