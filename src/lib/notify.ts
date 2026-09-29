import "server-only";

import { prisma } from "@/lib/prisma";
import { CATEGORY_OF, type NotificationType } from "@/lib/constants";

/**
 * The one way notifications get written. Producers used to call
 * `tx.notification.create` by hand, which is why some events told nobody and
 * none of them carried a destination: each new notice was a fresh chance to
 * forget a recipient or a link.
 *
 * Accepts either the client or a transaction client, so a notification can be
 * written inside the same transaction as the thing it describes.
 */

/** The subset of PrismaClient this module needs, so a tx satisfies it too. */
type Writer = {
  notification: {
    createMany: (args: {
      data: {
        userId: string;
        type: string;
        category: string;
        message: string;
        href?: string | null;
        actorId?: string | null;
      }[];
    }) => Promise<unknown>;
  };
};

type Notice = {
  /** Recipients. Duplicates and the actor themself are dropped. */
  to: string[];
  type: NotificationType;
  message: string;
  /** Where this is ABOUT — the page a reader would go to next. */
  href?: string;
  /** Who did it, when it was a person. */
  actorId?: string;
};

/**
 * Write one notice to many recipients. Nobody is ever notified about their own
 * action: an admin who assigns a goal does not need telling, and it would push
 * genuine news down the list.
 */
export async function notify(db: Writer, notice: Notice): Promise<void> {
  const recipients = [...new Set(notice.to)].filter(
    (id) => id && id !== notice.actorId
  );
  if (recipients.length === 0) return;

  await db.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: notice.type,
      // Derived here, from the one map, so a new type cannot be added without
      // being placed in a category — which is what the feed filters on and
      // what a person's email preferences switch.
      category: CATEGORY_OF[notice.type],
      message: notice.message,
      href: notice.href ?? null,
      actorId: notice.actorId ?? null,
    })),
  });
}

/**
 * The staff who should hear about something that happened in ONE program: the
 * people who administer it, plus the platform admins.
 *
 * This replaced `adminIds()`, which sent every session in every program to all
 * ten admins — nine of whom are mentors, and most of whom have nothing to do
 * with the program it happened in. A notification that always arrives is one
 * nobody reads, and it was the loudest thing in the app.
 *
 * A query rather than a cached list, so somebody granted a program this
 * morning starts hearing about it this afternoon. Dual-role admins are
 * included: an admin-mentor logging their own session is filtered out by
 * `notify` as the actor anyway.
 */
export async function staffIdsFor(programId: string): Promise<string[]> {
  const staff = await prisma.user.findMany({
    where: {
      OR: [
        { platformAdmin: true },
        { staffGrants: { some: { programId, role: "ADMIN" } } },
      ],
    },
    select: { id: true },
  });
  return staff.map((s) => s.id);
}

/**
 * Canonical destinations, so producers don't hand-build path strings.
 *
 * A notice names a SUBJECT; it does not name a role's view of one. Until now it
 * had to: `/admin/students/x` and `/mentor/students/x` were the same student
 * twice, so the producer of a notice had to guess which of the two each reader
 * was entitled to, and one session logged sent admins to one address and
 * mentors to another. Whoever was handed the wrong one was bounced to their own
 * home by the role gate, having been told something happened and not where.
 *
 * `/students/x` moves that decision to the only place that can make it — the
 * read, where the reader is known (src/app/students/[id]/page.tsx).
 *
 * The member NAMES still say admin/mentor. They are what thirty producers
 * spell, and renaming them is a diff across six action modules that says
 * nothing this comment doesn't; the commit that takes the last role-scoped
 * student page down renames them with its call sites.
 */
const studentSubject = (studentProfileId: string) =>
  `/students/${studentProfileId}`;

export const notificationHref = {
  adminStudent: studentSubject,
  mentorStudent: studentSubject,
  // Not role-scoped duplicates: these are the reader's OWN home, and only ever
  // sent to someone who lives there.
  studentHome: () => "/student",
  mentorHome: () => "/mentor",
  // The ledger becomes `/sessions` in the commit that builds it. It keeps the
  // old address until then rather than the new one, because an address that
  // does not resolve yet is worse in a stored row than an address that moved:
  // the row outlives the commit. No producer calls this one today.
  mentorSessions: () => "/mentor/sessions",
  adminProgram: (programId: string) => `/programs/${programId}`,
};

/**
 * What an href STORED on an old row means now.
 *
 * Rows are never rewritten — a notification is a record of what was said at the
 * time, and editing its link edits history. So the translation happens on the
 * way out, in /n/[id]: an admin address written in July resolves to the
 * role-neutral one and the reader's own entitlement takes it from there.
 *
 * Anything unrecognised passes through untouched, which is the safe direction:
 * every address these ever held still resolves.
 */
const MOVED_SUBJECTS: [RegExp, string][] = [
  [/^\/(?:admin|mentor)\/students\/([^/?#]+)$/, "/students/$1"],
  [/^\/admin\/programs\/([^/?#]+)$/, "/programs/$1"],
];

export function neutralHref(stored: string): string {
  for (const [was, now] of MOVED_SUBJECTS) {
    if (was.test(stored)) return stored.replace(was, now);
  }
  return stored;
}
