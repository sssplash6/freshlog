import { afterEach, describe, expect, it, vi } from "vitest";

import { dictateNote } from "@/lib/dictation";

/**
 * The two halves of dictation fail in different ways, and the difference is
 * the whole design: a transcription that fails has nothing to offer, while a
 * tidying pass that fails still has the mentor's words in it. Losing that
 * distinction would mean a mentor who spoke for forty-five seconds gets an
 * error instead of a rough note, which is the one outcome worth avoiding.
 */
const ENV = {
  AZURE_SPEECH_KEY: "key",
  AZURE_SPEECH_REGION: "centralindia",
  OPENROUTER_API_KEY: "or-key",
};

function configure() {
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
}

/** Azure first, OpenRouter second — in the order `dictateNote` calls them. */
function respond(...replies: (object | Error)[]) {
  const fetchMock = vi.fn();
  for (const reply of replies) {
    fetchMock.mockImplementationOnce(async () => {
      if (reply instanceof Error) throw reply;
      return { ok: true, json: async () => reply, text: async () => "" };
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const HEARD = { combinedPhrases: [{ text: "we went over her personal statement" }] };
const TIDIED = {
  choices: [{ message: { content: "We went over her personal statement." } }],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("dictateNote", () => {
  it("returns the tidied note when both calls land", async () => {
    configure();
    respond(HEARD, TIDIED);

    const result = await dictateNote(new Blob(["x"]));

    expect(result).toEqual({
      ok: true,
      text: "We went over her personal statement.",
      live: true,
    });
  });

  it("keeps the raw transcript when only the tidying fails", async () => {
    configure();
    respond(HEARD, new Error("OpenRouter is down"));

    const result = await dictateNote(new Blob(["x"]));

    // Rough words the mentor can edit beat an error they cannot.
    expect(result).toEqual({
      ok: true,
      text: "we went over her personal statement",
      live: true,
    });
  });

  it("fails when the transcription fails, because there is nothing to offer", async () => {
    configure();
    respond(new Error("Azure is down"));

    const result = await dictateNote(new Blob(["x"]));

    expect(result.ok).toBe(false);
  });

  it("says so when the recording was silent rather than saving an empty note", async () => {
    configure();
    respond({ combinedPhrases: [{ text: "  " }] });

    const result = await dictateNote(new Blob(["x"]));

    expect(result).toEqual({ ok: false, error: "That recording was silent." });
  });

  it("calls nobody when the deployment has no keys", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "");
    vi.stubEnv("AZURE_SPEECH_REGION", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetchMock = respond();

    const result = await dictateNote(new Blob(["x"]));

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks Azure for clean style in English, and passes the name hints on", async () => {
    configure();
    const fetchMock = respond(HEARD, TIDIED);

    await dictateNote(new Blob(["x"]), ["Imkon", "Nodira Karimova"]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("centralindia.api.cognitive.microsoft.com");
    const definition = JSON.parse(
      (init.body as FormData).get("definition") as string
    );
    expect(definition.enhancedMode).toMatchObject({
      enabled: true,
      model: "MAI-Transcribe-2",
    });
    // The default is verbatim, which is the opposite of what this is for.
    expect(definition.enhancedMode.modelOptions.transcribeStyle).toBe("clean");
    expect(definition.locales).toEqual(["en"]);
    expect(definition.phraseList.phrases).toContain("Nodira Karimova");
  });
});
