import "server-only";

import { ASSIGNMENT_PROGRESS } from "@/lib/constants";
import type { Status } from "@/lib/status";

/**
 * A student's Home, read once for the website (`app/student/page.tsx`) and the
 * freshlog app (`/api/v1/student/home`): its rules moved here from the page,
 * unchanged, with their comments, so the two can't thin a list or order a plan
 * differently.
 */

/**
 * The account rows, minus the ones this page already says somewhere better.
 *
 * - An overdue task or agenda item is drawn in its own list, with its overdue
 *   chip, a few hundred pixels down. Repeated here it appeared two or three
 *   times on one screen ("Draft the activities section" under Things to check
 *   AND under Tasks, both "Was due September 29").
 * - The use-by row repeats the line under the balance, once that line shows.
 * - Mentors with no booking link are ONE row however many there are, and a
 *   neutral one: it is the mentor's setup step, not something the student did
 *   wrong, and two amber rows for it made five warnings on the first screen.
 */
export function withoutRepeats(
  rows: Status[],
  { useByShown }: { useByShown: boolean }
): Status[] {
  const kept = rows.filter(
    (s) =>
      s.type !== "TASK_OVERDUE" &&
      !(useByShown && s.type === "ALLOCATION_EXPIRING")
  );
  const noLink = kept.filter((s) => s.type === "BOOKING_LINK_MISSING");
  if (noLink.length === 0) return kept;

  const names = noLink.flatMap((s) => (s.subject ? [s.subject.name] : []));
  const merged: Status = {
    ...noLink[0],
    severity: "neutral",
    label: "No booking link yet",
    explanation:
      noLink.length === 1
        ? "Email them to find a time instead."
        : "Email them to find a time instead — their addresses are on the Book tab.",
    subject: noLink[0].subject && {
      ...noLink[0].subject,
      name: listNames(names),
    },
    href: "/student/book",
  };
  const at = kept.indexOf(noLink[0]);
  const rest = kept.filter((s) => s.type !== "BOOKING_LINK_MISSING");
  return [...rest.slice(0, at), merged, ...rest.slice(at)];
}

/** "Sarvar", "Sarvar and Aziza", "Sarvar, Aziza and 2 others". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length === 3 ? "" : "s"}`;
}

/**
 * The student's home. Phone first, and that is the whole design.
 *
 * The question this page exists to answer — how much time have I left, what
 * needs doing, when am I meeting someone — used to be answered below the fold.
 * An orange gradient hero with a 120px ghost monogram opened it, the balance
 * was stated three times (ring, sentence, breakdown key), then two red
 * callouts, then thirteen unpaginated journey entries: on a 390×664 screen the
 * first thing that asked anything of the student sat past 900px. So the
 * balance IS the h1 ("14h left"), the greeting is its eyebrow, and everything
 * with a question in it is one section that begins under 300px. (It was a
 * 96px ring beside a "Hi, Malika" h1: the ring's figure was 19px, the
 * smallest number a student opens the app to read.)
 *
 * Nothing here writes a status's wording or picks its colour. Every row's words
 * come from `lib/status.ts` in the student's own voice, which is what makes a
 * meeting read "Needs your answer" instead of "Awaiting Aziza's answer", and
 * what keeps this page and the mentor's inbox from inventing two vocabularies
 * for the same fact.
 */
/** Meetings on a page of Home; the rest are one numbered tap away. */
/**
 * The agenda as the page lists it: what is being worked on, then what has not
 * started, and the finished items apart, folded under them.
 */
export function agendaLists<T extends { task: { progress: string } }>(tasks: readonly T[]): { live: T[]; finished: T[] } {
  const finished = tasks.filter((t) => t.task.progress === ASSIGNMENT_PROGRESS.DONE);
  // In progress first, then not started: a plan reads forward.
  const live = [
    ...tasks.filter((t) => t.task.progress === ASSIGNMENT_PROGRESS.IN_PROGRESS),
    ...tasks.filter((t) => t.task.progress === ASSIGNMENT_PROGRESS.NOT_STARTED),
  ];
  return { live, finished };
}

/**
 * The first run: nothing has happened on the account yet, no time used, no
 * meeting, no task and no agenda, and the page shows How it works in their place.
 */
export function isFirstRun(a: { used: number; held: number; myTasks: number; tasks: number }): boolean {
  return a.used === 0 && a.held === 0 && a.myTasks === 0 && a.tasks === 0;
}
