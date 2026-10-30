import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/dal";
import { neutralHref } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

// Reads the session and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Only in-app paths are followed. The column is written by our own producers,
 * but a redirect target read from the database is exactly the field not to
 * trust: `//evil.example` and `/\evil.example` are both protocol-relative to a
 * browser and would send a signed-in reader off the site on a click.
 */
function inAppPath(href: string | null): string | null {
  if (!href || !href.startsWith("/")) return null;
  if (href.startsWith("//") || href.startsWith("/\\")) return null;
  return href;
}

/**
 * A RELATIVE Location, and 302 rather than Next's usual 307/308.
 *
 * Relative because the alternative is rebuilding an absolute URL from
 * `request.url`, which behind Render's proxy carries the internal http origin —
 * every notification click would step out of https on the way. A relative
 * reference is legal (RFC 9110 §10.2.2) and the browser resolves it against the
 * address it actually asked for.
 *
 * 302 because the destination depends on the row and on who is reading: 308
 * invites the browser to cache it forever, and the next reader of the same link
 * is a different person going somewhere else.
 */
function found(path: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: path, "Cache-Control": "no-store" },
  });
}

/**
 * Open notification <id>: mark it read, then send the reader where it points.
 *
 * This exists so a feed row can be a real anchor. As a form button it could not
 * be middle-clicked, ⌘-clicked or previewed in the status bar, and "open this
 * in a tab and keep reading" is the normal way anyone works through a list.
 *
 * It is also what keeps a link written months ago pointing at something. Stored
 * hrefs are never rewritten, so a July row still says `/admin/students/abc`;
 * `neutralHref` turns that into `/students/abc` and the student page decides
 * from there which view this particular reader is entitled to. The same row
 * therefore lands an admin, that student's mentor, and the student herself in
 * three different places, all of them correct.
 *
 * MARKING READ ON A GET is normally the wrong shape, and is right here: the
 * request IS the click that reads the notice, it is idempotent, and it changes
 * nothing else. A prefetch cannot trip it either — these rows are plain
 * anchors, not <Link>.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const viewer = await requireUser();
  const { id } = await params;

  // Scoped by the reader rather than looked up and then checked: a notice that
  // is not yours is not findable here at all, so /n/<someone else's id> can
  // neither mark their row read nor answer differently for an id that exists.
  const notification = await prisma.notification.findFirst({
    where: { id, userId: viewer.id },
    select: { id: true, href: true, read: true },
  });

  if (notification && !notification.read) {
    await prisma.notification.update({
      where: { id: notification.id },
      // The instant too, as "Mark all read" stamps it: it is what lets a feed
      // say which of these are new since somebody last looked.
      data: { read: true, readAt: new Date() },
    });
    // The unread count is drawn in the shell of every page, not just this one.
    revalidatePath("/", "layout");
  }

  // A row that points nowhere — and an id that is not this reader's — land back
  // on the feed. It is where the click came from, and it says nothing about
  // whether the id exists.
  const href = notification ? inAppPath(notification.href) : null;
  return found(href ? neutralHref(href) : "/notifications");
}
