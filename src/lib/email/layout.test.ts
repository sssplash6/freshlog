import { describe, expect, it } from "vitest";

import { BRAND } from "@/lib/brand";
import { renderEmail } from "@/lib/email/layout";

/**
 * The email shell renders as inline-styled HTML built from template literals,
 * which is the one place in this codebase where a wrong expression type is
 * invisible: `"${BRAND.accent}"` inside a `${…}` is a valid string, so
 * TypeScript and the build both pass it and the reader gets
 * `background:${BRAND.accent}` in their inbox. That happened while moving these
 * colours into `lib/brand.ts`, so the shape gets a test.
 */
const base = {
  preheader: "Two hours left this month",
  title: "Your mentoring time",
  intro: "Here is where your time stands.",
  footerNote: "You are getting this because you have mentoring time at Freshman Academy.",
  sections: [
    {
      heading: "With your mentors",
      lines: ["One line of prose."],
      rows: [
        { label: "Valera", value: "3h 30m", muted: "use by 30 September" },
        { label: "Nigel", value: "4h 38m", tone: "urgent" as const },
        { label: "Sharof", value: "0h", tone: "lost" as const },
      ],
    },
  ],
};

describe("renderEmail", () => {
  it("never leaks an unevaluated template expression", () => {
    const { html } = renderEmail({
      ...base,
      cta: { label: "Book a session", url: "https://freshlog.net/student/book" },
      unsubscribeUrl: "https://freshlog.net/unsubscribe?u=1&t=abc",
    });

    // The failure this file exists for.
    expect(html).not.toContain("${");
    expect(html).not.toContain("BRAND.");
  });

  it("names the institute beside the wordmark only when given one, escaped", () => {
    const plain = renderEmail(base);
    expect(plain.html).not.toContain("&middot;");

    const framed = renderEmail({ ...base, place: "Research <Institute>" });
    expect(framed.html).toContain("&middot; Research &lt;Institute&gt;");
    expect(framed.text.startsWith("Research <Institute>\n")).toBe(true);
  });

  it("paints a brand call to action, and an accent one only when asked", () => {
    // Scoped to the anchor: the shell also has a 3px accent rule across its
    // top, so the accent hex is in the document either way.
    const ctaStyle = (html: string) =>
      html.match(/<a href="[^"]*"[^>]*style="([^"]*)"/)?.[1] ?? "";

    expect(
      ctaStyle(
        renderEmail({ ...base, cta: { label: "Open", url: "https://freshlog.net/" } }).html
      )
    ).toContain(`background:${BRAND.brand}`);

    expect(
      ctaStyle(
        renderEmail({
          ...base,
          cta: {
            label: "Book",
            url: "https://freshlog.net/student/book",
            tone: "accent",
          },
        }).html
      )
    ).toContain(`background:${BRAND.accent}`);
  });

  it("colours a row by its tone, using the shared palette", () => {
    const { html } = renderEmail(base);
    expect(html).toContain(BRAND.ink);
    expect(html).toContain(BRAND.warnInk); // the "urgent" row
    expect(html).toContain(BRAND.dangerInk); // the "lost" row
  });

  it("escapes content that arrives from the database", () => {
    const { html, text } = renderEmail({
      ...base,
      title: 'Aziza <script>alert("x")</script> & co',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    // The plain-text twin carries the real characters; it is never parsed.
    expect(text).toContain("&");
  });

  it("produces a plain-text twin carrying the same figures", () => {
    const { text } = renderEmail(base);
    expect(text).toContain("Your mentoring time");
    expect(text).toContain("3h 30m");
    expect(text).toContain("4h 38m");
    expect(text).not.toContain("<td");
  });
});
