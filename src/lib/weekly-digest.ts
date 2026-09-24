import "server-only";

import { prisma } from "@/lib/prisma";
import {
  canActAsMentor,
  NOTIFICATION_TYPES,
  WEEKLY_SUMMARY_PREF,
  SESSION_STATUS,
  USER_STATUS,
} from "@/lib/constants";
import { notify } from "@/lib/notify";

import { deadlinePassed } from "@/lib/deadlines";
import { formatDate, formatDuration } from "@/lib/format";
import { daysAway } from "@/lib/when";
import { renderEmail, type Section } from "@/lib/email/layout";
import { appUrl, emailConfigured, sendAll, type Mail } from "@/lib/email/send";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";

/**
 * The Monday hours email: what each person redeemed last week, what is still
 * theirs to redeem, and when it expires.
 *
 * Runs from the weekly Render cron (see render.yaml → /api/cron/weekly-digest).
 * Composition happens entirely up front and mail is sent afterwards, never
 * inside a transaction — see the warning in lib/email/send.ts.
 *
 * Two queries feed every recipient. Calling allocationSummary()/mentorOverview()
 * per person would have been tidier to read and an N+1 of ~3 queries per
 * recipient; at a few hundred students that is a few thousand round trips for a
 * job that needs two. The forfeiture rules below are copied deliberately from
 * lib/hours.ts — one policy, and if it changes there it must change here.
 */

/** A digest looks back one week. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * How far ahead a deadline is called out. Wider than the 7-day in-app reminder
 * on purpose: a weekly email with a 7-day horizon can land the warning a single
 * day before hours expire.
 */
const SOON_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * Don't send twice inside this many days. Guards a re-run, a manual trigger, and
 * two instances firing at once — none of which should mean two emails.
 */
const RESEND_GUARD_MS = 6 * 24 * 60 * 60 * 1000;

type Pairing = {
  studentProfileId: string;
  studentUserId: string;
  studentLabel: string;
  studentActive: boolean;
  /** Null = the student's unassigned pool: hours with no mentor yet. */
  mentorId: string | null;
  mentorLabel: string;
  programName: string;
  allocated: number;
  deadline: Date;
  /** Hours drawn down: delivered plus no-shows, which are charged. */
  used: number;
  /** Time delivered in the last week only. */
  deliveredThisWeek: number;
  missedThisWeek: number;
  /** Last week's out-of-plan hours: delivered, but charged to no allocation. */
  extraThisWeek: number;
  expired: boolean;
  /** Unused hours lost to a passed deadline. */
  forfeited: number;
  /** What is still usable: never positive once the deadline has passed. */
  remaining: number;
};

