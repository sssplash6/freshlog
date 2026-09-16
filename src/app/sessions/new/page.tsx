import { redirect } from "next/navigation";

import { LogSessionForm, type LogSessionDraft } from "@/components/forms/log-session-form";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/section";
import { USER_STATUS } from "@/lib/constants";
import { requireMentor } from "@/lib/dal";
import { dictationConfigured } from "@/lib/dictation";
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
 * Two query parameters, both optional:
 *   ?student=   preselect, from a student's page or an attention row
 *   the draft   whatever the form last wrote to the URL, so a phone
 *               interruption does not lose a half-written session
 */
export default async function LogSessionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireMentor();
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value ? value : undefined;
  };

  if (user.status === USER_STATUS.UNASSIGNED) {
    // Nothing on this page can work, and the reason is not the mentor's to fix.
    redirect("/mentor");
  }

  const caseload = await mentorCaseload(user.id);
  const students = logSessionOptions(caseload);

  const draft: LogSessionDraft = {
    studentProfileId: one("student") ?? one("studentProfileId"),
    programId: one("programId") ?? one("program"),
    assignmentId: one("assignmentId"),
    minutes: one("minutes"),
    date: one("date"),
        note: one("note"),
    attendance: one("attendance"),
    timeKind: one("timeKind"),
  };

  const back = draft.studentProfileId
    ? `/mentor/students/${draft.studentProfileId}`
    : "/mentor";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle backHref={back} backLabel="Back" title="Log a session" />

      {students.length === 0 ? (
        <EmptyState variant="blocked" title="No students to log for">
          You are not assigned to a program with students in it yet.
        </EmptyState>
      ) : (
        <LogSessionForm
          students={students}
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
