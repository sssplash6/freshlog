import "server-only";

import { BUG_TITLE_MAX } from "@/lib/bugs";

/**
 * Reading one group message the way a triager would: is it a bug, a feature
 * request, more detail on something already filed, or chatter?
 *
 * Two models, both through OpenRouter on the key dictation already uses:
 *
 *   - GPT-6 Luna does the judging, for text and screenshots. It is about a
 *     seventh of Gemini Flash's price per token, and nearly every message in
 *     the group is text.
 *   - Luna cannot hear, so a voice note is first written out by Gemini 3.8
 *     Flash, the model `lib/dictation.ts` already trusts with Uzbek and Russian
 *     speech. Only messages with a voice note pay for the second call.
 */
const MODEL = "openai/gpt-6-luna";
const HEARING_MODEL = "google/gemini-3.8-flash";

/** A message can list several things; more than this is a document, not a message. */
export const MAX_ITEMS_PER_MESSAGE = 5;

const SYSTEM = `You read messages from a Telegram group where the students, mentors and staff of Freshman Academy report problems with the academy's web platform and ask for new features. People write in English, Uzbek or Russian, often mixed, and also send voice notes and screenshots.

For the message you are given, list what it reports. Each item gets one verdict:

- BUG: something on the platform is broken, wrong, missing data, confusing, or does not work the way the person expected.
- FEATURE: a request for something new, or for the platform to work differently.
- UPDATE: more about one of the OPEN ITEMS listed below — the same problem again, a detail, a screenshot, a page or device, or "same for me" when it is clear which item it means. Give that item's id.

Anything else is not an item: greetings, thanks, jokes, scheduling, questions about lessons or homework, and talk that is not about the platform. A message with no items gets an empty list. When unsure whether something is about the platform at all, leave it out.

If the message replies to an open item, it is far more likely an UPDATE to that item than anything new.

For each BUG or FEATURE write:
- title: in English, under 80 characters, saying what is wrong or what is wanted ("Hours total is off by one on the student page"). No names of people.
- description: in English, what the person said, tidied: steps, the page, the device, what they expected and what happened. Keep their meaning; drop filler. Never add a fact, step, page or cause they did not give. If they were vague, stay vague.

For an UPDATE write the new detail as the description, in English, and leave the title empty.

A voice note arrives already written out, marked VOICE NOTE; treat it as part of the message.

Reply with JSON only, in this shape:
{"items":[{"verdict":"BUG"|"FEATURE"|"UPDATE","reportId":"<id, UPDATE only>","title":"...","description":"..."}]}`;

const HEARING_SYSTEM = `You are given a voice note from a Telegram group where people report problems with a web platform. Write down exactly what was said, in the language it was said in (often Uzbek, Russian or English, sometimes mixed). Do not translate, summarise or correct anything; add only punctuation.

Reply with the transcript and nothing else. If the recording contains no speech, reply with nothing at all.`;

export type Candidate = {
  id: string;
  kind: string;
  title: string;
  author: string;
  minutesAgo: number;
};

export type TriageInput = {
  author: string;
  text: string;
  audio: Uint8Array | null;
  image: { bytes: Uint8Array; mimeType: string } | null;
  /** The open item this message replies to, if it replies to one. */
  repliesTo: Candidate | null;
  /** Open items it might add to, newest first. */
  candidates: Candidate[];
};

export type TriageItem =
  | { verdict: "BUG" | "FEATURE"; title: string; description: string }
  | { verdict: "UPDATE"; reportId: string; description: string };

export type TriageResult = { items: TriageItem[]; transcript: string };

const line = (c: Candidate) =>
  `[${c.id}] ${c.kind === "FEATURE" ? "feature" : "bug"}, from ${c.author}, ${
    c.minutesAgo < 60 ? `${c.minutesAgo} min ago` : `${Math.round(c.minutesAgo / 60)} h ago`
  }: ${c.title}`;

/** The one place the provider is named. */
async function chat(model: string, body: Record<string, unknown>): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, ...body }),
  });
  if (!response.ok) {
    throw new Error(
      `OpenRouter answered ${response.status}: ${(await response.text()).slice(0, 300)}`
    );
  }
  const result = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return (result.choices?.[0]?.message?.content ?? "").trim();
}

/** A Telegram voice note (OGG/Opus), written out word for word. */
async function hear(audio: Uint8Array): Promise<string> {
  return chat(HEARING_MODEL, {
    max_tokens: 2000,
    messages: [
      { role: "system", content: HEARING_SYSTEM },
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { data: Buffer.from(audio).toString("base64"), format: "ogg" },
          },
        ],
      },
    ],
  });
}

async function judge(input: TriageInput, transcript: string): Promise<string> {
  const context = [
    `OPEN ITEMS:\n${input.candidates.length ? input.candidates.map(line).join("\n") : "(none)"}`,
    input.repliesTo ? `This message replies to the open item ${input.repliesTo.id}.` : "",
    `MESSAGE from ${input.author}:\n${input.text || "(no text)"}`,
    transcript ? `VOICE NOTE:\n${transcript}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return chat(MODEL, {
    max_tokens: 3000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: context },
          ...(input.image
            ? [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${input.image.mimeType};base64,${Buffer.from(input.image.bytes).toString("base64")}`,
                  },
                },
              ]
            : []),
        ],
      },
    ],
  });
}

/**
 * The model's answer, checked rather than trusted. An UPDATE naming an id that
 * was not offered is dropped — the model does not get to append to a report it
 * merely guessed the id of — and so is anything without the words it needs.
 */
export function parseTriage(raw: string, offered: Set<string>): TriageItem[] {
  const json = raw.replace(/^```(?:json)?\s*|\s*```$/g, "");
  const parsed = JSON.parse(json) as {
    items?: { verdict?: unknown; reportId?: unknown; title?: unknown; description?: unknown }[];
  };

  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const items: TriageItem[] = [];
  for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
    const description = text(item.description);
    if (item.verdict === "UPDATE") {
      const reportId = text(item.reportId);
      if (offered.has(reportId) && description) {
        items.push({ verdict: "UPDATE", reportId, description });
      }
    } else if (item.verdict === "BUG" || item.verdict === "FEATURE") {
      const title = text(item.title).slice(0, BUG_TITLE_MAX);
      if (title) items.push({ verdict: item.verdict, title, description: description || title });
    }
  }
  return items.slice(0, MAX_ITEMS_PER_MESSAGE);
}

/** Throws when the model cannot be reached or answers with something unreadable. */
export async function triageMessage(input: TriageInput): Promise<TriageResult> {
  const offered = new Set(input.candidates.map((c) => c.id));
  if (input.repliesTo) offered.add(input.repliesTo.id);
  const transcript = input.audio ? await hear(input.audio) : "";
  return { items: parseTriage(await judge(input, transcript), offered), transcript };
}
