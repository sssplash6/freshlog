import "server-only";

import { after } from "next/server";

import { isGroupEmail } from "@/lib/groups";

/**
 * The one way mail leaves this app.
 *
 * Resend over plain `fetch` rather than their SDK: the API is one POST, and a
 * native call keeps a package out of the lockfile — which matters here because
 * Render installs with `npm install` on Linux from a macOS-generated lockfile.
 * Swapping provider means rewriting `deliver` and nothing else.
 *
 * NEVER call this from inside a `prisma.$transaction`. Network I/O would hold
 * SQLite's single write lock open, and a transaction that later rolls back would
 * already have sent the mail. Everything here runs from the weekly cron, after
 * its reads are done.
 */

export type Mail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Put in List-Unsubscribe, so a mail client can offer one-click opt-out. */
  unsubscribeUrl?: string;
};

export type SendResult =
  | { ok: true; skipped?: "dry-run" }
  | { ok: false; error: string };

const ENDPOINT = "https://api.resend.com/emails";

/**
 * Where links in an email should point. NEXTAUTH_URL is already set on the web
 * service and is the address people actually sign in through, so it is the
 * honest base; APP_URL is the cron service's name for the same thing.
 */
export function appUrl(): string {
  const raw = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "";
  return raw.replace(/\/+$/, "");
}

/**
 * Whether real mail can go out. Missing configuration is NOT an error: the
 * digest still runs, composes, and logs what it would have sent, so the feature
 * can be built and reviewed before a domain is verified. It flips to live the
 * moment the two variables are set, with no code change.
 */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

async function deliver(mail: Mail): Promise<SendResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
  };

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(mail.unsubscribeUrl
        ? {
            headers: {
              "List-Unsubscribe": `<${mail.unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
        : {}),
    }),
  });

  if (response.ok) return { ok: true };

  // Read the body for the reason — Resend explains rejections there, and a bare
  // status code is not enough to debug a bounced domain.
  const detail = await response.text().catch(() => "");
  return {
    ok: false,
    error: `Resend responded ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
  };
}

/** One mail, with a single retry when Resend rate-limits or briefly fails. */
export async function sendEmail(mail: Mail): Promise<SendResult> {
  // A group has no inbox (see lib/groups.ts).
  if (isGroupEmail(mail.to)) return { ok: true, skipped: "dry-run" };
  if (!emailConfigured()) {
    console.log(
      `[email:dry-run] would send to ${mail.to} — ${JSON.stringify(mail.subject)}`
    );
    return { ok: true, skipped: "dry-run" };
  }

  const first = await deliver(mail).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : "fetch failed",
  }));
  if (first.ok) return first;

  // 429 is the common one on a burst; 5xx is worth one more try too. Anything
  // else (a bad key, an unverified domain) will fail identically on a retry.
  if (!/ responded (429|5\d\d)/.test(first.error)) return first;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return deliver(mail).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : "fetch failed",
  }));
}

/**
 * A batch, paced and sequential.
 *
 * Deliberately not parallel: a weekly run is a burst of a few hundred mails and
 * providers rate-limit per second, so firing them at once trades a few seconds
 * of wall clock for a pile of 429s. `onSent` runs after each success, which is
 * how the caller stamps each recipient as done — so a crash halfway through
 * doesn't re-send to everyone who already received theirs.
 */
export async function sendAll(
  mails: Mail[],
  onSent?: (mail: Mail, result: SendResult) => Promise<void>
): Promise<{ sent: number; failed: number; errors: string[] }> {
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  const live = emailConfigured();

  for (const mail of mails) {
    const result = await sendEmail(mail);
    if (result.ok) {
      sent += 1;
      if (onSent) await onSent(mail, result);
    } else {
      failed += 1;
      // Keep a bounded number: a broken key fails every single send, and a log
      // line per recipient buries whatever else the run had to say.
      if (errors.length < 5) errors.push(`${mail.to}: ${result.error}`);
    }
    // ~2/s, comfortably inside Resend's limit. Pointless in dry-run.
    if (live) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return { sent, failed, errors };
}

/**
 * Queue a batch to go out AFTER the response has.
 *
 * Live sends are paced ~2/s (see `sendAll`), so twenty rows handed to `await`
 * would hold a form submission open for ten seconds. `after` lets the person
 * who pressed the button get their answer while the mail drains behind it.
 *
 * Callers queue only once their transaction has committed — never from inside
 * one: a rollback cannot recall an email, and the network I/O would hold
 * SQLite's single write lock open while it waited.
 */
export function queueEmails(tag: string, mails: Mail[]): void {
  if (mails.length === 0) return;
  after(async () => {
    const { sent, failed, errors } = await sendAll(mails);
    if (failed > 0) {
      console.error(`[email:${tag}] ${sent} sent, ${failed} failed — ${errors.join("; ")}`);
    } else if (sent > 0 && emailConfigured()) {
      console.log(`[email:${tag}] ${sent} email${sent === 1 ? "" : "s"} sent`);
    }
  });
}
