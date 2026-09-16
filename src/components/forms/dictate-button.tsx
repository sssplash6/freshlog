"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buttonClasses } from "@/components/ui/button";

/** Longer than any session note anybody speaks, and well under the 5MB cap. */
const MAX_SECONDS = 120;

/** What Azure accepts is WAV, MP3 or FLAC; what we send is 16kHz mono WAV. */
const SAMPLE_RATE = 16000;

type Phase = "idle" | "recording" | "working";

/**
 * Say the session note instead of typing it.
 *
 * The recording never leaves this component as audio the app keeps — it goes
 * straight to /api/notes/dictate, which sends it on and stores nothing. What
 * comes back is text, appended to whatever is already in the box so a second
 * take adds to the first rather than wiping it.
 *
 * `MediaRecorder` gives WebM/Opus in Chrome and MP4/AAC in Safari, and the
 * transcriber takes neither. Rather than ship an encoder, the browser decodes
 * its own recording — which it can always do — and we re-render it as 16kHz
 * mono WAV through an OfflineAudioContext. Forty lines, no dependency, and
 * speech has nothing above 8kHz worth paying to upload.
 */
export function DictateButton({
  studentProfileId,
  onText,
}: {
  /** Whose name to hint the transcriber with. Optional; no student yet is fine. */
  studentProfileId?: string;
  onText: (text: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  // Stop the microphone if this unmounts mid-take. Without it the browser's
  // recording indicator stays lit after the mentor navigates away, which reads
  // as "this app is still listening" — and is worth avoiding even though it
  // is only the tab that is holding the stream open.
  useEffect(() => {
    return () => {
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const tick = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [phase]);

  useEffect(() => {
    if (phase === "recording" && seconds >= MAX_SECONDS) recorder.current?.stop();
  }, [phase, seconds]);

  const send = useCallback(
    async (recorded: Blob) => {
      setPhase("working");
      try {
        const body = new FormData();
        body.append("audio", await toWav(recorded), "note.wav");
        if (studentProfileId) body.append("studentProfileId", studentProfileId);

        const response = await fetch("/api/notes/dictate", { method: "POST", body });
        const result = (await response.json()) as
          | { ok: true; text: string }
          | { ok: false; error: string };

        if (!result.ok) setError(result.error);
        else onText(result.text);
      } catch {
        setError("That did not get through. Try again.");
      } finally {
        setPhase("idle");
        setSeconds(0);
      }
    },
    [onText, studentProfileId]
  );

  async function start() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("The microphone is blocked for this site.");
      return;
    }

    const chunks: Blob[] = [];
    const media = new MediaRecorder(stream);
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    media.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      void send(new Blob(chunks, { type: media.mimeType }));
    };

    recorder.current = media;
    media.start();
    setSeconds(0);
    setPhase("recording");
  }

  const label =
    phase === "recording"
      ? `Stop ${format(seconds)}`
      : phase === "working"
        ? "Tidying…"
        : "Say it";

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={phase === "working"}
        aria-busy={phase === "working"}
        onClick={() => (phase === "recording" ? recorder.current?.stop() : void start())}
        className={buttonClasses("secondary", "sm")}
      >
        {phase === "recording" ? (
          <span
            aria-hidden="true"
            className="h-2 w-2 animate-pulse rounded-full bg-danger"
          />
        ) : (
          <MicIcon />
        )}
        {label}
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger-ink">
          {error}
        </span>
      )}
    </span>
  );
}

function format(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path
        d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Whatever the browser recorded, re-rendered as 16kHz mono 16-bit WAV.
 *
 * Every browser can decode its own `MediaRecorder` output, which is what makes
 * this work without an encoder: Chrome decodes the Opus it wrote, Safari the
 * AAC it wrote, and both hand back raw samples. The OfflineAudioContext then
 * does the resample and the downmix in one pass.
 */
async function toWav(recorded: Blob): Promise<Blob> {
  const context = new AudioContext();
  const decoded = await context.decodeAudioData(await recorded.arrayBuffer());
  void context.close();

  const offline = new OfflineAudioContext(
    1,
    Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)),
    SAMPLE_RATE
  );
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();

  return encodeWav((await offline.startRendering()).getChannelData(0));
}

function encodeWav(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // PCM, uncompressed
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}
