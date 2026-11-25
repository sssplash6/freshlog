import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { logSession } from "@/lib/actions/sessions";
import { parseDateField } from "@/lib/actions/shared";
import { matchCall, callMinutes, parseCallReport, type CallMatch } from "@/lib/call-match";
import { CLASS_STATUS } from "@/lib/class-schedule";
import { SESSION_STATUS, USER_STATUS } from "@/lib/constants";
import { getCurrentUser, requireMentor } from "@/lib/dal";
import { loginFor } from "@/lib/safe-next";
import { prisma } from "@/lib/prisma";
import { logSessionOptions, mentorCaseload } from "@/lib/queries";
import { programToday, programWallClock } from "@/lib/when";

const HOUR = 60 * 60 * 1000;

/**
 * Where the mentor's call extension sends them when a Meet call ends.
 *
 * A route, not a page: nobody should see it. It reads the call out of the URL, works out which
 * of the mentor's students it was (`lib/call-match.ts`), and then one of two
 * things:
 *
 *   - The student's Freshlog email was in their Meet name, and nothing else is
 *     in doubt (one program, not already logged that day): it logs the session
 *     itself, through `logSession` like any other, and opens it on Sessions
 *     for the mentor to correct if they need to.
 *   - Anything less certain: it sends them on to Log a session with the length,
 *     the day, the student and how it went filled in, for them to save.
 *
 * Only the first writes, and it writes once: opening the same call again (a
 * reload, a restored tab) finds the session it already logged that day and
 * falls back to the form, which says nothing new.
 *
 * The extension holds no login. It opens this address in the mentor's own
 * browser, so the gate below is the ordinary session cookie and a call can only
 * ever be laid against the caseload of whoever is signed in. A link forwarded
 * to somebody else opens THEIR form with a guess from THEIR students, which is
 * to say nothing at all leaks.
 *
 * A route handler rather than a page so the answer is a plain 307: under
 * `/sessions` a page streams behind its loading skeleton, and its redirect
 * arrives as a flash of skeleton and a meta refresh.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Signed out (or a cookie that no longer decrypts, which the proxy cannot
  // tell from a good one): sign in and come back to THIS call, rather than
  // to the home page with the call forgotten.
  if (!(await getCurrentUser())) {
    redirect(loginFor(`${request.nextUrl.pathname}${request.nextUrl.search}`));
  }
  const user = await requireMentor();
  if (user.status === USER_STATUS.UNASSIGNED) redirect("/mentor");

  const params: Record<string, string | string[]> = {};
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    const all = request.nextUrl.searchParams.getAll(key);
    params[key] = key === "p" ? all : all[0];
  }
  const report = parseCallReport(params, Date.now());
  if (!report) redirect("/sessions/new");

  // Only students the form will offer: a preselected id it cannot offer would
  // sit under a picker reading "Select…", and the first anybody heard of it
  // would be the action refusing the save.
  const options = logSessionOptions(await mentorCaseload(user.id));
  const emails = new Map(
    (
      await prisma.studentProfile.findMany({
        where: { id: { in: options.map((s) => s.profileId) } },
        select: { id: true, user: { select: { email: true } } },
      })
    ).map((p) => [p.id, p.user.email]),
  );
  const students = options.map((s) => ({
    profileId: s.profileId,
    name: s.label,
    programIds: s.programs.map((p) => p.value),
    email: emails.get(s.profileId),
  }));

  // The day's diary around the call, in the wall clock classes are stored in.
  const wallStart = programWallClock(new Date(report.start));
  const wallEnd = programWallClock(new Date(report.end));
  const classes = await prisma.scheduledClass.findMany({
    where: {
      mentorId: user.id,
      status: CLASS_STATUS.SCHEDULED,
      startsAt: {
        gte: new Date(wallStart.getTime() - 12 * HOUR),
        lte: new Date(wallEnd.getTime() + HOUR),
      },
    },
    select: { id: true, studentId: true, programId: true, startsAt: true, minutes: true },
  });

  const match = matchCall({
    report,
    students,
    classes,
    mentorName: user.name,
    wallOffsetMs: wallStart.getTime() - report.start,
  });

  const minutes = callMinutes(report);
  const date = programToday(new Date(report.start));

  // A redirect inside the try would be caught as an error; it waits until after.
  const logged = await logByItself(user.id, match, minutes, date);
  if (logged) redirect(`/sessions?edit=${logged}#session-${logged}`);

  // `studentProfileId`, not `student`: `?student=` means "came from this
  // student's page" to the form, and would point its Back link there.
  const next = new URLSearchParams();
  next.set("minutes", String(minutes));
  next.set("date", date);
  if (match.studentProfileId) next.set("studentProfileId", match.studentProfileId);
  if (match.programId) next.set("programId", match.programId);
  if (match.attendance) next.set("attendance", match.attendance);
  if (match.classId) next.set("classId", match.classId);
  next.set("call", `${clock(wallStart)}–${clock(wallEnd)}`);
  redirect(`/sessions/new?${next}`);
}

/**
 * Log the call without the mentor, when the student is certain: matched on the
 * email in their Meet name, in one program, and with nothing from this mentor
 * in that program on that day yet. Returns the new session's id, or null to
 * fall back to the form.
 */
async function logByItself(
  mentorId: string,
  match: CallMatch,
  minutes: number,
  date: string,
): Promise<string | null> {
  if (match.via !== "email" || !match.studentProfileId || !match.programId) return null;

  const day = parseDateField(date);
  if ("error" in day) return null;
  const already = await prisma.session.count({
    where: {
      mentorId,
      studentId: match.studentProfileId,
      programId: match.programId,
      status: { not: SESSION_STATUS.VOIDED },
      date: { gte: day.value, lt: new Date(day.value.getTime() + 24 * HOUR) },
    },
  });
  if (already > 0) return null;

  const form = new FormData();
  form.set("studentProfileId", match.studentProfileId);
  form.set("programId", match.programId);
  form.set("minutes", String(minutes));
  form.set("date", date);
  if (match.attendance) form.set("attendance", match.attendance);
  if (match.classId) form.set("classId", match.classId);
  try {
    const result = await logSession(null, form);
    return result?.ok && result.receipt ? result.receipt.id : null;
  } catch (error) {
    // Whatever went wrong, the form can still log it by hand.
    console.error("from-call: could not log by itself", error);
    return null;
  }
}

/** "15:02", from a program wall clock. */
function clock(wall: Date): string {
  return `${String(wall.getUTCHours()).padStart(2, "0")}:${String(wall.getUTCMinutes()).padStart(2, "0")}`;
}