/** Everything both digests are built from, gathered in two queries. */
async function loadPairings(now: Date): Promise<Pairing[]> {
  const weekAgo = new Date(now.getTime() - WEEK_MS);

  const [allocations, sessions] = await Promise.all([
    prisma.hourAllocation.findMany({
      include: {
        mentor: { select: { id: true, name: true, email: true } },
        // The grant names its own program now, so the digest reads it from the
        // row rather than from the student — who may be in more than one, and
        // whose other program's name would be the wrong one to print beside
        // these hours.
        program: { select: { name: true } },
        student: {
          include: {
            user: { select: { id: true, name: true, email: true, status: true } },
          },
        },
      },
    }),
    prisma.session.findMany({
      where: { status: SESSION_STATUS.ACTIVE },
      select: {
        studentId: true,
        programId: true,
        mentorId: true,
        minutes: true,
        attended: true,
        withinPlan: true,
        date: true,
      },
    }),
  ]);

  // One row per (student, program, mentor) — the key an allocation has, so a
  // student's Master's Program hours are never drawn down by a Global
  // Admissions session.
  const key = (studentId: string, programId: string, mentorId: string | null) =>
    `${studentId}:${programId}:${mentorId}`;
  const used = new Map<string, number>();
  const deliveredWeek = new Map<string, number>();
  const missedWeek = new Map<string, number>();
  const extraWeek = new Map<string, number>();
  const bump = (map: Map<string, number>, k: string, n: number) =>
    map.set(k, (map.get(k) ?? 0) + n);

  for (const s of sessions) {
    const k = key(s.studentId, s.programId, s.mentorId);
    // Out-of-plan hours draw nothing down, so they stay out of `used` — the
    // digest's whole subject is hours at risk of expiring unused.
    if (s.withinPlan) bump(used, k, s.minutes);
    if (s.date.getTime() >= weekAgo.getTime()) {
      if (!s.withinPlan) bump(extraWeek, k, s.minutes);
      else if (s.attended) bump(deliveredWeek, k, s.minutes);
      else bump(missedWeek, k, s.minutes);
    }
  }

  return allocations.map((a) => {
    const k = key(a.studentId, a.programId, a.mentorId);
    const drawn = used.get(k) ?? 0;
    const expired = deadlinePassed(a.deadline, now.getTime());
    return {
      studentProfileId: a.studentId,
      studentUserId: a.student.userId,
      studentLabel: a.student.user.name ?? a.student.user.email,
      studentActive: a.student.user.status === USER_STATUS.ACTIVE,
      mentorId: a.mentorId,
      mentorLabel: a.mentor
        ? (a.mentor.name ?? a.mentor.email)
        : "no mentor yet",
      programName: a.program.name,
      allocated: a.minutes,
      deadline: a.deadline,
      used: drawn,
      deliveredThisWeek: deliveredWeek.get(k) ?? 0,
      missedThisWeek: missedWeek.get(k) ?? 0,
      extraThisWeek: extraWeek.get(k) ?? 0,
      expired,
      forfeited: expired ? Math.max(0, a.minutes - drawn) : 0,
      remaining: expired ? Math.min(0, a.minutes - drawn) : a.minutes - drawn,
    };
  });
}

const soonest = (a: Pairing, b: Pairing) =>
  a.deadline.getTime() - b.deadline.getTime();

/** "by Aug 19" / "by Aug 19 — 3 days" once it is close. */
function deadlinePhrase(deadline: Date, now: Date): string {
  // Counted in program days: a use-by date is a whole Tashkent day, so the
  // 13th is "today" all through the 13th and "expired" only on the 14th.
  const days = daysAway(deadline, now);
  if (days < 0) return `expired ${formatDate(deadline)}`;
  if (days === 0) return `expires today, ${formatDate(deadline)}`;
  if (days === 1) return `expires tomorrow, ${formatDate(deadline)}`;
  if (days <= 14) return `by ${formatDate(deadline)} — ${days} days`;
  return `by ${formatDate(deadline)}`;
}

/**
 * The student's own digest, or null when there is nothing worth an email.
 *
 * Silence is a feature: a weekly mail that says "nothing happened, you have no
 * hours" every Monday trains people to filter the one that matters.
 */
