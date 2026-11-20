import { Callout } from "@/components/ui/callout";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";

/**
 * The line across the top of an archived student's or mentor's page.
 *
 * It says the two things a reader who lands here needs before anything below
 * it makes sense: this person has left, and nothing about their record was
 * removed — the figures underneath are exactly as they stood. Whoever may
 * restore them is handed the button in the same line.
 */
export async function ArchivedNotice({
  user,
  restore,
}: {
  user: { archivedAt: Date | null; archivedById: string | null };
  /** The Restore control, for a reader who may use it. */
  restore?: React.ReactNode;
}) {
  const by = user.archivedById
    ? await prisma.user.findUnique({
        where: { id: user.archivedById },
        select: { name: true, email: true },
      })
    : null;
  return (
    <Callout tone="info" row action={restore}>
      <span>
        <span className="font-semibold text-ink">
          Archived{user.archivedAt ? ` on ${formatDate(user.archivedAt)}` : ""}
          {by ? ` by ${by.name ?? by.email}` : ""}.
        </span>{" "}
        They can&rsquo;t sign in and are off every list. Their hours and history
        are kept.
      </span>
    </Callout>
  );
}
