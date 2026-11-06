import "server-only";

import { cache } from "react";

import {
  FALLBACK_TEMPLATE_NAME,
  type InterviewTemplate,
} from "@/lib/interview-templates";
import { prisma } from "@/lib/prisma";

/**
 * The practice-interview templates, read from their table.
 *
 * Every reader goes through here rather than to Prisma, because `questions` is
 * a JSON column and one parser is the only way it is read the same everywhere.
 * `cache()`d per request: a page that names twenty interviews and books a
 * twenty-first asks the database once.
 */

/** A template as its table holds it: also when it was retired, if it was. */
export type StoredTemplate = InterviewTemplate & {
  position: number;
  retiredAt: Date | null;
};

/** Never throws on a malformed row: a template with no readable questions has none. */
function parseQuestions(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((q): q is string => typeof q === "string") : [];
  } catch {
    return [];
  }
}

/** Every template, retired ones too, in picker order. */
export const allInterviewTemplates = cache(async (): Promise<StoredTemplate[]> => {
  const rows = await prisma.interviewTemplate.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    summary: r.summary,
    questions: parseQuestions(r.questions),
    position: r.position,
    retiredAt: r.retiredAt,
  }));
});

/** The templates a student may book now: not retired, with a question to ask. */
export async function bookableTemplates(): Promise<InterviewTemplate[]> {
  return (await allInterviewTemplates()).filter(
    (t) => t.retiredAt === null && t.questions.length > 0
  );
}

/**
 * A template by id, retired or not — an interview booked before it was retired
 * is still held with its questions — or null when the id names none.
 */
export async function findInterviewTemplate(id: string): Promise<StoredTemplate | null> {
  return (await allInterviewTemplates()).find((t) => t.id === id) ?? null;
}

/**
 * What interviews are called in a list, as a lookup: load once, then name each
 * row with `name(i.template)`. Retired templates keep their name.
 */
export async function templateNames(): Promise<(id: string) => string> {
  const byId = new Map((await allInterviewTemplates()).map((t) => [t.id, t.name]));
  return (id) => byId.get(id) ?? FALLBACK_TEMPLATE_NAME;
}
