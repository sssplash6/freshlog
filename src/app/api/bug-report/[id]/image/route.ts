import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the session and the database on every request; never prerender.
export const dynamic = "force-dynamic";

/**
 * Serve one report's screenshot — to the person who reported it and to platform
 * admins, and to nobody else.
 *
 * Unlike an avatar, a screenshot can show anything on somebody's screen, so
 * "signed in" is not enough. Somebody else's report, a report with no picture
 * and an id that does not exist all answer 404 with the same body, so the route
 * cannot be used to find out which reports exist.
 *
 * The stored type was sniffed from the bytes on upload; `nosniff` and a
 * locked-down CSP keep a browser from second-guessing it into something that
 * runs.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const viewer = await getCurrentUser();
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const image = await prisma.bugReportImage.findUnique({
    where: { reportId: id },
    select: {
      bytes: true,
      mimeType: true,
      report: { select: { reporterId: true } },
    },
  });
  if (!image || (!viewer.platformAdmin && image.report.reporterId !== viewer.id)) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(image.bytes, {
    headers: {
      "Content-Type": image.mimeType,
      "Content-Length": String(image.bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
