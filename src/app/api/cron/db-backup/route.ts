import type { NextRequest } from "next/server";

import { backupDatabase } from "@/lib/db-backup";

export const dynamic = "force-dynamic";

/**
 * Scheduled entry point for the daily database backup, hit by the Render cron
 * job (see render.yaml). The SQLite file lives on the web service's disk, so
 * the cron can't copy it itself — it calls this and the web service does.
 * Guarded by CRON_SECRET like the other cron endpoints.
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

  try {
    const result = await backupDatabase();
    return Response.json({
      ok: true,
      file: result.file,
      bytes: result.bytes,
      kept: result.kept.length,
      pruned: result.pruned.length,
    });
  } catch (error) {
    // A 500 fails the cron run, which is how a missed backup gets noticed.
    console.error("db-backup failed:", error);
    return Response.json({ ok: false, error: "Backup failed; see the service logs." }, { status: 500 });
  }
}
