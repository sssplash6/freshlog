import { redirect } from "next/navigation";

import { LogSessionForm, type LogSessionDraft } from "@/components/forms/log-session-form";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/section";
import {
  adminWriteScope,
  canManageStudent,
  mentorReaches,
  scopeIsEmpty,
  scopeProgramFilter,
} from "@/lib/authz";
import { canActAsMentor, USER_STATUS } from "@/lib/constants";
import { mentorsWhere } from "@/lib/filters";
import { requireMentor, requireUser } from "@/lib/dal";
import { dictationConfigured } from "@/lib/dictation";
import { prisma } from "@/lib/prisma";
import { logSessionOptions, mentorCaseload } from "@/lib/queries";
import type { User } from "@/generated/prisma/client";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Log a session" };

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
  // `?program=`, from a program's own page: the log is for that program, so
  // the pickers offer only its people. Honoured only inside this reader's
  // reach — anything else is ignored rather than refused, as the form was.
  const asked = one("program");
  const mentors = administers
    ? await prisma.user.findMany({
        where: mentorsWhere(
          asked ? { program: asked } : {},
          { programIds: scopeProgramFilter(scope) },
        ),
        orderBy: [{ name: "asc" }, { email: "asc" }],
        select: { id: true, name: true, email: true },
      })
    : [];
  const named = one("mentor");
  // An admin names the mentor; the form does not guess. It defaulted to the
  // admin themselves whenever they mentored too, and an admin logging a
  // session somebody else ran — the reason this picker exists — submitted it
  // under their own name unless they noticed the field. The one exception is
  // a picker of one, which is no question at all.
  const mentorId = administers
    ? (mentors.find((m) => m.id === named)?.id ??
      (mentors.length === 1 ? mentors[0].id : ""))
    : user.id;
  const acting = mentors.find((m) => m.id === mentorId);
  const onBehalf = mentorId !== "" && mentorId !== user.id;

  const caseload = mentorId ? await mentorCaseload(mentorId) : null;
  const reachable = caseload
    ? logSessionOptions(caseload, {
        // Only when it is somebody else's time. "3h remaining with you" is
        // right for a mentor and a lie on an admin's screen.
        mentorName: onBehalf && acting ? (acting.name ?? acting.email) : undefined,
        // An admin logging for a mentor may only log into their own programs,
        // even where the mentor works in more.
        programIds: onBehalf ? scopeProgramFilter(scope) : undefined,
      })
    : [];
  // Named when it is one this page may log into: a program the admin
  // administers, or one the mentor has a student in.
  const program = !asked
    ? null
    : administers && (scope === "ALL" || scope.has(asked))
      ? await prisma.program.findUnique({
          where: { id: asked },
          select: { id: true, name: true },
        })
      : (reachable
          .flatMap((s) => s.programs)
          .map((p) => ({ id: p.value, name: p.label }))
          .find((p) => p.id === asked) ?? null);
  const students = program
    ? reachable.filter((s) => s.programs.some((p) => p.value === program.id))
    : reachable;

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
  //
  // Back follows where the reader came FROM, which is not who the form has
  // picked: `?student=` is the student page's own link, while the draft writes
  // `studentProfileId` as the form is filled in. Back used to follow the
  // draft, so an admin who opened this from a program's page, picked a student
  // and logged was sent Back to that student without the program — and from
  // there to the whole school's list.
  const cameFrom = one("student");
  const backStudent = cameFrom
    ? (students.find((s) => s.profileId === cameFrom) ??
      (await cameFromStudent(viewer, cameFrom)))
    : undefined;
  // `?from=`, passed on from a student page opened through a program's
  // roster, so the way back is still that page — whose Back is still the
  // program. The student page checks it; this page only carries it.
  const from = one("from");
  const fromQuery = from ? `?from=${encodeURIComponent(from)}` : "";
  // `?back=sessions`, from the Sessions list: Back returns to it, keeping the
  // program it was filtered to.
  const fromList = one("back") === "sessions";
  const listHref = `/sessions${asked ? `?program=${encodeURIComponent(asked)}` : ""}`;
  // "Log another" keeps where this form came from, so its Back is the same.
  const againQuery = new URLSearchParams();
  if (cameFrom) againQuery.set("student", cameFrom);
  if (from) againQuery.set("from", from);
  if (fromList) againQuery.set("back", "sessions");
  if (asked) againQuery.set("program", asked);
  const againHref = `/sessions/new${againQuery.size ? `?${againQuery}` : ""}`;
  // Opened from a program's own page (`?program=`), an admin of it goes back
  // there; it said "Home" and left them on their dashboard.
  const backProgram =
    !backStudent && program && administers && (scope === "ALL" || scope.has(program.id))
      ? program
      : undefined;
  const back = backStudent
    ? `/students/${backStudent.profileId}${fromQuery}`
    : fromList
      ? listHref
      : backProgram
      ? `/programs/${backProgram.id}`
      : !canActAsMentor(user)
      ? "/sessions"
      : "/mentor";
  // Named for where it goes, the way every other back row in the app is. It
  // said "Back" here and "‹ Home" in the phone's top bar for the same link.
  const backLabel = backStudent
    ? backStudent.label
    : fromList
      ? "Sessions"
      : backProgram
      ? backProgram.name
      : back === "/sessions"
      ? "Sessions"
      : "Home";

  // Only the title changes in a program that logs hours as classes.
  const programIds = draft.programId
    ? [draft.programId]
    : preselected
      ? (
          await prisma.studentEnrollment.findMany({
            where: { studentId: preselected },
            select: { programId: true },
          })
        ).map((e) => e.programId)
      : [];
  const forGroup =
    programIds.length > 0 &&
    (await prisma.program.count({
      where: { id: { in: programIds }, classHours: false },
    })) === 0;

  return (
    // Wider than the 2xl it was: the note and the three one-tap answers sit
    // side by side above `lg`, and at 42rem each column was too narrow to hold
    // "Attended / Came late / Absent / Rescheduled" on one row. Below `lg` the
    // form is one column and this cap never binds.
    <div className="max-w-4xl space-y-4">
      <PageTitle
        backHref={back}
        backLabel={backLabel}
        title={forGroup ? "Log an hour for a group" : "Log a session"}
        subtitle={program ? `In ${program.name}` : undefined}
      />

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
                ? onBehalf
                  ? "Nobody they can log for here"
                  : "Nobody you can log for here"
                : undefined
          }
          mode="page"
          draft={draft}
                    correctBase="/sessions"
          againHref={againHref}
          // The receipt links the student, and that page's Back needs to know
          // which program it was reached through: the one the reader came
          // from, or — opened from a program's own page — that program.
          from={from ?? (program && administers && (scope === "ALL" || scope.has(program.id)) ? program.id : undefined)}
          pageProgram={program?.id ?? from}
          canDictate={dictationConfigured()}
        />
      )}
    </div>
  );
}

/**
 * The student a `?student=` link came from, when the form cannot offer them.
 *
 * An admin names the mentor before the picker has anybody in it, so an admin
 * who pressed Log a session on a student's page arrives with an empty picker
 * and the student only in the URL — and Back, which needed the picker's row,
 * fell through to Home or to Sessions. Back is where the reader came from, not
 * who the form can offer. Asked with the student page's own gate, so a link
 * never names a student this reader could not open.
 */
async function cameFromStudent(viewer: User, profileId: string | undefined) {
  if (!profileId) return undefined;
  const profile = await prisma.studentProfile.findUnique({
    where: { id: profileId },
    include: { user: true, enrollments: { select: { programId: true } } },
  });
  if (!profile) return undefined;
  const opens =
    (await canManageStudent(viewer, profile)) ||
    (canActAsMentor(viewer) && (await mentorReaches(viewer, profile)));
  return opens
    ? { profileId: profile.id, label: profile.user.name ?? profile.user.email }
    : undefined;
}
