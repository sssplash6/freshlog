/**
 * University applications: the vocabulary and the parsers, shared by the
 * actions that write an application and the page that draws it.
 *
 * See `StudentApplication` in prisma/schema.prisma for why it is one record per
 * student, and `applicationAccess` in lib/authz.ts for who may read it.
 */

/**
 * The four stages an essay goes through, in order — the motivational essay and
 * every supplemental alike. Null on a row means nobody has started it, which
 * draws as an empty bar rather than as a fifth stage.
 */
export const ESSAY_STAGES = ["BRAINSTORMING", "WRITING", "FINALIZING", "DONE"] as const;
export type EssayStage = (typeof ESSAY_STAGES)[number];

export const ESSAY_STAGE_LABEL: Record<EssayStage, string> = {
  BRAINSTORMING: "Brainstorming",
  WRITING: "Writing",
  FINALIZING: "Finalizing",
  DONE: "Done",
};

export function isEssayStage(value: unknown): value is EssayStage {
  return typeof value === "string" && (ESSAY_STAGES as readonly string[]).includes(value);
}

/** How far along a stage is, 1–4, or 0 when not started. */
export function stageStep(stage: string | null | undefined): number {
  return isEssayStage(stage) ? ESSAY_STAGES.indexOf(stage) + 1 : 0;
}

/** The application round of a student's primary choice. Optional. */
export const ROUNDS = ["ED", "REA", "EA"] as const;
export type Round = (typeof ROUNDS)[number];

export const ROUND_LABEL: Record<Round, string> = {
  ED: "Early Decision",
  REA: "Restrictive Early Action",
  EA: "Early Action",
};

export function isRound(value: unknown): value is Round {
  return typeof value === "string" && (ROUNDS as readonly string[]).includes(value);
}

/** One spelling of a university however it was typed — case and spacing. */
export function universityKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The name as it will be shown: trimmed, inner runs of space collapsed. */
export function tidyUniversityName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

type Parsed<T> = { value: T } | { error: string };

/** An optional whole number in a range, from a form field. Commas allowed. */
function parseOptionalInt(
  raw: FormDataEntryValue | null,
  label: string,
  min: number,
  max: number
): Parsed<number | null> {
  const text = String(raw ?? "").replace(/[,\s]/g, "");
  if (text === "") return { value: null };
  if (!/^\d+$/.test(text)) return { error: `${label} must be a whole number.` };
  const n = Number(text);
  if (n < min || n > max) return { error: `${label} must be between ${min} and ${max}.` };
  return { value: n };
}

/** SAT total: 400–1600, in tens. Empty clears it. */
export function parseSat(raw: FormDataEntryValue | null): Parsed<number | null> {
  const parsed = parseOptionalInt(raw, "SAT", 400, 1600);
  if ("error" in parsed || parsed.value === null) return parsed;
  if (parsed.value % 10 !== 0) return { error: "SAT scores go up in tens, e.g. 1450." };
  return parsed;
}

/** IELTS band: 0–9 in halves. Empty clears it. */
export function parseIelts(raw: FormDataEntryValue | null): Parsed<number | null> {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (text === "") return { value: null };
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 9 || (n * 2) % 1 !== 0) {
    return { error: "IELTS must be a band from 0 to 9, in halves, e.g. 7.5." };
  }
  return { value: n };
}

/** Free text, trimmed, capped; empty clears it. */
export function parseOptionalText(
  raw: FormDataEntryValue | null,
  label: string,
  max: number
): Parsed<string | null> {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (text === "") return { value: null };
  if (text.length > max) return { error: `${label} is too long — ${max} characters at most.` };
  return { value: text };
}

/** A supplemental total: required, 0 for a university that asks none. */
export function parseSupplementalWords(raw: FormDataEntryValue | null): Parsed<number> {
  const text = String(raw ?? "").replace(/[,\s]/g, "");
  if (text === "") return { error: "Enter the supplemental essays' total word count — 0 if it asks none." };
  const parsed = parseOptionalInt(text, "The word count", 0, 20000);
  if ("error" in parsed) return parsed;
  return { value: parsed.value ?? 0 };
}

/** "1,000 words", or that it asks none. */
export function wordsLabel(words: number): string {
  if (words === 0) return "No supplemental essays";
  return `${words.toLocaleString("en-US")} word${words === 1 ? "" : "s"}`;
}

/** An IELTS band as written: 7 → "7.0", 7.5 → "7.5". */
export function ieltsLabel(band: number): string {
  return band.toFixed(1);
}
