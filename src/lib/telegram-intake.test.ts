import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import type { TriageInput, TriageResult } from "@/lib/telegram-triage";
import { bugReport, PNG_BYTES, program, student } from "@/test/db";

/**
 * The group → board path, with Telegram and the model stubbed: what is filed,
 * what is folded into an existing card, and what is never filed twice.
 */
const model = vi.hoisted(() => ({
  answer: { items: [], transcript: "" } as TriageResult | Error,
  seen: [] as TriageInput[],
}));
const tg = vi.hoisted(() => ({ reactions: [] as number[], files: {} as Record<string, Uint8Array> }));

vi.mock("@/lib/telegram-triage", () => ({
  triageMessage: async (input: TriageInput) => {
    model.seen.push(input);
    if (model.answer instanceof Error) throw model.answer;
    return model.answer;
  },
}));
vi.mock("@/lib/telegram", () => ({
  downloadFile: async (id: string) => tg.files[id] ?? null,
  react: async (_chat: string, messageId: number) => {
    tg.reactions.push(messageId);
  },
}));

const { takeMessage } = await import("@/lib/telegram-intake");

const CHAT = -100123;
let nextId = 1;
const msg = (over: Record<string, unknown> = {}) => ({
  message_id: nextId++,
  chat: { id: CHAT },
  from: { first_name: "Sardor", username: "sardor_dev" },
  date: Date.parse("2026-10-12T09:00:00Z") / 1000,
  text: "The hours total on my page is wrong since yesterday",
  ...over,
});

beforeEach(() => {
  process.env.TELEGRAM_CHAT_ID = String(CHAT);
  model.answer = { items: [], transcript: "" };
  model.seen = [];
  tg.reactions = [];
  tg.files = {};
});

