import { inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * One person's picture, for the app: the website's /api/avatar/:id, which the
 * proxy keeps behind its cookie check, served under the bearer instead. The
 * same rule (any signed-in reader may see any face: the same faces are chips
 * everywhere) and the same headers: the type sniffed on upload, `nosniff`, and
 * a private, immutable cache, since a new picture is a new `?v=`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const image = await prisma.avatarImage.findUnique({
    where: { userId: id },
    select: { bytes: true, mimeType: true },
  });
  if (!image) return refused("Not found.", 404);
  return new Response(image.bytes, {
    headers: {
      "Content-Type": image.mimeType,
      "Content-Length": String(image.bytes.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
