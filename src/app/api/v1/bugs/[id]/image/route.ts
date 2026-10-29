import { inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { bugReportFor } from "@/lib/bug-queries";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * A report's screenshot, for the app: the website's
 * /api/bug-report/:id/image, behind the proxy's cookie check, served under the
 * bearer instead. A screenshot can show anything on somebody's screen, so the
 * report is asked first (`bugReportFor`): somebody else's, one with no
 * picture and none at all are the same 404. The same headers as the website's.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { id } = await params;
  const report = await bugReportFor(user, id);
  const image = report?.hasImage
    ? await prisma.bugReportImage.findUnique({ where: { reportId: id }, select: { bytes: true, mimeType: true } })
    : null;
  if (!image) return refused("Not found.", 404);
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
