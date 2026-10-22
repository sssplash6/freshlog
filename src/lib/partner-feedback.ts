import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { EMAIL_RE, normalizeEmail } from "@/lib/actions/shared";

/**
 * The pass a partner school's student holds after the email step of a public
 * feedback form, and the parsing of what they submit. Pure: no database, no
 * cookies() — the pages and actions own those, so this can be tested alone.
 *
 * The pass is a cookie, not a session. These students have no account here, so
 * the cookie just remembers "this address was on the list a moment ago". It is
 * an HMAC under NEXTAUTH_SECRET (the unsubscribe-link pattern): nothing stored,
 * unforgeable without the secret, and rotating the secret signs everyone out.
 * Whether the partner is still open and the email still listed is checked again
 * on every submit — the pass proves who, never that they are still allowed.
 */

export const PASS_HOURS = 12;

function key(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to sign feedback passes.");
  return secret;
}

/** One cookie per partner, so passing one school's list opens nothing at another. */
export function passCookieName(slug: string): string {
  return `pf_${slug}`;
}

/**
 * The slug is inside the MAC, not only the cookie name: a cookie copied from
 * `pf_khana` to `pf_other` carries a signature made for the wrong slug and is
 * refused. Without it the name would be the only thing keeping partners apart.
 */
function mac(slug: string, email: string, expiresAtMs: number): string {
  return createHmac("sha256", key())
    .update(`partner-feedback:${slug}:${email}:${expiresAtMs}`)
    .digest("base64url");
}

export function signPass(slug: string, email: string, now: Date): { value: string; expires: Date } {
  const expires = new Date(now.getTime() + PASS_HOURS * 3600e3);
  const who = Buffer.from(email).toString("base64url");
  const expiresAtMs = expires.getTime();
  return { value: `${who}.${expiresAtMs}.${mac(slug, email, expiresAtMs)}`, expires };
}

/** The email the pass was issued to, or null for anything that is not a live pass for this partner. */
export function readPass(slug: string, value: string | undefined, now: Date): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [who, exp, given] = parts;
  if (!/^\d+$/.test(exp)) return null;
  const expiresAtMs = Number(exp);
  const email = Buffer.from(who, "base64url").toString();

  const expected = Buffer.from(mac(slug, email, expiresAtMs));
  const actual = Buffer.from(given);
  // Length must match before timingSafeEqual, which throws on a mismatch.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  // Checked after the signature: the expiry is only believable once it is signed.
  if (now.getTime() > expiresAtMs) return null;
  return email;
}

export type FeedbackInput =
  | { kind: "MENTOR"; mentorId: string; rating: number; comment: string }
  | { kind: "SESSION"; sessionNumber: number; name: string; rating: number; comment: string };

type Parsed = { ok: true; value: FeedbackInput } | { ok: false; error: string; field: string };

const COMMENT_MAX = 2000;

function fail(field: string, error: string): Parsed {
  return { ok: false, field, error };
}

/**
 * Shape only. That a mentor is one the partner lists is the action's question —
 * it needs the database — so an unknown id passes here and is refused there.
 */
export function parseFeedback(kind: "MENTOR" | "SESSION", form: FormData): Parsed {
  const text = (name: string) => String(form.get(name) ?? "").trim();

  const mentorId = text("mentorId");
  if (kind === "MENTOR" && !mentorId) return fail("mentorId", "Pick one of the listed mentors.");

  const sessionRaw = text("sessionNumber");
  const sessionNumber = /^\d{1,3}$/.test(sessionRaw) ? Number(sessionRaw) : 0;
  if (kind === "SESSION" && (sessionNumber < 1 || sessionNumber > 999)) {
    return fail("sessionNumber", "Enter the session number.");
  }

  const name = text("name");
  if (kind === "SESSION" && (!name || name.length > 100)) return fail("name", "Enter your name.");

  const ratingRaw = text("rating");
  if (!/^[1-5]$/.test(ratingRaw)) return fail("rating", "Pick a rating from 1 to 5.");
  const rating = Number(ratingRaw);

  const comment = text("comment");
  if (!comment) return fail("comment", "Write your feedback.");
  if (comment.length > COMMENT_MAX) return fail("comment", "Keep it under 2000 characters.");

  return kind === "MENTOR"
    ? { ok: true, value: { kind, mentorId, rating, comment } }
    : { ok: true, value: { kind, sessionNumber, name, rating, comment } };
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The link segment a partner is reachable at, or null when it cannot be one. */
export function normalizeSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase();
  return slug.length >= 2 && slug.length <= 40 && SLUG_RE.test(slug) ? slug : null;
}

/** A pasted allow-list, however messy: split, normalized, de-duplicated, valid apart from invalid. */
export function parseEmailList(raw: string): { emails: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const token of raw.split(/[\s,;]+/)) {
    const email = normalizeEmail(token);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    (EMAIL_RE.test(email) ? emails : invalid).push(email);
  }
  return { emails, invalid };
}
