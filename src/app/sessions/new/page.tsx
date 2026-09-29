import { redirect } from "next/navigation";

import { LogSessionForm, type LogSessionDraft } from "@/components/forms/log-session-form";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/section";
import {
  adminWriteScope,
  scopeIsEmpty,
  scopeProgramFilter,
} from "@/lib/authz";
import { canActAsMentor, USER_STATUS } from "@/lib/constants";
import { mentorsWhere } from "@/lib/filters";
import { requireMentor, requireUser } from "@/lib/dal";
import { dictationConfigured } from "@/lib/dictation";
import { prisma } from "@/lib/prisma";
import { logSessionOptions, mentorCaseload } from "@/lib/queries";

/**
 * Log a session, as a whole page.
 *
 * It was a card at the bottom of `/mentor`, under a greeting banner, six
 * lifetime figures, a program island grid and a nine-column table — about
 * 2,400px of scrolling on a phone before the thing a mentor actually opened
 * the app to do. On a phone a full page is the difference between a form you
 * can fill with one thumb and one you cannot, which is the whole reason this
 * route exists.
 *
 * Three query parameters, all optional:
 *   ?student=   preselect, from a student's page or an attention row
 *   ?mentor=    whose session this is, when an admin logs one for somebody
 *               else — see below
 *   the draft   whatever the form last wrote to the URL, so a phone
 *               interruption does not lose a half-written session
 *
 * An admin may log for any mentor in a program they administer. Mentors miss
 * meetings, leave, or simply never log; the hours were still delivered, and
 * until now the only way to get them into the ledger was the database. The
 * session is the MENTOR's — their name on the row, their allocation drawn
 * down, their student notified — and the admin is the hand that typed it.
 *
 * Whose caseload to load is therefore a server question, which is why the
 * mentor is a URL parameter rather than a field the form switches locally:
 * the students, their balances, their programs and their agendas are all
 * facts about that one mentor, and a picker that changed only the label would
 * be offering one mentor's students against another's hours.
 */
export default async function LogSessionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireUser();
  // The WRITE scope: this page is a form, and the only thing it does is spend
  // hours — a LEADER or SALES grant reads the program but does not log in it.
  const scope = await adminWriteScope(viewer);
  const administers = !scopeIsEmpty(scope);
  // The gate is unchanged for everybody else: a mentor, named, and assigned.
  const user = administers ? viewer : await requireMentor();
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value ? value : undefined;
  };

  if (!administers && user.status === USER_STATUS.UNASSIGNED) {
    // Nothing on this page can work, and the reason is not the mentor's to fix.
    redirect("/mentor");
  }

  // Mentors in the programs this admin holds — the only people they may put a
  // session's name to. An admin who mentors is in their own list, and is the
  // default, so the ordinary case is the form they have always seen.
  const mentors = administers
    ? await prisma.user.findMany({
        where: mentorsWhere({}, { programIds: scopeProgramFilter(scope) }),
        orderBy: [{ name: "asc" }, { email: "asc" }],
        select: { id: true, name: true, email: true },
      })
    : [];
  const named = one("mentor");
  const mentorId = administers
    ? (mentors.find((m) => m.id === named)?.id ??
      (canActAsMentor(user) ? user.id : ""))
    : user.id;
  const acting = mentors.find((m) => m.id === mentorId);
  const onBehalf = mentorId !== "" && mentorId !== user.id;

  const caseload = mentorId ? await mentorCaseload(mentorId) : null;
  const students = caseload
    ? logSessionOptions(caseload, {
        // Only when it is somebody else's time. "3h remaining with you" is
        // right for a mentor and a lie on an admin's screen.
        mentorName: onBehalf && acting ? (acting.name ?? acting.email) : undefined,
        // An admin logging for a mentor may only log into their own programs,
        // even where the mentor works in more.
        programIds: onBehalf ? scopeProgramFilter(scope) : undefined,
      })
    : [];

  // The student survives a change of mentor — somebody who arrived from a
  // student's file is still on that student's file afterwards — but only as
  // far as the new mentor reaches. A preselected id the picker cannot offer
  // would sit in a hidden input under a control reading "Select…", and the
  // first the admin heard of it would be the action refusing the submit.
  const wanted = one("student") ?? one("studentProfileId");
  const preselected =
    wanted && students.some((s) => s.profileId === wanted) ? wanted : undefined;

  // Their program and the agenda item are answers ABOUT that student, so they
  // go with them — and only with them: a `?program=` arriving on its own, from
  // a program's own page, still names the program the log should land in.
  const lost = Boolean(wanted) && !preselected;

  const draft: LogSessionDraft = {
    studentProfileId: preselected,
    programId: lost ? undefined : (one("programId") ?? one("program")),
    assignmentId: lost ? undefined : one("assignmentId"),
    minutes: one("minutes"),
    date: one("date"),
        note: one("note"),
    attendance: one("attendance"),
    timeKind: one("timeKind"),
  };

  // An admin who does not mentor has no /mentor to go back to — the ledger is
  // where they came from and the only one of the three that will let them in.
  const back = !canActAsMentor(user)
    ? "/sessions"
    : draft.studentProfileId
      ? `/students/${draft.studentProfileId}`
      : "/mentor";

  return (
    // Wider than the 2xl it was: the note and the three one-tap answers sit
    // side by side above `lg`, and at 42rem each column was too narrow to hold
    // "Attended / Came late / Absent / Rescheduled" on one row. Below `lg` the
    // form is one column and this cap never binds.
    <div className="max-w-4xl space-y-4">
      <PageTitle backHref={back} backLabel="Back" title="Log a session" />

      {students.length === 0 && mentors.length === 0 ? (
        <EmptyState variant="blocked" title="No students to log for">
          You are not assigned to a program with students in it yet.
        </EmptyState>
      ) : (
        <LogSessionForm
          // Remounted when the mentor changes: every answer below the picker
          // is about that mentor's caseload, and state held over from the last
          // one would be a student the new mentor cannot log for. The note,
          // the minutes and the date come back from the URL draft, so nothing
          // typed is lost with it.
          key={mentorId}
          students={students}
          mentors={mentors.map((m) => ({
            value: m.id,
            label: m.name ?? m.email,
            hint: m.id === user.id ? "You" : m.email,
          }))}
          mentorId={mentorId}
          studentPlaceholder={
            !mentorId
              ? "Pick a mentor first…"
              : students.length === 0
                ? "Nobody they can log for here"
                : undefined
          }
          mode="page"
          draft={draft}
                    correctBase="/sessions#session-"
          againHref="/sessions/new"
          canDictate={dictationConfigured()}
        />
      )}
    </div>
  );
}
