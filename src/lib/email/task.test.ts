import { describe, expect, it } from "vitest";

import { formatDate } from "@/lib/format";
import { taskSetMail } from "@/lib/email/task";

/**
 * The task email is the one piece of mail a mentor's own action sends, so the
 * facts a student needs to act on it — what, by when, and from whom — are
 * asserted here rather than left to a reading of the template. Both twins:
 * a plain-text view that dropped the deadline would be a different email.
 */
const base = {
  to: "khabiba@example.test",
  studentName: "Khabiba",
  mentorName: "Umid",
  programName: "Master's Program",
  title: "Rewrite the personal statement",
  dueOn: new Date("2026-09-25T00:00:00.000Z"),
  note: "Focus on the opening paragraph.",
};

describe("taskSetMail", () => {
  it("names the task in the subject", () => {
    expect(taskSetMail(base).subject).toBe("New task: Rewrite the personal statement");
  });

  it("carries the deadline, the mentor and the note in both twins", () => {
    const mail = taskSetMail(base);
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain("Rewrite the personal statement");
      // The app's own date format, not a second spelling of one: a mail that
      // wrote dates its own way would disagree with the row it is about.
      expect(body).toContain(formatDate(base.dueOn));
      expect(body).toContain("Umid");
      expect(body).toContain("Master's Program");
      expect(body).toContain("Focus on the opening paragraph.");
    }
  });

  it("greets a student whose name is known, and no one otherwise", () => {
    expect(taskSetMail(base).text).toContain("Hi Khabiba —");
    expect(taskSetMail({ ...base, studentName: null }).text).toContain(
      "Umid set you a task in Master's Program."
    );
  });

  it("offers no weekly unsubscribe — it is not the digest", () => {
    const mail = taskSetMail(base);
    expect(mail.unsubscribeUrl).toBeUndefined();
    expect(mail.html).not.toContain("Turn off these weekly emails");
    expect(mail.text).toContain("turn task emails off");
  });
});
