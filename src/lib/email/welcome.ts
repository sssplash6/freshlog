import "server-only";

import { renderEmail, type Section } from "@/lib/email/layout";
import { appUrl, queueEmails, type Mail } from "@/lib/email/send";

/**
 * The one-time email a student gets on joining a program. Three doors lead
 * here, but only two read differently to the person opening the mail:
 *
 * - "enrolled": staff registered them (or an imported record finally got a
 *   real address). They have never seen the app, so the mail says what it is
 *   and how to get in.
 * - "approved": they signed themselves up and an admin let them in. They've
 *   already walked through onboarding, so no tour — just what happens next.
 *
 * Transactional and once per person, so no unsubscribe link: there is no
 * series to opt out of, and it must reach imported students who have the
 * weekly digest switched off.
 */

export type WelcomeOccasion = "enrolled" | "approved";

export function welcomeMail({
  to,
  name,
  programLabel,
  occasion,
}: {
  to: string;
  /** Full name when known; the mail just drops the greeting otherwise. */
  name: string | null;
  /** "Program" or "Program / Cohort", matching what the app shows. */
  programLabel: string;
  occasion: WelcomeOccasion;
}): Mail {
  const signIn = `${appUrl()}/login`;

  const intro =
    occasion === "approved"
      ? name
        ? `Hi ${name} — your registration was approved, and you're now part of ${programLabel} at Freshman Academy.`
        : `Your registration was approved, and you're now part of ${programLabel} at Freshman Academy.`
      : name
        ? `Hi ${name} — you've been enrolled in ${programLabel} at Freshman Academy, and your mentoring account is ready.`
        : `You've been enrolled in ${programLabel} at Freshman Academy, and your mentoring account is ready.`;

  const sections: Section[] =
    occasion === "approved"
      ? [
          {
            heading: "What happens next",
            lines: [
              "You'll be notified as mentoring time is allocated to you — then you can book sessions with your mentors.",
              `Sign in any time with Google using this address (${to}).`,
            ],
          },
        ]
      : [
          {
            heading: "What this is",
            lines: [
              "Freshman Academy tracks your mentoring here: which mentors are yours, how many hours you hold with each, and every session you use. Any change to your time notifies you — nothing happens silently.",
            ],
          },
          {
            heading: "Getting started",
            lines: [
              `Sign in with Google using this address (${to}) — there's no password to set up.`,
              "You'll confirm your full name and Telegram username on your first sign-in.",
              "You'll get a notification as soon as mentoring time is allocated to you.",
            ],
          },
        ];

  const subject =
    occasion === "approved"
      ? `You're approved — welcome to ${programLabel}`
      : `Welcome to ${programLabel}`;

  const { html, text } = renderEmail({
    preheader:
      occasion === "approved"
        ? "Your registration was approved. Sign in to see where you stand."
        : "Your mentoring account is ready — sign in with Google to see your mentors and hours.",
    title: `Welcome to ${programLabel}`,
    intro,
    sections,
    // Brand navy, not accent: DESIGN.md keeps orange for hours, and this
    // button is an action, not a balance.
    cta: { label: "Sign in", url: signIn },
    footerNote:
      occasion === "approved"
        ? "You're getting this one-time email because your registration with Freshman Academy was approved."
        : `You're getting this one-time email because you were enrolled in ${programLabel} at Freshman Academy.`,
  });

  return { to, subject, html, text };
}

/** Deliver welcome mail after the response has gone out. */
export function sendWelcomeEmails(mails: Mail[]): void {
  queueEmails("welcome", mails);
}
