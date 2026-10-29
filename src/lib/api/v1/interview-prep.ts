import "server-only";

import { slotTime } from "@/lib/api/v1/practice";
import type { InterviewPrep, PrepRow } from "@/lib/api/v1/types";
import { adminScope, scopeIsEmpty, scopeProgramFilter } from "@/lib/authz";
import { PAGE_SIZE } from "@/components/ui/pagination";
import { toDateInputValue } from "@/lib/format";
import { interviewsForStaff, prepByStudent, type PrepInterview } from "@/lib/interview-prep";
import { templateName } from "@/lib/interview-templates";
import type { User } from "@/generated/prisma/client";

const nameOf = (p: { name: string | null }) => p.name?.trim() || "A student";

function rowOf(iv: PrepInterview): PrepRow {
  const absent = iv.absent ? iv[iv.absent] : null;
  return {
    id: iv.id,
    when: slotTime({ startsAt: iv.startsAt, minutes: iv.minutes }),
    template: { id: iv.template, name: templateName(iv.template) },
    people: [iv.host, iv.guest].map((p) => ({ id: p.id, name: nameOf(p), student: p.ours ? p.profileId : null })),
    phase: iv.phase,
    absent: absent ? nameOf(absent) : null,
  };
}

/**
 * The website's Interview prep (`/interviews`), for whoever administers a program (`requireAdminAccess`): every
 * practice interview a student of theirs took part in (`interviewsForStaff`, which selects who and when only), as
 * the page splits it. Null for anybody else.
 */
export async function interviewPrepFor(user: User, page: number, now: Date = new Date()): Promise<InterviewPrep | null> {
  const scope = await adminScope(user);
  if (scopeIsEmpty(scope)) return null;
  const interviews = await interviewsForStaff(scopeProgramFilter(scope), now);
  const upcoming = interviews.filter((i) => i.phase === "booked").reverse();
  const past = interviews.filter((i) => i.phase !== "booked");
  const held = past.filter((i) => i.phase === "completed");
  const pages = Math.max(1, Math.ceil(past.length / PAGE_SIZE));
  const at = Math.min(page, pages);
  return {
    held: held.length,
    minutesHeld: held.reduce((sum, i) => sum + i.minutes, 0),
    coming: upcoming.map(rowOf),
    students: prepByStudent(interviews).map((s) => ({
      student: { id: s.person.profileId, userId: s.person.id, name: nameOf(s.person) },
      held: s.held,
      minutesHeld: s.minutesHeld,
      upcoming: s.upcoming,
      missed: s.missed,
      last: s.lastAt ? toDateInputValue(s.lastAt) : null,
    })),
    history: past.slice((at - 1) * PAGE_SIZE, at * PAGE_SIZE).map(rowOf),
    page: at,
    pages,
    total: past.length,
  };
}
