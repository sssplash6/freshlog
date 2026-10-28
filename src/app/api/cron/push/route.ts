import type { NextRequest } from "next/server";

import { expoSend, sweepPushes } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Scheduled entry point for the app's pushes, hit every minute by the Render
 * cron job (see render.yaml). Guarded by CRON_SECRET, as the other crons are:
 * it is a public URL, and the job sends the secret as a bearer token.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET is not configured on this deployment." },
      { status: 503 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const result = await sweepPushes(new Date(), expoSend);
  return Response.json({ ok: true, ...result });
}
