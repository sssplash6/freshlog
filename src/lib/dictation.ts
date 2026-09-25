import "server-only";

/**
 * Dictated session notes: a mentor says the note out loud, and gets back
 * written English they can edit before saving.
 *
 * ONE call, not two. The first build of this transcribed with Azure's
 * MAI-Transcribe-2 and then had a second model fix the grammar, which is the
 * obvious shape — and it was wrong. A model that hears audio and writes text
 * can do both at once, for less money, on one key: no Azure subscription, no
 * region that has to be one of six, no resource to create before anybody can
 * try the feature. The tidying is a sentence in the prompt rather than a
 * second network call that can fail on its own.
 *
 * Nothing here is stored. The audio is held in memory for the length of one
 * request and discarded; the text goes back to the browser and only reaches
 * the database if the mentor submits the form they were already filling in.
 * That is the whole reason this feature is cheap, both in money and in the
 * questions it raises: there is no recording of a student anywhere.
 *
 * WHY DICTATION AND NOT THE MEETING. Recording the whole session was the first
 * plan. It costs about thirty times as much, needs the student's consent, hits
 * the API's two-hour ceiling, cannot label who spoke, and asks a model to
 * guess which four of seventy minutes mattered. The mentor already knows which
 * four. Forty-five seconds of them saying so is a better note and a smaller
 * machine.
 */

/** Audio the browser is allowed to send. Speech, not a recording of a room. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/**
 * Hears audio, writes text, costs about a tenth of a cent a note.
 *
 * Reached through OpenRouter, whose API is OpenAI-shaped. Swapping provider or
 * model means rewriting `ask` and nothing else — the same arrangement
 * `deliver` has in lib/email/send.ts, and for the same reason.
 */
const MODEL = "google/gemini-3.8-flash";

/**
 * What the model is told.
 *
 * The third paragraph is the one that matters. "Refine" is the operation most
 * likely to invent — to smooth a hedge into a commitment, or turn "maybe we
 * look at essays" into "we will review her essays on Thursday". A session note
 * is read back during a dispute (`Session.studentAnswer`), so a fluent
 * sentence nobody said is the expensive kind of wrong. The mentor proofreads
 * this before saving, and the invented detail that reads well is precisely the
 * one they will skim past.
 */
const SYSTEM = `You are given a voice recording of a mentor describing a teaching session they have just finished. Write out what they said, as a session note in written English.

Fix grammar, spelling and punctuation. Drop filler words, false starts and repetition. Keep the mentor's own sentences, their own words and roughly their own length: this is their note tidied up, not a summary and not a rewrite.

Never add a fact, a name, a date, a number or a next step that was not said. If something was left vague, leave it vague rather than guessing what was meant.

House vocabulary: never write "budgeted". A planned piece of work is an agenda item, never a "task". Write ratios with a slash.

Reply with the note and nothing else. No preamble, no quotation marks, no markdown. If the recording contains no speech, reply with nothing at all.`;

/**
 * The same rules for a student's notes on a practice interview with a
 * classmate. Everything that makes the session prompt careful applies here —
 * the student proofreads, and an invented judgement of somebody else's answer
 * is the expensive kind of wrong — only the speaker and the subject change.
 */
const INTERVIEW_SYSTEM = `You are given a voice recording of a student describing a practice interview they have just done with a classmate. Write out what they said, as interview notes in written English.

Fix grammar, spelling and punctuation. Drop filler words, false starts and repetition. Keep the student's own sentences, their own words and roughly their own length: these are their notes tidied up, not a summary and not a rewrite.

Never add a fact, a name, a date, a number, a judgement or a next step that was not said. If something was left vague, leave it vague rather than guessing what was meant.

Reply with the notes and nothing else. No preamble, no quotation marks, no markdown. If the recording contains no speech, reply with nothing at all.`;

/** What is being dictated, which picks the prompt. */
export type DictationKind = "session" | "interview";

const PROMPTS: Record<DictationKind, string> = {
  session: SYSTEM,
  interview: INTERVIEW_SYSTEM,
};

export type DictationResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Is dictation switched on for this deployment?
 *
 * Follows `emailConfigured()` in lib/email/send.ts: an unset key means the
 * feature is off, not broken, so the button and the route can be built and
 * reviewed before anybody has an account. One variable now, where the first
 * build of this needed three.
 */
export function dictationConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/** The one place the provider is named. */
async function ask(
  audio: Blob,
  names: string[],
  kind: DictationKind
): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      messages: [
        { role: "system", content: PROMPTS[kind] },
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: {
                data: Buffer.from(await audio.arrayBuffer()).toString("base64"),
                format: "wav",
              },
            },
            // Spelling the model cannot infer from the sound alone. Given as
            // context rather than instruction, so an unheard name is not a
            // name the model feels obliged to work in.
            ...(names.length
              ? [
                  {
                    type: "text",
                    text: `Names that may come up, spelled correctly: ${names.join(", ")}.`,
                  },
                ]
              : []),
          ],
        },
      ],
    }),
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

/**
 * The whole job: audio in, a note the mentor can edit out.
 *
 * Every failure returns a sentence rather than throwing, because every failure
 * here is survivable — the textarea is still a textarea, and the mentor types
 * the note the way they did last week. Nothing about logging a session depends
 * on this working.
 */
export async function dictateNote(
  audio: Blob,
  names: string[] = [],
  kind: DictationKind = "session"
): Promise<DictationResult> {
  if (!dictationConfigured()) {
    return {
      ok: false,
      error: "Dictation is not switched on for this deployment yet.",
    };
  }

  let heard: string;
  try {
    heard = await ask(audio, names, kind);
  } catch (error) {
    console.error("[dictation] failed", error);
    return { ok: false, error: "Could not make out the recording. Try again." };
  }

  // The prompt asks for nothing back when there is no speech, so an empty
  // answer is the model saying "silence" rather than a failure to answer.
  if (!heard) return { ok: false, error: "That recording was silent." };

  return { ok: true, text: heard };
}