function studentDigest(mine: Pairing[], now: Date): Mail | null {
  const live = mine.filter((p) => !p.expired && p.remaining > 0);
  const redeemed = mine.filter((p) => p.deliveredThisWeek > 0 || p.missedThisWeek > 0);
  const justExpired = mine.filter((p) => p.forfeited > 0);
  if (live.length === 0 && redeemed.length === 0 && justExpired.length === 0) {
    return null;
  }

  const totalRemaining = live.reduce((sum, p) => sum + p.remaining, 0);
  const redeemedHours = redeemed.reduce((sum, p) => sum + p.deliveredThisWeek, 0);
  const expiringSoon = live
    .filter((p) => p.deadline.getTime() - now.getTime() <= SOON_MS)
    .sort(soonest);

  const sections: Section[] = [];

  const missedMinutes = redeemed.reduce((sum, p) => sum + p.missedThisWeek, 0);
  sections.push({
    heading: "Last week",
    lines:
      redeemed.length === 0
        ? ["No sessions were logged for you last week."]
        : [
            // Says both numbers rather than one: a no-show draws hours down too,
            // so "2.5 used" while 3.5 left the balance is not the truth.
            missedMinutes > 0
              ? `${formatDuration(redeemedHours)} completed, and ${formatDuration(missedMinutes)} charged for a missed session.`
              : `${formatDuration(redeemedHours)} across ${redeemed.length} ${redeemed.length === 1 ? "mentor" : "mentors"}.`,
          ],
    rows: redeemed.map((p) => {
      // A week that was only a no-show would otherwise headline as "0h", which
      // reads like nothing happened when in fact hours were charged.
      const onlyMissed = p.deliveredThisWeek === 0 && p.missedThisWeek > 0;
      return {
        label: p.mentorLabel,
        value: `${formatDuration(onlyMissed ? p.missedThisWeek : p.deliveredThisWeek)}`,
        muted: onlyMissed
          ? "charged for a missed session"
          : p.missedThisWeek > 0
            ? `plus ${formatDuration(p.missedThisWeek)} charged for a missed session`
            : undefined,
        tone: onlyMissed ? ("urgent" as const) : undefined,
      };
    }),
  });

  if (live.length > 0) {
    sections.push({
      heading: "Remaining",
      lines: [`${formatDuration(totalRemaining)} in total.`],
      rows: [...live].sort(soonest).map((p) => ({
        label: p.mentorLabel,
        value: `${formatDuration(p.remaining)}`,
        muted: deadlinePhrase(p.deadline, now),
        // Expiring, not lost — amber. Red below is for hours already gone.
        tone:
          p.deadline.getTime() - now.getTime() <= SOON_MS
            ? ("urgent" as const)
            : undefined,
      })),
    });
  }

  if (justExpired.length > 0) {
    sections.push({
      heading: "Expired unused",
      lines: [
        "This time passed its deadline and can no longer be booked.",
      ],
      rows: justExpired.map((p) => ({
        label: p.mentorLabel,
        value: `${formatDuration(p.forfeited)}`,
        muted: `deadline was ${formatDate(p.deadline)}`,
        tone: "lost" as const,
      })),
    });
  }

  const urgent = expiringSoon[0];
  const subject = urgent
    ? `${formatDuration(urgent.remaining)} with ${urgent.mentorLabel} ${deadlinePhrase(urgent.deadline, now)}`
    : totalRemaining > 0
      ? `You have ${formatDuration(totalRemaining)} remaining to book`
      : "Your time last week";

  const to = mine[0];
  const { html, text } = renderEmail({
    preheader: urgent
      ? `Book them before ${formatDate(urgent.deadline)}.`
      : `${formatDuration(totalRemaining)} still available.`,
    title: subject,
    intro: `Your mentoring time in ${to.programName}, as of ${formatDate(now)}.`,
    sections,
    cta:
      live.length > 0
        ? {
            label: "Book a session",
            url: `${appUrl()}/student/book`,
            tone: "accent" as const,
          }
        : undefined,
    unsubscribeUrl: unsubscribeUrl(to.studentUserId),
    footerNote: "You're getting this because you have mentoring time with Freshman Academy.",
  });

  return {
    to: "", // filled in by the caller, which holds the address
    subject,
    html,
    text,
    unsubscribeUrl: unsubscribeUrl(to.studentUserId),
  };
}

