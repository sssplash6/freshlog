import "server-only";

import { renderEmail } from "@/lib/email/layout";
import { appUrl, emailConfigured, sendAll, type Mail } from "@/lib/email/send";
import { PLACEHOLDER_EMAIL_DOMAIN, USER_STATUS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

/**
 * "Add your Telegram handle" — the nudge for everyone who signed up before the
 * app insisted on one.
 *
 * The handle is not a nice-to-have field: it is how mentors reach a student
 * between sessions, and `/student` redirects anybody without one back to
 * `/onboarding`, so a student missing it has never finished signing in and
 * cannot be reached in the app at all. **Email is the only channel that gets to
 * this cohort** — an in-app notification would sit behind the very gate they
 * cannot pass.
 *
 * Not a subscription, so no unsubscribe link and no `weeklyDigest` check: this
 * is transactional, like the welcome mail. It asks for one thing and stops
 * being sent the moment they do it, because the audience query is "has no
 * handle".
 *
 * Safe to run twice. Each recipient is stamped as their mail is accepted, so a
 * crash halfway through resumes rather than restarting, and the cooldown below
 * is what stops a weekly schedule turning a nudge into a nag.
 */

/** How long before the same student may be nudged again. */
const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export function telegramReminderMail({
  to,
  name,
}: {
  to: string;
  name: string | null;
}): Mail {
  const { html, text } = renderEmail({
    preheader: "One field, and your mentors can reach you between sessions.",
    title: "Add your Telegram username",
    intro: name
      ? `Hi ${name} — your Freshman Academy account is missing one thing.`
      : "Your Freshman Academy account is missing one thing.",
    sections: [
      {
        heading: "Why it matters",
        lines: [
          "Telegram is how your mentors reach you between sessions — to confirm a meeting, send something you asked for, or tell you they are running late.",
          "Until it is set, your account is not finished and there is no way for anyone here to message you.",
        ],
      },
      {
        heading: "What to do",
        lines: [
          `Sign in with Google using this address (${to}). You will be asked for your name and Telegram username, and that is the whole of it.`,
        ],
      },
    ],
    cta: { label: "Add it now", url: `${appUrl()}/onboarding` },
    footerNote:
      "You're getting this because your Freshman Academy account has no Telegram username yet. Once you add it, we stop asking.",
  });

  return { to, subject: "Add your Telegram username", html, text };
}

/**
 * Everyone still missing a handle, minus the people we cannot or should not
 * mail.
 *
 * PENDING accounts are excluded: they have not been approved, and asking them
 * to finish an account nobody has let them into is a mail that cannot be acted
 * on. Placeholder addresses from the sheet import are excluded because they are
 * RFC-2606 reserved and can never be delivered — a run that "sent" forty of
 * them would report a success that reached nobody.
 */
async function audience(now: Date, force: boolean, only?: string) {
  return prisma.studentProfile.findMany({
    where: {
      telegramUsername: null,
      user: {
        status: { not: USER_STATUS.PENDING },
        NOT: { email: { endsWith: `@${PLACEHOLDER_EMAIL_DOMAIN}` } },
        ...(only ? { email: only.toLowerCase() } : {}),
      },
      ...(force
        ? {}
        : {
            OR: [
              { telegramReminderAt: null },
              { telegramReminderAt: { lt: new Date(now.getTime() - COOLDOWN_MS) } },
            ],
          }),
    },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function sendTelegramReminders({
  only,
  force = false,
  preview = false,
  now = new Date(),
}: {
  /** Send to one address, for a test run against a real inbox. */
  only?: string;
  /** Ignore the cooldown. */
  force?: boolean;
  /** Compose and count, send nothing, stamp nobody. */
  preview?: boolean;
  now?: Date;
} = {}) {
  const students = await audience(now, force, only);
  if (students.length === 0) {
    return { candidates: 0, sent: 0, failed: 0, live: emailConfigured() };
  }

  // Compose everything before sending anything: a mail is network I/O and must
  // never happen with a write in flight.
  const mails = students.map((s) =>
    telegramReminderMail({ to: s.user.email, name: s.user.name })
  );
  const byEmail = new Map(students.map((s) => [s.user.email, s.id]));

  if (preview) {
    return {
      candidates: students.length,
      sent: 0,
      failed: 0,
      live: emailConfigured(),
      preview: mails.slice(0, 1).map((m) => ({ to: m.to, subject: m.subject })),
      recipients: mails.map((m) => m.to),
    };
  }

  const { sent, failed, errors } = await sendAll(mails, async (mail) => {
    const id = byEmail.get(mail.to);
    if (id) {
      await prisma.studentProfile.update({
        where: { id },
        data: { telegramReminderAt: now },
      });
    }
  });

  return {
    candidates: students.length,
    sent,
    failed,
    ...(errors.length > 0 ? { errors } : {}),
    // Stated on every run so a green cron log is never mistaken for delivered
    // mail: with no RESEND_API_KEY this whole thing is a dry run.
    live: emailConfigured(),
  };
}
