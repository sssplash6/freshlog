import "server-only";

import { personOf, slotTime } from "@/lib/api/v1/practice";
import type { Classmate } from "@/lib/api/v1/types";
import { studiesIn } from "@/lib/enrollments";
import { INTERVIEW_TEMPLATES } from "@/lib/interview-templates";
import type { InterviewViewer } from "@/lib/interview-viewer";
import { interviewPersonData } from "@/lib/screens/interviews";

/**
 * Somebody to practise with, as their people page shows them in the reader's
 * capacity (`interviewPersonData`, the page's own read): their name, their own
 * programs (to a reader who may book their student times), "Your mentor", and
 * the times the reader may book. Somebody the reader may not book and somebody
 * who does not exist are the same 404; the reader's own id is too.
 */
export async function classmateFor(viewer: InterviewViewer, id: string): Promise<Classmate | null> {
  if (id === viewer.user.id) return null;
  const found = await interviewPersonData(viewer, id);
  if (!found) return null;
  const { person, asStudent, asMentor } = found;
  return {
    id: person.id,
    person: personOf(person),
    mentor: asMentor,
    shared: asStudent ? studiesIn(person.studentProfile?.enrollments ?? []).map((e) => e.program.name) : [],
    slots: person.interviewSlots.filter((s) => (s.asMentor ? asMentor : asStudent)).map((s) => ({ id: s.id, when: slotTime(s) })),
    templates: INTERVIEW_TEMPLATES.map((t) => ({ id: t.id, name: t.name, summary: t.summary })),
  };
}
