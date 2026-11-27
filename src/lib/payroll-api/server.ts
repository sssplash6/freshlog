import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { paidFrom, rateOn, contractRates } from "@/lib/pay";
import { everyMentorPay, mentorPay } from "@/lib/pay-data";
import type { HoursResponse, MentorsResponse, MentorSummary } from "@/lib/payroll-api/contract";
import { prisma } from "@/lib/prisma";
import { toDateInputValue } from "@/lib/format";
import { programToday } from "@/lib/when";

/**
 * The server half of the payroll contract (`contract.ts` beside this file):
 * who may call it, and what it answers. The routes under
 * `app/api/payroll/v1` are a line each around these.
 *
 * NOT the freshlog app's `/api/v1`. Nobody signs in here: FreshWeek's server
 * calls with one shared secret, PAYROLL_API_SECRET, and the answer covers every
 * mentor with a rate. So the secret is the whole gate, and it is checked on
 * every call before anything is read.
 */

/** Every answer from here: JSON, never cached anywhere. */
export function payrollJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Null when the call carries the secret; otherwise the refusal to send.
 *
 * Unset (or blank) → 503 for everyone, so a deployment that was never given a
 * secret answers nobody rather than everybody. Wrong or missing → 401. The
 * comparison is of two SHA-256 digests in constant time: equal lengths, so
 * `timingSafeEqual` cannot throw, and the time taken says nothing about how
 * much of the secret was right.
 */
export function payrollRefusal(request: Request): Response | null {
  const secret = process.env.PAYROLL_API_SECRET;
  if (!secret) {
    return payrollJson({ error: "PAYROLL_API_SECRET is not configured on this deployment." }, 503);
  }
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  const given = createHash("sha256").update(match ? match[1] : "").digest();
  const expected = createHash("sha256").update(secret).digest();
  if (!match || !timingSafeEqual(given, expected)) {
    return payrollJson({ error: "Unauthorized." }, 401);
  }
  return null;
}

/** GET /api/payroll/v1/hours?email= — one person, by email, any case. */
export async function hoursResponse(email: string, now: Date = new Date()): Promise<HoursResponse> {
  const user = await prisma.user.findUnique({
    // Stored lowercase: sign-in and every form lowercase before they write.
    where: { email: email.trim().toLowerCase() },
    select: { id: true, name: true, email: true },
  });
  if (!user) return { version: 1, generatedAt: now.toISOString(), mentor: null };

  const { rates, payable } = await mentorPay(user.id);
  return {
    version: 1,
    generatedAt: now.toISOString(),
    mentor: {
      email: user.email.toLowerCase(),
      name: user.name,
      rates: contractRates(rates),
      sessions: payable,
    },
  };
}

/** GET /api/payroll/v1/mentors — everybody with a rate. */
export async function mentorsResponse(now: Date = new Date()): Promise<MentorsResponse> {
  const today = new Date(`${programToday(now)}T00:00:00.000Z`);
  const mentors: MentorSummary[] = [];
  for (const { mentor, rates, payable } of (await everyMentorPay()).values()) {
    mentors.push({
      email: mentor.email.toLowerCase(),
      name: mentor.name,
      // A mentor whose first rate starts after today has none in force yet:
      // 0, with `paidFrom` saying when pay starts.
      centsPerHour: rateOn(rates, today)?.centsPerHour ?? 0,
      paidFrom: toDateInputValue(paidFrom(rates)!),
      payableMinutes: payable.reduce((n, s) => n + s.minutes, 0),
    });
  }
  mentors.sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  return { version: 1, generatedAt: now.toISOString(), mentors };
}
