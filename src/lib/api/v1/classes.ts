import "server-only";

import type { ApiClasses } from "@/lib/api/v1/types";
import { adminWriteScope, scopeCovers } from "@/lib/authz";
import { monthLabel } from "@/lib/class-schedule";
import { toDateInputValue } from "@/lib/format";
import { classesView } from "@/lib/screens/classes";
import { programToday } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

/** A class's start as the page's `clock` reads it: the Tashkent wall clock kept in the UTC fields. */
const clock = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

const STATUSES = new Set(["SCHEDULED", "HELD", "CANCELLED"]);

/**
 * The Classes page as the app reads it: `classesView`, the page's own data, with what each class offers the reader
 * as the page's buttons do (Cancel on a booked class, which the action allows the mentor who booked it and an admin
 * who may change its program; Mark held on the reader's own once it has started). Null where the page is a 404.
 */
export async function classesFor(viewer: User, wanted: string): Promise<ApiClasses | null> {
  const view = await classesView(viewer, wanted);
  if (!view) return null;
  const write = await adminWriteScope(viewer);
  return {
    month: view.month,
    label: monthLabel(view.month) ?? view.month,
    thisMonth: view.thisMonth,
    prev: { month: view.prev, label: monthLabel(view.prev) ?? view.prev },
    next: { month: view.next, label: monthLabel(view.next) ?? view.next },
    staff: view.staffIds.length > 0,
    book: view.isMentor,
    students: view.students.map((t) => ({
      student: { id: t.studentId, name: view.names.get(t.studentId) ?? "" },
      classes: t.classes,
      booked: t.scheduled,
      held: t.held,
      total: t.total,
    })),
    total: view.grand,
    diary: view.rows.map((c) => {
      const mine = c.mentorId === viewer.id;
      const booked = c.status === "SCHEDULED";
      const started = c.startsAt.getTime() <= view.nowWall.getTime();
      return {
        id: c.id,
        student: { id: c.studentId, name: c.student.user.name ?? c.student.user.email },
        program: { id: c.programId, name: c.program.name },
        mentor: mine ? null : { id: c.mentor.id, name: c.mentor.name ?? c.mentor.email },
        day: toDateInputValue(c.startsAt),
        time: clock(c.startsAt),
        minutes: c.minutes,
        topic: c.topic,
        status: (STATUSES.has(c.status) ? c.status : "SCHEDULED") as ApiClasses["diary"][number]["status"],
        started,
        can: { cancel: booked && (mine || scopeCovers(write, c.programId)), held: booked && mine && started },
      };
    }),
    targets: view.targets.map((t) => {
      const [student, program] = t.value.split("|");
      return { student, program, name: t.label, hint: t.hint };
    }),
    today: programToday(),
  };
}
