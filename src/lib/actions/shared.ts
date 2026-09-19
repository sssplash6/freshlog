/**
 * Shared result shape for form server actions driven by useActionState.
 * `null` is the initial state before any submission.
 *
 * Two optional payloads, both added for `/sessions/new` and both safe to
 * ignore:
 *
 * `values` echoes what was submitted so a failed form can refill itself. React
 * 19 resets an uncontrolled form once its action settles, which is right after
 * a success and wrong after a failure — a mentor who mistyped the minutes was
 * losing the note, the task and the date along with it.
 *
 * `receipt` is what happened, structurally, so a page can show the outcome and
 * link to it instead of parsing a sentence for an id.
 */
export type ActionState =
  | { ok: true; message?: string; receipt?: ActionReceipt; session?: SessionUpdate }
  | { ok: false; error: string; field?: string; values?: Record<string, string> }
  | null;

/** What a completed write produced, for a page that shows a receipt. */
export type ActionReceipt = {
  /** The row just written, so "Edit it" can open it. */
  id: string;
  /** The short version: "Logged 90 min with Aziza." */
  headline: string;
  /** The consequences, one clause each — what changed, what is left. */
  notes: string[];
  subject?: { kind: "student" | "mentor" | "program"; id: string; name: string };
};

/** Normalized session values returned by an inline edit. */
export type SessionUpdate = {
  minutes: number;
  date: string;
  note: string | null;
  assignmentId: string | null;
  attended: boolean;
  late: boolean;
  status: string;
  withinPlan: boolean;
  task: { id: string; purpose: string } | null;
};

/**
 * Parse a whole-minutes form field. Returns an error string or the value.
 *
 * Whole minutes only: the ledger stores integers so that sums are exact, and
 * "22.5 minutes" is not a thing anybody means. A decimal is rejected rather
 * than silently rounded — a mentor who typed 1.5 meant an hour and a half and
 * needs to be told the box now wants 90.
 */
export function parseMinutesField(
  raw: FormDataEntryValue | null,
  { min, label }: { min: number; label: string }
): { value: number } | { error: string } {
  const text = String(raw ?? "").trim();
  const n = Number(text);
  if (!text || !Number.isFinite(n)) return { error: `${label} must be a number of minutes.` };
  if (!Number.isInteger(n)) {
    return { error: `${label} must be whole minutes — 90, not 1.5.` };
  }
  if (n < min) return { error: `${label} must be at least ${min}.` };
  // 600000 minutes is a little over a year of continuous meetings.
  if (n > 600000) return { error: `${label} is implausibly large.` };
  return { value: n };
}

/** Parse a required YYYY-MM-DD date field to a UTC-midnight Date. */
export function parseDateField(
  raw: FormDataEntryValue | null
): { value: Date } | { error: string } {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: "Pick a valid date." };
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return { error: "Pick a valid date." };
  return { value: d };
}

/**
 * Parse an OPTIONAL link field (e.g. a student's file on Google Drive). Blank
 * means "no link" and yields null. A bare host like `drive.google.com/…` is
 * accepted and https-prefixed, since that's how links get pasted; anything
 * that isn't http(s) is rejected so only openable links are ever stored.
 */
export function parseLinkField(
  raw: FormDataEntryValue | null,
  label: string
): { value: string | null } | { error: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { value: null };
  // Only prefix when no scheme is present at all — never rewrite `ftp:`/`javascript:`
  // into something that would sneak past the protocol check below.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { error: `${label} must be a valid link.` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: `${label} must be an http or https link.` };
  }
  return { value: url.toString() };
}

export function normalizeEmail(raw: FormDataEntryValue | null): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Telegram usernames: 5-32 of letters, digits and underscores. */
const TELEGRAM_RE = /^[A-Za-z0-9_]{5,32}$/;

/**
 * Normalize a Telegram username field ("@name" or "name"). Returns the bare
 * username or an error message.
 *
 * Shared because two places take one: onboarding captures it, and /settings
 * lets a student correct it afterwards — which they could not do at all while
 * this lived beside the onboarding action.
 */
export function parseTelegramField(
  raw: FormDataEntryValue | null
): { value: string } | { error: string } {
  const value = String(raw ?? "")
    .trim()
    .replace(/^@/, "");
  if (!TELEGRAM_RE.test(value)) {
    return {
      error:
        "Enter your Telegram username (5–32 letters, digits or underscores).",
    };
  }
  return { value };
}

/**
 * The rule for a person's name, in one place: a FULL name, not a first name.
 *
 * Every list, chip, session row and booking card in the app reads people by
 * name, and a roster of "Malika", "Aziza", "Malika" is a roster nobody can act
 * on — two mentors asking an admin which Malika they mean is the failure this
 * prevents. The forms all said "Full name" and all accepted one word.
 *
 * Deliberately shallow: two parts separated by whitespace, and nothing about
 * what a part may contain. It is a completeness check, not a spelling one — a
 * transliterated name, a hyphen, an apostrophe and a middle name all pass, and
 * the person typing it knows better than a regex what their name is. Runs of
 * whitespace collapse so "Malika   Karimova" stores the way it reads.
 *
 * `label` names whose name it is, because the same rule is applied to your own
 * name, a mentor's and a student's, and "Enter your first and last name" is
 * the wrong sentence in two of those three places.
 */
export function parseNameField(
  raw: FormDataEntryValue | null,
  label = "their"
): { value: string } | { error: string } {
  const value = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!value) return { error: `Enter ${label} full name.` };
  if (value.length > NAME_MAX) {
    return { error: `That name is too long (${NAME_MAX} characters max).` };
  }
  if (!FULL_NAME_RE.test(value)) {
    return {
      error: `Enter ${label} full name — first and last, not just one word.`,
    };
  }
  return { value };
}

/** Two words or more. The pattern the name inputs enforce in the browser too. */
export const FULL_NAME_RE = /^\S+(?: \S+)+$/;

/** What `User.name` holds, and what every name input caps itself at. */
export const NAME_MAX = 80;
