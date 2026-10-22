/**
 * The contract between freshform's /api/v1 and the freshlog app: the body of
 * every request and every answer the API has, in one file.
 *
 * The app keeps a verbatim copy (its src/api/types.ts, refreshed by
 * `npm run sync-contract`), so this file imports nothing. Change a shape here
 * and the copy has to change with it: nothing fails when the two drift, a phone
 * just reads a field that is not there.
 *
 * Dates are ISO 8601 strings, which is all JSON can carry.
 */

/** A part of the app a person may use. */
export type ApiRole = "student" | "mentor" | "admin";

/**
 * What `MeResponse.roles[0]` still needs before its home works, decided the way
 * the website decides where to send someone:
 *
 * - `student-profile`: no student record yet, no name, or no Telegram username
 * - `mentor-name`: no name
 * - `pending-approval`: registered, and staff have not approved the account yet
 * - `unassigned`: a mentor no program has taken on yet
 * - `no-access`: no role at all, so there is no home to open
 *
 * `null` when it needs nothing, and always when `roles[0]` is "admin": a person
 * whose first role is admin gets `null` whatever their status or name. So
 * `null` does not mean the account is ACTIVE, and the app must read
 * `MeResponse.status` too.
 */
export type Onboarding = "student-profile" | "mentor-name" | "pending-approval" | "unassigned" | "no-access" | null;

/**
 * `GET /api/v1/me`: who is signed in, which parts of the app they may use, and
 * what they still have to set up.
 *
 * The one endpoint, besides sign-in, that answers someone who is not ACTIVE
 * yet. That is how a pending student finds out what they are waiting for.
 */
export type MeResponse = {
  /** `User.id`. */
  id: string;
  /** `StudentProfile.id`, which is how a student is addressed; null for anyone without a student record. */
  studentProfileId: string | null;
  name: string | null;
  email: string;
  /**
   * PENDING is a student nobody has approved. UNASSIGNED is a mentor no program
   * has taken on. Everything outside /me and sign-in refuses both with a 403
   * whose `code` is "inactive".
   */
  status: "ACTIVE" | "PENDING" | "UNASSIGNED";
  /** Ordered; `roles[0]` is the home. Empty when the person has no role at all. */
  roles: ApiRole[];
  platformAdmin: boolean;
  /**
   * "/api/avatar/<id>?v=<ms>"; null when there is no picture. The app cannot
   * fetch it yet: /api/avatar stays behind the website's cookie check until
   * Phase 6, so a request that carries only the bearer is sent to /login.
   */
  avatarPath: string | null;
  /** Unread notifications. */
  unread: number;
  /** What `roles[0]` still needs before its home works. */
  onboarding: Onboarding;
};

/** `POST /api/v1/auth/token`: the one-time code the sign-in redirect carried, with the proof it is ours. */
export type TokenRequest = {
  code: string;
  /** The PKCE verifier whose S256 challenge the sign-in started with. */
  code_verifier: string;
  /** The redirect the sign-in started with, unchanged. */
  redirect_uri: string;
  /** What to call this phone. */
  device_name?: string;
};

/** The bearer token, which is shown once, and the time it expires if it goes unused. */
export type TokenResponse = { token: string; expiresAt: string };

/** One row of `GET /api/v1/auth/dev`: an account a developer may sign in as on a local server. */
export type SampleAccount = { email: string; name: string | null; role: string; status: string };

/**
 * The body of every refusal. `error` is in words the app can show. `field`
 * names the input that is wrong. `code` is for an answer the app acts on rather
 * than shows: "unauthenticated" (no valid token, so sign out) and "inactive"
 * (the account is not ACTIVE yet).
 */
export type ApiRefusal = { ok: false; error: string; field?: string; code?: string };
