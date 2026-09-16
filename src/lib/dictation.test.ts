import { afterEach, describe, expect, it, vi } from "vitest";

import { dictateNote } from "@/lib/dictation";

/**
 * The contract worth pinning is not the happy path — it is that a mentor who
 * spoke for forty-five seconds is never left with nothing. Every failure comes
 * back as a sentence, because the textarea is still a textarea and the note
 * can always be typed.
 */
function respond(reply: object | Error) {
  const fetchMock = vi.fn(async () => {
    if (reply instanceof Error) throw reply;
    return { ok: true, json: async () => reply, text: async () => "" };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const SAID = {
  choices: [{ message: { content: "We went over her personal statement." } }],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("dictateNote", () => {
  it("returns the note the model wrote", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    respond(SAID);

    expect(await dictateNote(new Blob(["x"]))).toEqual({
      ok: true,
      text: "We went over her personal statement.",
    });
  });

  it("reports a failure instead of throwing into the route", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    respond(new Error("OpenRouter is down"));

    expect((await dictateNote(new Blob(["x"]))).ok).toBe(false);
  });

  it("says so when the recording was silent rather than saving an empty note", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    // The prompt asks for nothing back when there is no speech.
    respond({ choices: [{ message: { content: "  " } }] });

    expect(await dictateNote(new Blob(["x"]))).toEqual({
      ok: false,
      error: "That recording was silent.",
    });
  });

  it("calls nobody when the deployment has no key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetchMock = respond(SAID);

    expect((await dictateNote(new Blob(["x"]))).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the audio and the name spellings in one request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    const fetchMock = respond(SAID);

    await dictateNote(new Blob(["x"]), ["Imkon", "Nodira Karimova"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("openrouter.ai");

    const body = JSON.parse(init.body as string);
    const parts = body.messages[1].content;
    expect(parts[0].type).toBe("input_audio");
    expect(parts[0].input_audio.format).toBe("wav");
    expect(parts[1].text).toContain("Nodira Karimova");
  });
});
