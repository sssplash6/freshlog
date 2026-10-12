/**
 * The interviews students practise on each other.
 *
 * Fixed by the product, on purpose: a student chooses one when they book, and
 * never writes their own. The set is short because a list of twelve is a list
 * nobody reads to the end; each template is the handful of questions an
 * interviewer of that kind actually opens with, so the student playing the
 * interviewer has something to ask and the one being interviewed has something
 * real to rehearse.
 *
 * A booked interview stores the `id`, never the text — so editing a question
 * here changes it for interviews not yet held, and an `id` must never be
 * reused for a different interview. Retire one by removing it; a row that still
 * names it reads as a plain "Practice interview" rather than failing.
 */
export type InterviewTemplate = {
  id: string;
  name: string;
  /** Who asks these, and why. Not shown: the picker names a template only. */
  summary: string;
  questions: readonly string[];
};

export const INTERVIEW_TEMPLATES: readonly InterviewTemplate[] = [
  {
    id: "freshman-session-1",
    name: "Freshman Interview Practice: Session 1",
    summary: "The school's first session: getting to know you, and why college.",
    questions: [
      "What are you reading, watching, or working on right now? Is there anything that has caught your attention recently?",
      "Describe a teacher you really enjoyed learning from.",
      "What are you most excited about in college?",
      "Tell me about a situation when you had to change your mind or adapt to make something work.",
    ],
  },
  {
    id: "university-admissions",
    name: "University admissions",
    summary: "An admissions officer or alumnus meeting an applicant.",
    questions: [
      "Tell me about yourself.",
      "Why do you want to study this subject?",
      "Why this university in particular?",
      "What have you read or done outside class that shaped your interest?",
      "Describe a challenge you faced and how you handled it.",
      "What will you contribute to our campus community?",
      "What questions do you have for me?",
    ],
  },
  {
    id: "scholarship",
    name: "Scholarship panel",
    summary: "A funding panel deciding who to invest in.",
    questions: [
      "Why do you deserve this scholarship over other strong applicants?",
      "What do you plan to do after graduating, and how does this help?",
      "Tell me about a time you led others.",
      "How have you given back to your community?",
      "What is your biggest weakness, and what are you doing about it?",
      "Where do you see yourself in ten years?",
    ],
  },
  {
    id: "behavioral",
    name: "Behavioral (STAR)",
    summary: "Questions answered as situation, task, action, result.",
    questions: [
      "Tell me about a time you failed. What did you learn?",
      "Describe a time you disagreed with a teammate. What happened?",
      "Tell me about a goal you set and how you reached it.",
      "Describe a time you had to learn something quickly.",
      "Tell me about a decision you made with incomplete information.",
      "Describe a time you helped someone who was struggling.",
    ],
  },
  {
    id: "visa",
    name: "Student visa",
    summary: "A consular officer checking study plans and ties to home.",
    questions: [
      "Why did you choose this country and this university?",
      "What will you study, and why is it useful for you?",
      "Who is paying for your studies?",
      "What do your parents do?",
      "What are your plans after you finish your degree?",
      "Do you have relatives in this country?",
    ],
  },
];

/** A template by id, or null when a stored id no longer names one. */
export function templateById(id: string): InterviewTemplate | null {
  return INTERVIEW_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** What an interview is called in a list: the template's name, always. */
export function templateName(id: string): string {
  return templateById(id)?.name ?? "Practice interview";
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