/** The mentor's digest: what they delivered, and who is still waiting. */
function mentorDigest(mine: Pairing[], now: Date): Mail | null {
  // `mine` is one mentor's pairings, so the id is never actually null — the
  // unassigned pool belongs to no mentor and can't be in anyone's `mine`.
  const mentorId = mine[0]?.mentorId;
  if (!mentorId) return null;
  const live = mine.filter((p) => !p.expired && p.remaining > 0);
  const logged = mine.filter(
    (p) => p.deliveredThisWeek > 0 || p.missedThisWeek > 0
  );
  const expiringSoon = live
    .filter((p) => p.deadline.getTime() - now.getTime() <= SOON_MS)
    .sort(soonest);
  const justExpired = mine.filter((p) => p.forfeited > 0);
  if (live.length === 0 && logged.length === 0 && justExpired.length === 0) {
    return null;
  }

  const deliveredMinutes = logged.reduce((sum, p) => sum + p.deliveredThisWeek, 0);
  const missedMinutes = logged.reduce((sum, p) => sum + p.missedThisWeek, 0);
  const owed = live.reduce((sum, p) => sum + p.remaining, 0);

  const sections: Section[] = [
    {
      heading: "You logged last week",
      lines:
        logged.length === 0
          ? ["No sessions logged last week."]
          : [
              missedMinutes > 0
                ? `${formatDuration(deliveredMinutes)} completed, and ${formatDuration(missedMinutes)} charged for a missed session.`
                : `${formatDuration(deliveredMinutes)} across ${logged.length} ${logged.length === 1 ? "student" : "students"}.`,
            ],
      rows: logged.map((p) => {
        const onlyMissed = p.deliveredThisWeek === 0 && p.missedThisWeek > 0;
        return {
          label: p.studentLabel,
          value: `${formatDuration(onlyMissed ? p.missedThisWeek : p.deliveredThisWeek)}`,
          muted: onlyMissed
            ? `${p.programName} · no-show, time still charged`
            : p.missedThisWeek > 0
              ? `${p.programName} · plus ${formatDuration(p.missedThisWeek)} for a no-show`
              : p.programName,
          tone: onlyMissed ? ("urgent" as const) : undefined,
        };
      }),
    },
  ];

  if (live.length > 0) {
    sections.push({
      heading: "Remaining",
      lines: [
        `${formatDuration(owed)} across ${live.length} ${live.length === 1 ? "student" : "students"}, soonest deadline first.`,
      ],
      rows: [...live].sort(soonest).map((p) => ({
        label: p.studentLabel,
        value: `${formatDuration(p.remaining)}`,
        muted: `${p.programName} · ${deadlinePhrase(p.deadline, now)}`,
        tone:
          p.deadline.getTime() - now.getTime() <= SOON_MS
            ? ("urgent" as const)
            : undefined,
      })),
    });
  }

  if (justExpired.length > 0) {
    sections.push({
      heading: "Expired unused",
      lines: [
        "These deadlines passed with time unspent, so no new sessions can be logged against them.",
      ],
      rows: justExpired.map((p) => ({
        label: p.studentLabel,
        value: `${formatDuration(p.forfeited)}`,
        muted: `deadline was ${formatDate(p.deadline)}`,
        tone: "lost" as const,
      })),
    });
  }

  const subject =
    expiringSoon.length > 0
      ? `${expiringSoon.length} ${expiringSoon.length === 1 ? "student's time expire" : "students' time expires"} within two weeks`
      : owed > 0
        ? `${formatDuration(owed)} remaining`
        : "Your week in minutes";

  const { html, text } = renderEmail({
    preheader:
      expiringSoon.length > 0
        ? `Soonest: ${expiringSoon[0].studentLabel}, ${formatDate(expiringSoon[0].deadline)}.`
        : `${formatDuration(deliveredMinutes)} completed last week.`,
    title: subject,
    intro: `Your mentoring week, as of ${formatDate(now)}.`,
    sections,
    cta: { label: "Open your dashboard", url: `${appUrl()}/mentor` },
    unsubscribeUrl: unsubscribeUrl(mentorId),
    footerNote: "You're getting this because you mentor students at Freshman Academy.",
  });

  return {
    to: "",
    subject,
    html,
    text,
    unsubscribeUrl: unsubscribeUrl(mentorId),
  };
}

export type DigestResult = {
  live: boolean;
  students: number;
  mentors: number;
  sent: number;
  failed: number;
  skippedRecently: number;
  nothingToSay: number;
  errors: string[];
  /** Only present for a preview run: what would have gone out, unsent. */
  preview?: { to: string; subject: string; html: string; text: string }[];
};

