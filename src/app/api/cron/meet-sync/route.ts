import type { NextRequest } from "next/server";

import { syncMeetDrafts } from "@/lib/meet-sync";

export const dynamic = "force-dynamic";

/**
 * Scheduled entry point for the Google Meet drafts, hit every ten minutes by
 * the Render cron job (see render.yaml). Guarded by CRON_SECRET, like the jobs
 * next door.
 *
 * `configured: false` in the response means the Google variables are not set
 * on this deployment, so the run read nobody — a green cron log is never
 * mistaken for a working sync.
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

  const result = await syncMeetDrafts();
  return Response.json({ ok: true, ...result });
}
