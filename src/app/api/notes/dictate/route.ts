import type { User } from "@/generated/prisma/client";

import { mentorReaches } from "@/lib/authz";
import { canActAsMentor, ROLES, USER_STATUS } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";
import { dictateNote, MAX_AUDIO_BYTES, type DictationKind } from "@/lib/dictation";
import { sideOf } from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";

// Reads the session and the database on every request; never prerender.
export const dynamic = "force-dynamic";

/**
 * Turn a spoken note into text for the box somebody is typing into: a
 * mentor's session note, a student's notes on a practice interview, or their
 * spoken answer to a practice question.
 *
 * A route handler rather than a server action, for two reasons. The result has
 * to land in a form that has NOT been submitted — the mentor is still choosing
 * a student and a date — so this is a fetch from the client, not a form post.
 * And server action bodies are capped at 1MB by default, which forty-five
 * seconds of 16kHz audio can exceed.
 *
 * Writes nothing, anywhere. The audio is read into memory, sent on, and
 * dropped when the request ends; the text goes back in the response and only
 * becomes a `Session.note` if the mentor saves the form themselves.
 */
export async function POST(request: Request) {
  // Gated here and not by the page that renders the button: a route answers
  // anyone who knows its address, and "the UI does not show it" has never
  // been a permission check.
  const actor = await getCurrentUser();
  if (!actor || actor.status !== USER_STATUS.ACTIVE) {
    return Response.json(
      { ok: false, error: "You are not signed in." },
      { status: 401 }
    );
  }

  const form = await request.formData();

  // Who may dictate, and about what. A mentor dictates session notes. A
  // student dictates only the notes on a practice interview they are one of
  // the two people in — named in the request and checked here, so the
  // endpoint is not a free transcriber for anyone with a student account.
  let kind: DictationKind;
  let names: string[];
  if (canActAsMentor(actor)) {
    kind = "session";
    names = await nameHints(actor, form);
  } else if (actor.role === ROLES.STUDENT) {
    const partner = await interviewPartner(actor, form);
    if (partner === null) {
      return Response.json(
        { ok: false, error: "Dictation works on your own interview notes." },
        { status: 403 }
      );
    }
    kind = form.get("purpose") === "answer" ? "answer" : "interview";
    names = partner ? [partner] : [];
  } else {
    return Response.json(
      { ok: false, error: "You are not signed in as a mentor or a student." },
      { status: 401 }
    );
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json(
      { ok: false, error: "No recording arrived." },
      { status: 400 }
    );
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json(
      { ok: false, error: "That recording is too long. Keep it under two minutes." },
      { status: 413 }
    );
  }

  const result = await dictateNote(audio, names, kind);
  return Response.json(result, { status: result.ok ? 200 : 502 });
}

/**
 * Words the transcriber cannot infer from context: the student's name, and the
 * names of the programs they are in. They are hints rather than spelling
 * rules, and they are what stops "Imkon" coming back as "income".
 *
 * Looked up rather than accepted from the request, and only for a student this
 * mentor actually reaches — otherwise the hints are silently dropped. A name
 * posted by the browser would be a name this endpoint repeats back into a
 * transcript on nothing but the browser's word.
 */
async function nameHints(actor: User, form: FormData): Promise<string[]> {
  const studentProfileId = String(form.get("studentProfileId") ?? "").trim();
  if (!studentProfileId) return [];
  if (!(await mentorReaches(actor, { id: studentProfileId }))) return [];

  const profile = await prisma.studentProfile.findUnique({
    where: { id: studentProfileId },
    select: {
      user: { select: { name: true } },
      enrollments: { select: { program: { select: { name: true } } } },
    },
  });
  if (!profile) return [];

  return [
    profile.user?.name ?? "",
    ...profile.enrollments.map((enrollment) => enrollment.program.name),
  ].filter(Boolean);
}

/**
 * The classmate on the other side of the student's practice interview, as a
 * spelling hint — or null when the request names no interview this student is
 * in, which refuses the request outright. An empty string is "yours, but the
 * classmate has no name set".
 */
async function interviewPartner(actor: User, form: FormData): Promise<string | null> {
  const interviewId = String(form.get("interviewId") ?? "").trim();
  if (!interviewId) return null;

  const [profile, interview] = await Promise.all([
    prisma.studentProfile.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    }),
    prisma.peerInterview.findUnique({
      where: { id: interviewId },
      select: {
        hostId: true,
        guestId: true,
        host: { select: { user: { select: { name: true } } } },
        guest: { select: { user: { select: { name: true } } } },
      },
    }),
  ]);
  if (!profile || !interview) return null;

  const side = sideOf(interview, profile.id);
  if (!side) return null;
  const other = side === "host" ? interview.guest : interview.host;
  return other.user.name ?? "";
}