/**
 * Compose and send this week's digests.
 *
 * `only` restricts the run to one address, for a real send to yourself before
 * turning the cron loose on everybody. `preview` composes and returns the mail
 * without sending it or stamping anybody — the way to read what a change to the
 * copy actually produces, against real data, without mailing hundreds of people.
 */
export async function sendWeeklyDigest({
  now = new Date(),
  only,
  force = false,
  preview = false,
}: {
  now?: Date;
  only?: string;
  force?: boolean;
  preview?: boolean;
} = {}): Promise<DigestResult> {
  const pairings = await loadPairings(now);

  // The preference row is the answer; the column is the fallback for anybody
  // who has never opened /settings and therefore has no row. They agree today
  // — the migration seeded one from the other — and the column goes one
  // release after the last emailed unsubscribe link has aged out.
  const recipients = await prisma.user.findMany({
    where: {
      status: USER_STATUS.ACTIVE,
      OR: [
        {
          notificationPrefs: {
            some: { category: WEEKLY_SUMMARY_PREF, email: true },
          },
        },
        {
          weeklyDigest: true,
          notificationPrefs: { none: { category: WEEKLY_SUMMARY_PREF } },
        },
      ],
      ...(only ? { email: only.toLowerCase() } : {}),
    },
    select: {
      id: true,
      email: true,
      role: true,
      isMentor: true,
      digestSentAt: true,
      studentProfile: { select: { id: true } },
    },
  });

  const mails: (Mail & { userId: string })[] = [];
  let skippedRecently = 0;
  let nothingToSay = 0;
  let students = 0;
  let mentors = 0;

  for (const user of recipients) {
    const stamp = user.digestSentAt?.getTime() ?? 0;
    // A preview ignores the guard: it sends nothing, so there is nothing to
    // double-send, and being unable to look at this week's mail because it
    // already went out would defeat the point.
    if (!force && !preview && now.getTime() - stamp < RESEND_GUARD_MS) {
      skippedRecently += 1;
      continue;
    }

    // A dual-role admin-mentor gets the mentor digest; nobody is both here,
    // because a student account never also mentors.
    const asStudent = user.studentProfile
      ? pairings.filter((p) => p.studentProfileId === user.studentProfile!.id)
      : [];
    const asMentor = canActAsMentor(user)
      ? pairings.filter((p) => p.mentorId === user.id)
      : [];

    const mail =
      asStudent.length > 0
        ? studentDigest(asStudent, now)
        : asMentor.length > 0
          ? mentorDigest(asMentor, now)
          : null;

    if (!mail) {
      nothingToSay += 1;
      continue;
    }
    if (asStudent.length > 0) students += 1;
    else mentors += 1;
    mails.push({ ...mail, to: user.email, userId: user.id });
  }

  if (preview) {
    return {
      live: emailConfigured(),
      students,
      mentors,
      sent: 0,
      failed: 0,
      skippedRecently,
      nothingToSay,
      errors: [],
      preview: mails.map((m) => ({
        to: m.to,
        subject: m.subject,
        html: m.html,
        text: m.text,
      })),
    };
  }

  // Stamped one at a time as each send succeeds, so a crash or a rate-limit
  // wall halfway through does not re-mail everyone who already got theirs.
  const { sent, failed, errors } = await sendAll(mails, async (mail) => {
    const userId = (mail as Mail & { userId: string }).userId;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { digestSentAt: now },
      });
      // The same summary, in the feed. An email is the only place this
      // existed, so anybody who had switched it off — or whose address
      // bounced — had no way to see the week at all.
      await notify(tx, {
        to: [userId],
        type: NOTIFICATION_TYPES.WEEKLY_SUMMARY,
        message: (mail as Mail & { subject: string }).subject,
        href: "/notifications",
      });
    });
  });

  return {
    live: emailConfigured(),
    students,
    mentors,
    sent,
    failed,
    skippedRecently,
    nothingToSay,
    errors,
  };
}
