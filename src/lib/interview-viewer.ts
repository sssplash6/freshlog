import "server-only";

import { redirect } from "next/navigation";

import type { User } from "@/generated/prisma/client";
import { ROLES } from "@/lib/constants";
import { requireMentor, requireRole } from "@/lib/dal";
import { actsAs, type Capacity } from "@/lib/interview-partners";

/**
 * Who is reading an interview page, and in which capacity: the same pages
 * serve a student under /student/interviews and a mentor under
 * /mentor/interviews.
 */
export type InterviewViewer = {
  user: User;
  as: Capacity;
  /** Where this capacity's interview pages are. */
  base: "/student/interviews" | "/mentor/interviews";
  now: Date;
};

/**
 * The gate for every interview page, on the page's first line. A student not
 * yet approved goes home, where the page explains what's next; a mentor who
 * cannot take part goes to theirs.
 */
export async function requireInterviewViewer(as: Capacity): Promise<InterviewViewer> {
  if (as === "student") {
    const user = await requireRole(ROLES.STUDENT);
    if (!actsAs(user, "student")) redirect("/student");
    return { user, as, base: "/student/interviews", now: new Date() };
  }
  const user = await requireMentor();
  if (!actsAs(user, "mentor")) redirect("/mentor");
  return { user, as, base: "/mentor/interviews", now: new Date() };
}
