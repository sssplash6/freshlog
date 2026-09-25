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
  /** One line under the name in the picker: who asks these, and why. */
  summary: string;
  questions: readonly string[];
};

export const INTERVIEW_TEMPLATES: readonly InterviewTemplate[] = [
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