describe("takeMessage", () => {
  it("files a bug, names the sender, keeps their words, and marks the message", async () => {
    model.answer = {
      items: [{ verdict: "BUG", title: "Hours total is wrong", description: "Since yesterday the total is off." }],
      transcript: "",
    };
    const m = msg();

    expect(await takeMessage(m)).toBe("filed");

    const [report] = await prisma.bugReport.findMany();
    expect(report).toMatchObject({
      kind: "BUG",
      source: "TELEGRAM",
      status: "PENDING",
      title: "Hours total is wrong",
      telegramAuthor: "Sardor (@sardor_dev)",
      originalText: m.text,
      reporterId: null,
      reporterRole: "TELEGRAM",
    });
    expect(tg.reactions).toEqual([m.message_id]);
  });

  it("links the report to the student whose profile holds that username, in any case", async () => {
    const p = await program();
    const s = await student({ programId: p.id, name: "Sardor Aliev" });
    await prisma.studentProfile.update({ where: { id: s.id }, data: { telegramUsername: "Sardor_Dev" } });
    model.answer = { items: [{ verdict: "FEATURE", title: "Dark mode", description: "Wants dark mode." }], transcript: "" };

    await takeMessage(msg());

    const [report] = await prisma.bugReport.findMany();
    expect(report.reporterId).toBe(s.userId);
    expect(report.kind).toBe("FEATURE");
  });

  it("files nothing for chatter and keeps none of its words", async () => {
    expect(await takeMessage(msg({ text: "Thanks everyone, see you tomorrow" }))).toBe("chatter");
    expect(await prisma.bugReport.count()).toBe(0);
    const [seen] = await prisma.telegramMessage.findMany();
    expect(seen.reportId).toBeNull();
    expect(tg.reactions).toEqual([]);
  });

  it("files a delivered-twice message once", async () => {
    model.answer = { items: [{ verdict: "BUG", title: "Broken", description: "x" }], transcript: "" };
    const m = msg();
    expect(await takeMessage(m)).toBe("filed");
    expect(await takeMessage(m)).toBe("duplicate");
    expect(await prisma.bugReport.count()).toBe(1);
    expect(model.seen).toHaveLength(1);
  });

  it("releases the message when the model fails, so a redelivery gets another try", async () => {
    model.answer = new Error("OpenRouter answered 503");
    const m = msg();
    await expect(takeMessage(m)).rejects.toThrow("503");
    expect(await prisma.telegramMessage.count()).toBe(0);

    model.answer = { items: [{ verdict: "BUG", title: "Broken", description: "x" }], transcript: "" };
    expect(await takeMessage(m)).toBe("filed");
  });

  it("ignores other chats, bots, and one-word messages without asking the model", async () => {
    expect(await takeMessage(msg({ chat: { id: -999 } }))).toBe("ignored");
    expect(await takeMessage(msg({ from: { is_bot: true, first_name: "Bot" } }))).toBe("ignored");
    expect(await takeMessage(msg({ text: "+1" }))).toBe("ignored");
    expect(await takeMessage(msg({ text: undefined, media_group_id: "g1", photo: [{ file_id: "p", width: 10 }] }))).toBe("ignored");
    expect(model.seen).toHaveLength(0);
  });

  it("folds a reply into the open report its message filed", async () => {
    model.answer = { items: [{ verdict: "BUG", title: "Login loops", description: "Login loops on Safari." }], transcript: "" };
    const first = msg({ text: "Login keeps looping on Safari for me" });
    await takeMessage(first);
    const [report] = await prisma.bugReport.findMany();

    model.answer = { items: [{ verdict: "UPDATE", reportId: report.id, description: "Same on iPhone." }], transcript: "" };
    await takeMessage(msg({ text: "same on my iphone", reply_to_message: { message_id: first.message_id } }));

    expect(model.seen[1].repliesTo?.id).toBe(report.id);
    const after = await prisma.bugReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(after.description).toBe("Login loops on Safari.\n\nSardor (@sardor_dev), October 12: Same on iPhone.");
    expect(await prisma.bugReport.count()).toBe(1);
  });

  it("does not offer a finished report as the thing a reply adds to", async () => {
    const done = await bugReport({ status: "FIXED", resolution: "Fixed it.", resolvedAt: new Date() });
    const old = msg();
    await prisma.telegramMessage.create({ data: { chatId: String(CHAT), messageId: old.message_id, reportId: done.id } });

    await takeMessage(msg({ text: "still broken for me", reply_to_message: { message_id: old.message_id } }));

    expect(model.seen[0].repliesTo).toBeNull();
    expect(model.seen[0].candidates.map((c) => c.id)).not.toContain(done.id);
  });

  it("transcribes a voice note and attaches a screenshot it can verify", async () => {
    tg.files = { voice1: new Uint8Array([1, 2, 3]), photo1: PNG_BYTES };
    model.answer = {
      items: [{ verdict: "BUG", title: "Upload fails", description: "Avatar upload fails." }],
      transcript: "avatar yuklanmayapti",
    };

    await takeMessage(
      msg({
        text: undefined,
        caption: "look",
        voice: { file_id: "voice1" },
        photo: [{ file_id: "photo1", file_size: 1000, width: 800 }],
      })
    );

    expect(model.seen[0].audio).toEqual(new Uint8Array([1, 2, 3]));
    const [report] = await prisma.bugReport.findMany({ include: { image: true } });
    expect(report.originalText).toBe("look\n\nVoice note: avatar yuklanmayapti");
    expect(report.image?.mimeType).toBe("image/png");
  });

  it("files every item in a message that lists several", async () => {
    model.answer = {
      items: [
        { verdict: "BUG", title: "One", description: "1" },
        { verdict: "FEATURE", title: "Two", description: "2" },
      ],
      transcript: "",
    };
    await takeMessage(msg({ text: "1. one is broken 2. please add two" }));
    expect((await prisma.bugReport.findMany()).map((r) => r.kind).sort()).toEqual(["BUG", "FEATURE"]);
  });
});
