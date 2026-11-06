/**
 * The interviews students practise on each other: what one is, and the rules
 * for writing one.
 *
 * A student chooses a template when they book, and never writes their own. The
 * templates themselves are rows (`InterviewTemplate`), written by platform
 * admins on /interviews/templates and read through
 * lib/interview-template-store.ts; this file holds only what a client
 * component may import too.
 *
 * Keep the set short: a list of twelve is a list nobody reads to the end. Each
 * template is the handful of questions an interviewer of that kind actually
 * opens with, so the student playing the interviewer has something to ask and
 * the one being interviewed has something real to rehearse.
 *
 * A booked interview stores the `id`, never the text — so editing a question
 * changes it for interviews not yet held. A template is retired, never deleted;
 * a row naming an id that no longer exists reads as a plain "Practice
 * interview" rather than failing.
 */
export type InterviewTemplate = {
  id: string;
  name: string;
  /** One line under the name in the picker: who asks these, and why. */
  summary: string;
  questions: readonly string[];
};

/** What an interview is called when its template is gone. */
export const FALLBACK_TEMPLATE_NAME = "Practice interview";

export const TEMPLATE_LIMITS = {
  name: 80,
  summary: 160,
  question: 400,
  questions: 15,
} as const;

/** What a template's form says, checked; or the first thing wrong with it. */
export type TemplateInput =
  | { ok: true; name: string; summary: string; questions: string[] }
  | { ok: false; error: string };

/**
 * Read a template's form: a name, an optional one-line summary, and the
 * questions one per line. Blank lines are dropped and spaces tidied, so a list
 * pasted from a document comes through as the questions it shows.
 */
export function readTemplateInput(form: {
  name: unknown;
  summary: unknown;
  questions: unknown;
}): TemplateInput {
  const tidy = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const name = tidy(form.name);
  const summary = tidy(form.summary);
  const questions = String(form.questions ?? "")
    .split(/\r?\n/)
    .map(tidy)
    // A pasted numbered list keeps its numbers otherwise: "1. Tell me…".
    .map((q) => q.replace(/^(\d+[.)]|[-*•])\s+/, ""))
    .filter((q) => q.length > 0);

  if (name.length < 3) return { ok: false, error: "Give the template a name (3+ characters)." };
  if (name.length > TEMPLATE_LIMITS.name) {
    return { ok: false, error: `Keep the name under ${TEMPLATE_LIMITS.name} characters.` };
  }
  if (summary.length > TEMPLATE_LIMITS.summary) {
    return { ok: false, error: `Keep the summary under ${TEMPLATE_LIMITS.summary} characters.` };
  }
  if (questions.length === 0) return { ok: false, error: "Add at least one question." };
  if (questions.length > TEMPLATE_LIMITS.questions) {
    return { ok: false, error: `Keep it to ${TEMPLATE_LIMITS.questions} questions or fewer.` };
  }
  const long = questions.findIndex((q) => q.length > TEMPLATE_LIMITS.question);
  if (long >= 0) {
    return {
      ok: false,
      error: `Question ${long + 1} is too long. Keep each under ${TEMPLATE_LIMITS.question} characters.`,
    };
  }
  return { ok: true, name, summary, questions };
}

/**
 * The session around the questions, the same for every template: the school's
 * own words, kept verbatim so a student reads what their teacher wrote.
 */
export const INTERVIEW_INTRO =
  "Introduce yourself to your partner. Share your name, where you're from, and a little about what you've been up to this week.";

export const INTERVIEW_RUBRIC: readonly { name: string; questions: readonly string[] }[] = [
  {
    name: "Content",
    questions: [
      "How relevant, detailed, and insightful was the response?",
      "Did your partner provide specific examples?",
      "Did you learn something interesting?",
    ],
  },
  {
    name: "Flow & Structure",
    questions: [
      "Was the response easy to follow?",
      "Were the ideas logically connected, or did your partner jump from point to point?",
      "Did the response have a clear structure?",
    ],
  },
  {
    name: "Grammar & Language",
    questions: [
      "Was the language grammatically accurate?",
      "Did your partner use appropriate and varied vocabulary?",
      "Were there any recurring mistakes?",
    ],
  },
  {
    name: "Confidence",
    questions: [
      "Did your partner speak clearly and confidently?",
      "Did they maintain a natural pace?",
      "Did they avoid excessive filler words and unnecessary pauses?",
    ],
  },
];

export const INTERVIEW_TURNS =
  "Take turns interviewing each other using the following questions. Listen carefully to your partner's responses.";

export const FEEDBACK_PROMPTS = {
  summary: "Briefly summarize your partner's answers.",
  wentWell:
    "Always start with positive feedback. Highlight what your partner did particularly well.",
  toImprove:
    "Identify areas for improvement and provide specific, constructive suggestions.",
} as const;

export const FEEDBACK_DISCUSS =
  "Discuss your feedback with each other before submitting the form.";
