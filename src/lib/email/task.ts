import "server-only";

import { renderEmail } from "@/lib/email/layout";
import { appUrl, queueEmails, type Mail } from "@/lib/email/send";
import { formatDate } from "@/lib/format";

/**
 * The email a student gets when a mentor sets them a task.
 *
 * The one notice in the app that carries a deadline and asks the reader to go
 * away and do something. A student who does not open the app until Friday is
 * exactly the student the Tuesday task was set for, so this one leaves the
 * feed and lands in an inbox — see `EMAIL_BY_DEFAULT`, which is also what the
 * switch on /settings reads, so turning it off there really turns it off.
 *
 * No `unsubscribeUrl`: that header and its footer link belong to the weekly
 * digest and say "turn off these weekly emails", which this is not. The footer
 * points at Settings instead, where the switch actually is.
 */
export function taskSetMail({
  to,
  studentName,
  mentorName,
  programName,
  title,
  dueOn,
  note,
}: {
  to: string;
  /** Full name when known; the mail drops the greeting otherwise. */
  studentName: string | null;
  mentorName: string;
  programName: string;
  title: string;
  dueOn: Date;
  note: string | null;
}): Mail {
  const due = formatDate(dueOn);
  const intro = studentName
    ? `Hi ${studentName} — ${mentorName} set you a task in ${programName}.`
    : `${mentorName} set you a task in ${programName}.`;

  const { html, text } = renderEmail({
    preheader: `${title} — due ${due}.`,
    title: "A new task",
    intro,
    sections: [
      {
        heading: "The task",
        // The note is the mentor's own words about what they want, so it is a
        // line of the mail rather than a row of the table beside a deadline.
        lines: note ? [note] : [],
        rows: [
          { label: title, value: `Due ${due}` },
          { label: "Set by", value: mentorName, muted: programName },
        ],
      },
    ],
    // Their own home, where the task is and where they mark how far along they
    // are — not a page about the task, which does not exist.
    cta: { label: "Open your tasks", url: `${appUrl()}/student` },
    footerNote:
      "You're getting this because a mentor set you a task at Freshman Academy. You can turn task emails off under Notifications in your settings.",
  });

  return { to, subject: `New task: ${title}`, html, text };
}

/** Deliver task mail after the response has gone out. */
export function sendTaskEmails(mails: Mail[]): void {
  queueEmails("task", mails);
}
