import "server-only";

/**
 * Dictated session notes: a mentor says the note out loud, and gets back
 * written English they can edit before saving.
 *
 * Two calls, because they are two different jobs. MAI-Transcribe-2 turns
 * speech into text and — with `transcribeStyle: "clean"` — drops the "um"s,
 * the false starts and the self-corrections on its way. What it does NOT do is
 * fix grammar or untangle a sentence that was spoken in the wrong order, so a
 * small model reads the result and tidies it.
 *
 * Nothing here is stored. The audio is held in memory for the length of one
 * request and discarded; the text goes back to the browser and only reaches
 * the database if the mentor submits the form they were already filling in.
 * That is the whole reason this feature is cheap, both in money and in the
 * questions it raises: there is no recording of a student anywhere.
 *
 * WHY DICTATION AND NOT THE MEETING. Recording the whole session was the first
 * plan. It costs about thirty times as much, needs the student's consent, hits
 * the API's two-hour ceiling, cannot label who spoke (diarization fails above
 * about fifteen minutes in preview), and asks a model to guess which four of
 * seventy minutes mattered. The mentor already knows which four. Forty-five
 * seconds of them saying so is a better note and a smaller machine.
 */

/** Audio the browser is allowed to send. Speech, not a recording of a room. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/**
 * The transcription model, and the shape of the request that reaches it.
 *
 * `transcribeStyle` defaults to `verbatim`, which is the opposite of what this
 * feature is for — setting it to `clean` is half the work, done for free at
 * the transcription step rather than paid for again at the tidying one.
 *
 * `locales: ["en"]` against Microsoft's own advice, which is to let the model
 * detect the language unless you are certain. Here we are: every mentor at
 * this school teaches in English. Automatic detection is least reliable on
 * exactly this input — a short clip, one speaker, an accent — and a note that
 * comes back transliterated into the wrong alphabet is worse than useless.
 */
const SPEECH_MODEL = "MAI-Transcribe-2";
const SPEECH_API_VERSION = "2025-10-15";

/** The tidying model. Cheap on purpose: this is cleanup, not judgement. */
const REFINE_MODEL = "anthropic/claude-haiku-4.5";

/**
 * What the tidying model is told.
 *
 * The third paragraph is the one that matters. "Refine" is the operation most
 * likely to invent — to smooth a hedge into a commitment, or turn "maybe we
 * look at essays" into "we will review her essays on Thursday". A session note
 * is read back during a dispute (`Session.studentAnswer`), so a fluent
 * sentence nobody said is the expensive kind of wrong. The mentor proofreads
 * this before saving, and the invented detail that reads well is precisely the
 * one they will skim past.
 */
const REFINE_SYSTEM = `You tidy a mentor's spoken note about a teaching session into written English.

Fix grammar, spelling and punctuation. Remove filler words, false starts and repetition. Keep the mentor's own sentences, their own words and roughly their own length: this is a cleanup, not a summary and not a rewrite.

Never add a fact, a name, a date, a number or a next step that was not said. If something was left vague, leave it vague rather than guessing what was meant.

House vocabulary: never write "budgeted". A planned piece of work is an agenda item, never a "task". Write ratios with a slash.

Reply with the tidied note and nothing else. No preamble, no quotation marks, no markdown.`;

export type DictationResult =
  | { ok: true; text: string; live: boolean }
  | { ok: false; error: string };

/**
 * Is dictation switched on for this deployment?
 *
 * Follows `emailConfigured()` in lib/email/send.ts: unset keys mean dry-run,
 * not breakage, so the button and the route can be built, reviewed and clicked
 * through before anybody has an Azure subscription. The difference is that a
 * dry-run digest still has something useful to log, and a dry-run dictation has
 * nothing to say — so this reports itself to the caller rather than pretending.
 */
export function dictationConfigured(): boolean {
  return Boolean(
    process.env.AZURE_SPEECH_KEY &&
      process.env.AZURE_SPEECH_REGION &&
      process.env.OPENROUTER_API_KEY
  );
}

/**
 * Speech to text.
 *
 * The endpoint is region-scoped and so is the key — a key used against another
 * region fails authentication rather than falling back, which is the failure
 * you get if AZURE_SPEECH_REGION and the resource disagree. MAI-Transcribe
 * runs in six regions only: eastus, westus, westus2, northeurope, centralindia
 * and southeastasia. A Speech resource anywhere else answers ordinary requests
 * and rejects `enhancedMode`.
 *
 * `phrases` biases recognition toward words the model cannot infer from
 * context — a student's name, a program's name. They are hints, not spelling
 * rules, and an empty list is fine.
 */
async function transcribe(audio: Blob, phrases: string[]): Promise<string> {
  const region = process.env.AZURE_SPEECH_REGION;
  const form = new FormData();
  form.append("audio", audio, "note.wav");
  form.append(
    "definition",
    JSON.stringify({
      locales: ["en"],
      enhancedMode: {
        enabled: true,
        model: SPEECH_MODEL,
        modelOptions: { transcribeStyle: "clean", timestamps: "none" },
      },
      ...(phrases.length ? { phraseList: { phrases } } : {}),
    })
  );

  const response = await fetch(
    `https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=${SPEECH_API_VERSION}`,
    {
      method: "POST",
      // No Content-Type: fetch writes it, with the multipart boundary that
      // setting it by hand would omit.
      headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY! },
      body: form,
    }
  );

  if (!response.ok) {
    throw new Error(
      `Azure Speech answered ${response.status}: ${(await response.text()).slice(0, 300)}`
    );
  }

  const result = (await response.json()) as {
    combinedPhrases?: { text?: string }[];
  };
  return (result.combinedPhrases ?? [])
    .map((phrase) => phrase.text ?? "")
    .join(" ")
    .trim();
}

/**
 * Text to tidier text.
 *
 * Reached through OpenRouter, whose API is OpenAI-shaped. Swapping to a direct
 * Anthropic key means rewriting this function and nothing else — the same
 * arrangement `deliver` has in lib/email/send.ts, and for the same reason.
 */
async function refine(raw: string): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: REFINE_MODEL,
      max_tokens: 1000,
      messages: [
        { role: "system", content: REFINE_SYSTEM },
        { role: "user", content: raw },
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
  phrases: string[] = []
): Promise<DictationResult> {
  if (!dictationConfigured()) {
    return {
      ok: false,
      error: "Dictation is not switched on for this deployment yet.",
    };
  }

  let heard: string;
  try {
    heard = await transcribe(audio, phrases);
  } catch (error) {
    console.error("[dictation] transcribe failed", error);
    return { ok: false, error: "Could not make out the recording. Try again." };
  }

  if (!heard) {
    return { ok: false, error: "That recording was silent." };
  }

  try {
    const tidied = await refine(heard);
    // An empty completion is a failure that did not announce itself. The raw
    // transcript is worse than the tidied one and better than nothing, and the
    // mentor can see for themselves which they got.
    return { ok: true, text: tidied || heard, live: true };
  } catch (error) {
    console.error("[dictation] refine failed", error);
    return { ok: true, text: heard, live: true };
  }
}
