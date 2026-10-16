import "server-only";

import { sniffImageType } from "@/lib/avatar";
import {
  BUG_KIND,
  BUG_SHOT_MAX_BYTES,
  BUG_SHOT_MIME_TYPES,
  BUG_SOURCE,
  OPEN_BUG_STATUSES,
} from "@/lib/bugs";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { downloadFile, react } from "@/lib/telegram";
import { triageMessage, type Candidate } from "@/lib/telegram-triage";

/**
 * Turning the team's Telegram group into bug reports and feature requests.
 *
 * Every message the bot can see arrives here once. It is claimed by id first,
 * so Telegram redelivering an update cannot file it twice; then the model reads
 * it (text, voice note and screenshot together, `lib/telegram-triage.ts`) and
 * each thing it reports becomes a card on the board, or a paragraph added to a
 * card already there. Chatter is dropped, and only its ids are kept.
 *
 * A filed message gets a 👀 reaction, which is all the bot ever says in the
 * group unprompted — a reply to every message would bury the conversation it
 * is there to listen to.
 */

/** The parts of a Telegram `Message` this file reads. */
export type TelegramMessageIn = {
  message_id: number;
  chat: { id: number };
  from?: { is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
  date: number;
  text?: string;
  caption?: string;
  media_group_id?: string;
  voice?: { file_id: string; file_size?: number };
  photo?: { file_id: string; file_size?: number; width: number }[];
  document?: { file_id: string; file_size?: number; mime_type?: string };
  reply_to_message?: { message_id: number };
};

export type IntakeOutcome =
  | "ignored" // not ours to read, or nothing in it to read
  | "duplicate" // already claimed by an earlier delivery
  | "chatter" // read, and nothing in it was a report
  | "filed"; // at least one report created or added to

/** Below this, a text message with no attachment and no reply is never a report. */
const MIN_TEXT = 8;
/** How many open items the model is shown as things a message might add to. */
const CANDIDATES = 40;

export function authorLabel(from: TelegramMessageIn["from"]): string {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ");
  if (from?.username) return name ? `${name} (@${from.username})` : `@${from.username}`;
  return name || "Someone in the group";
}

/**
 * The account behind a Telegram username, when a student profile holds it.
 * Telegram usernames are case-insensitive and students type theirs however
 * they like, so the comparison is too.
 */
async function matchAccount(username: string | undefined) {
  if (!username) return null;
  const rows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "StudentProfile"
    WHERE lower("telegramUsername") = lower(${username})
    LIMIT 1`;
  if (!rows[0]) return null;
  return prisma.user.findUnique({
    where: { id: rows[0].userId },
    select: { id: true, role: true },
  });
}

/** The screenshot, if there is one small enough to keep. Photos come in several sizes. */
async function screenshotOf(message: TelegramMessageIn) {
  let fileId: string | null = null;
  if (message.photo?.length) {
    const fits = message.photo
      .filter((p) => (p.file_size ?? 0) <= BUG_SHOT_MAX_BYTES)
      .sort((a, b) => b.width - a.width);
    fileId = fits[0]?.file_id ?? null;
  } else if (
    message.document?.mime_type?.startsWith("image/") &&
    (message.document.file_size ?? 0) <= BUG_SHOT_MAX_BYTES
  ) {
    fileId = message.document.file_id;
  }
  if (!fileId) return null;

  const bytes = await downloadFile(fileId);
  if (!bytes || bytes.length > BUG_SHOT_MAX_BYTES) return null;
  // The real format, never the claimed one: these bytes are served back to
  // browsers by /api/bug-report/[id]/image.
  const mimeType = sniffImageType(bytes);
  if (!mimeType || !BUG_SHOT_MIME_TYPES.includes(mimeType as (typeof BUG_SHOT_MIME_TYPES)[number])) {
    return null;
  }
  return { bytes, mimeType };
}

function candidateOf(
  r: {
    id: string;
    kind: string;
    title: string;
    createdAt: Date;
    telegramAuthor: string | null;
    reporter: { name: string | null } | null;
  },
  now: number
): Candidate {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    author: r.reporter?.name ?? r.telegramAuthor ?? "the app",
    minutesAgo: Math.max(0, Math.round((now - r.createdAt.getTime()) / 60_000)),
  };
}

const candidateSelect = {
  id: true,
  kind: true,
  title: true,
  createdAt: true,
  telegramAuthor: true,
  reporter: { select: { name: true } },
} as const;

/**
 * One message from the group. Throws only when the model could not be asked,
 * and in that case releases its claim first, so Telegram's redelivery gets a
 * second try rather than finding the message already "handled".
 */
export async function takeMessage(message: TelegramMessageIn): Promise<IntakeOutcome> {
  const chatId = String(message.chat.id);
  if (chatId !== process.env.TELEGRAM_CHAT_ID) return "ignored";
  if (message.from?.is_bot) return "ignored";

  const text = (message.text ?? message.caption ?? "").trim();
  const hasMedia = Boolean(message.voice || message.photo?.length || message.document);
  // The rest of an album: its caption, if any, rode on the first photo, which
  // carries the report. A bare second screenshot judged alone is a guess.
  if (message.media_group_id && !text) return "ignored";
  if (!hasMedia && !message.reply_to_message && text.length < MIN_TEXT) return "ignored";
  if (!hasMedia && !text) return "ignored";

  // Claim it. The unique key turns a redelivery into a failed insert.
  let claimId: string;
  try {
    const claim = await prisma.telegramMessage.create({
      data: { chatId, messageId: message.message_id },
      select: { id: true },
    });
    claimId = claim.id;
  } catch {
    return "duplicate";
  }

  const now = Date.now();
  const [account, open, replied] = await Promise.all([
    matchAccount(message.from?.username),
    prisma.bugReport.findMany({
      where: { status: { in: OPEN_BUG_STATUSES } },
      orderBy: { createdAt: "desc" },
      take: CANDIDATES,
      select: candidateSelect,
    }),
    message.reply_to_message
      ? prisma.telegramMessage.findUnique({
          where: {
            chatId_messageId: { chatId, messageId: message.reply_to_message.message_id },
          },
          select: {
            report: {
              select: { ...candidateSelect, status: true },
            },
          },
        })
      : null,
  ]);
  // A reply to something already finished is judged on its own: "still
  // broken" on a Done item is a new report, not a footnote nobody will see.
  const repliesTo =
    replied?.report && (OPEN_BUG_STATUSES as string[]).includes(replied.report.status)
      ? candidateOf(replied.report, now)
      : null;

  const author = authorLabel(message.from);
  let triage;
  let image;
  try {
    const [audio, shot] = await Promise.all([
      message.voice ? downloadFile(message.voice.file_id) : null,
      screenshotOf(message),
    ]);
    image = shot;
    triage = await triageMessage({
      author,
      text,
      audio,
      image,
      repliesTo,
      candidates: open.map((r) => candidateOf(r, now)),
    });
  } catch (error) {
    await prisma.telegramMessage.delete({ where: { id: claimId } });
    throw error;
  }

  if (triage.items.length === 0) return "chatter";

  // The sender's own words, kept beside the model's version of them.
  const original = [text, triage.transcript && `Voice note: ${triage.transcript}`]
    .filter(Boolean)
    .join("\n\n");
  const stamp = formatDate(new Date(message.date * 1000));

  let firstReportId: string | null = null;
  let imageUsed = false;
  for (const item of triage.items) {
    if (item.verdict === "UPDATE") {
      const target = await prisma.bugReport.findUnique({
        where: { id: item.reportId },
        select: { description: true, originalText: true, image: { select: { id: true } } },
      });
      if (!target) continue;
      const attach = image && !imageUsed && !target.image;
      await prisma.bugReport.update({
        where: { id: item.reportId },
        data: {
          description: `${target.description}\n\n${author}, ${stamp}: ${item.description}`,
          originalText: [target.originalText, original].filter(Boolean).join("\n\n---\n\n"),
          ...(attach ? { image: { create: image! } } : {}),
        },
      });
      if (attach) imageUsed = true;
      firstReportId ??= item.reportId;
    } else {
      const attach = image && !imageUsed;
      const created = await prisma.bugReport.create({
        data: {
          reporterId: account?.id ?? null,
          reporterRole: account?.role ?? BUG_SOURCE.TELEGRAM,
          kind: item.verdict === "FEATURE" ? BUG_KIND.FEATURE : BUG_KIND.BUG,
          source: BUG_SOURCE.TELEGRAM,
          title: item.title,
          description: item.description,
          telegramAuthor: author,
          originalText: original || null,
          ...(attach ? { image: { create: image! } } : {}),
        },
        select: { id: true },
      });
      if (attach) imageUsed = true;
      firstReportId ??= created.id;
    }
  }

  if (!firstReportId) return "chatter";

  // The message points at the first thing it filed, which is where a reply to
  // it will be folded in.
  await prisma.telegramMessage.update({
    where: { id: claimId },
    data: { reportId: firstReportId },
  });
  await react(chatId, message.message_id, "👀");
  return "filed";
}
