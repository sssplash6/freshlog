/**
 * A video call, as the mentor's browser extension saw it, turned into the
 * session it probably was.
 *
 * The extension (`extension/` at the repo root) watches the mentor's own Meet
 * tab: when they joined, when they left, and the names on the tiles. It knows
 * nothing about students, programs or hours, and it holds no credentials — it
 * opens `/sessions/from-call` in the mentor's signed-in browser, and this file
 * is how that page decides what to put in the form.
 *
 * A guess only PREFILLS: the mentor reads the form and presses Save. A guess
 * that logged itself would spend a student's hours on a call that was a staff
 * meeting with a namesake.
 *
 * The one thing that is not a guess is an email. Students are asked to put the
 * email they sign in to Freshlog with in their Meet name ("Aziz Karimov
 * aziz@gmail.com"), and a match on it is `via: "email"`, which the route logs
 * by itself (`/sessions/from-call`). It still goes through `logSession` like
 * any other: the same gates, the same ledger, the same notice to the student,
 * who can dispute it.
 *
 * Pure: no database, no clock. The page fetches the candidates and hands them in.
 */

import { ATTENDANCE, MAX_SESSION_MINUTES } from "@/lib/constants";

const MINUTE = 60 * 1000;

/** At most this many names travel in the URL. A lesson is two or three people. */
export const MAX_CALL_PEOPLE = 15;
// Room for a full name and an email: "Malika Xoliqova malika.xoliqova@gmail.com".
const MAX_NAME_LENGTH = 100;

/**
 * How late counts as late. A student who joined within this of the class's
 * start is on time — Meet's own lobby and a slow laptop take a minute or two.
 */
export const LATE_AFTER_MINUTES = 5;

/**
 * How early a call may start and still be that class. Mentors open the room
 * before the hour; a call that began half an hour before a class is that class.
 */
const EARLY_SLACK_MINUTES = 30;

export type CallPerson = { name: string; firstSeen: number };

/** What the extension reports. Every time is a real instant, in ms. */
export type CallReport = {
  start: number;
  end: number;
  /** The Meet code, "abc-defg-hij". Carried for the record; nothing keys on it. */
  code?: string;
  people: CallPerson[];
};

type Params = Record<string, string | string[] | undefined>;

/**
 * The report out of `/sessions/from-call`'s query string, or null when it is
 * not one: a start, an end after it, inside the last fortnight.
 *
 *   ?start=<ms>&end=<ms>&code=abc-defg-hij&p=<firstSeenMs>~<display name>&p=…
 */
export function parseCallReport(params: Params, now: number): CallReport | null {
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" ? v : undefined;
  };
  const start = Number(one("start"));
  const end = Number(one("end"));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end <= start) return null;
  // A call from the future, or from before the extension could have seen it,
  // is a hand-typed URL rather than a report.
  if (start > now + 5 * MINUTE || start < now - 14 * 24 * 60 * MINUTE) return null;

  const raw = params.p;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const people: CallPerson[] = [];
  for (const item of list.slice(0, MAX_CALL_PEOPLE)) {
    const cut = item.indexOf("~");
    if (cut < 1) continue;
    const firstSeen = Number(item.slice(0, cut));
    const name = item.slice(cut + 1).trim().slice(0, MAX_NAME_LENGTH);
    if (!Number.isFinite(firstSeen) || !name) continue;
    people.push({ name, firstSeen });
  }

  const code = one("code");
  return {
    start,
    end,
    code: code && /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code) ? code : undefined,
    people,
  };
}

/** The call's length in whole minutes, inside what one session may be. */
export function callMinutes(report: CallReport): number {
  const minutes = Math.round((report.end - report.start) / MINUTE);
  return Math.min(Math.max(minutes, 1), MAX_SESSION_MINUTES);
}

// Uzbek and Russian Cyrillic to the Latin the roster is mostly typed in, so a
// student whose Google account says "Азиз Каримов" is still Aziz Karimov.
const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ғ: "g", д: "d", е: "e", ё: "yo", ж: "j",
  з: "z", и: "i", й: "y", к: "k", қ: "q", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ў: "o", ф: "f", х: "x", ҳ: "h",
  ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu",
  я: "ya",
};

/**
 * A name as comparable words: lowercased, accents and apostrophes dropped,
 * Cyrillic spelled in Latin, and "kh" read as the "x" Uzbek Latin writes.
 */
export function nameTokens(name: string): string[] {
  const latin = [...name.normalize("NFKD").toLowerCase()]
    .map((ch) => CYRILLIC[ch] ?? ch)
    .join("")
    .replace(/[̀-ͯ'ʻʼ`’‘]/g, "")
    .replace(/kh/g, "x");
  return latin.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
}

/** The emails written in a display name, lowercased. */
export function emailsIn(name: string): string[] {
  return (name.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []).map((e) => e.toLowerCase());
}

/** How many of the student's name words the display name carries. */
function overlap(display: string[], student: string[]): number {
  const want = new Set(student);
  return new Set(display.filter((t) => want.has(t))).size;
}

export type CallStudent = {
  profileId: string;
  name: string;
  /** The programs the form can log this student into. */
  programIds: string[];
  /** The email they sign in with, which they put in their Meet name. */
  email?: string;
};

export type CallClass = {
  id: string;
  studentId: string;
  programId: string;
  /** Program wall clock in a UTC field, the way `ScheduledClass` stores it. */
  startsAt: Date;
  minutes: number;
};

export type CallMatch = {
  studentProfileId?: string;
  programId?: string;
  classId?: string;
  /** What the guess rests on, for the line above the form. */
  via?: "email" | "class" | "name";
  attendance?: (typeof ATTENDANCE)["ATTENDED" | "LATE"];
};

/**
 * Who the call was with, as far as the evidence goes — and nobody, when it
 * does not go far enough. An empty match is the ordinary form with the length
 * and the date filled in, which is still most of the typing saved.
 *
 * Evidence, strongest first:
 *   0. A participant whose display name carries exactly one student's email.
 *      Two students' emails in one call is a group, and no answer from this.
 *   1. A participant whose display name carries two or more of exactly one
 *      student's name words. That is who was actually there, and it beats the
 *      diary: a class moved to another day is still that student's lesson.
 *   2. A class in the mentor's diary that the call overlaps.
 *   3. A participant who shares one word (a first name) with exactly one
 *      student. Two Azizes on a caseload is two candidates, and no guess.
 *
 * `wallOffsetMs` turns a real instant into the program's wall clock, so a call
 * can be laid against a class's `startsAt`.
 */
export function matchCall({
  report,
  students,
  classes,
  mentorName,
  wallOffsetMs,
}: {
  report: CallReport;
  students: CallStudent[];
  classes: CallClass[];
  mentorName?: string | null;
  wallOffsetMs: number;
}): CallMatch {
  const self = new Set(nameTokens(mentorName ?? ""));
  // The mentor's own tile is in every call. A participant whose every word is
  // the mentor's name is the mentor.
  const people = report.people
    .map((p) => ({ ...p, tokens: nameTokens(p.name) }))
    .filter((p) => p.tokens.length > 0 && !p.tokens.every((t) => self.has(t)));

  const byId = new Map(students.map((s) => [s.profileId, s]));
  const studentTokens = new Map(students.map((s) => [s.profileId, nameTokens(s.name)]));

  /** Each student's best overlap with anybody in the call, and when that person arrived. */
  const seen = new Map<string, { score: number; firstSeen: number }>();
  for (const s of students) {
    const tokens = studentTokens.get(s.profileId) ?? [];
    for (const p of people) {
      const score = overlap(p.tokens, tokens);
      if (score === 0) continue;
      const was = seen.get(s.profileId);
      if (!was || score > was.score || (score === was.score && p.firstSeen < was.firstSeen)) {
        seen.set(s.profileId, { score, firstSeen: p.firstSeen });
      }
    }
  }
  const only = (min: number) => {
    const hits = [...seen].filter(([, v]) => v.score >= min);
    if (hits.length === 0) return undefined;
    const top = Math.max(...hits.map(([, v]) => v.score));
    const best = hits.filter(([, v]) => v.score === top);
    return best.length === 1 ? best[0][0] : undefined;
  };
  const strong = only(2);

  // Emails beat names: they are the student's own, typed by them.
  const byEmail = new Map<string, string>();
  for (const s of students) if (s.email) byEmail.set(s.email.toLowerCase(), s.profileId);
  const emailed = new Map<string, number>();
  for (const p of people) {
    for (const email of emailsIn(p.name)) {
      const id = byEmail.get(email);
      if (!id) continue;
      const was = emailed.get(id);
      if (was === undefined || p.firstSeen < was) emailed.set(id, p.firstSeen);
    }
  }
  // Whoever matched by email was there, whatever their name words say.
  for (const [id, firstSeen] of emailed) seen.set(id, { score: Infinity, firstSeen });

  // Classes the call overlaps, the longest overlap first.
  const callStart = report.start + wallOffsetMs;
  const callEnd = report.end + wallOffsetMs;
  const overlapping = classes
    .filter((c) => byId.get(c.studentId)?.programIds.includes(c.programId))
    .map((c) => {
      const from = c.startsAt.getTime() - EARLY_SLACK_MINUTES * MINUTE;
      const to = c.startsAt.getTime() + c.minutes * MINUTE;
      return { c, shared: Math.min(to, callEnd) - Math.max(from, callStart) };
    })
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared);

  const attendance = (studentId: string, cls?: CallClass) => {
    const there = seen.get(studentId);
    if (!there) return undefined;
    if (!cls) return ATTENDANCE.ATTENDED;
    const late = there.firstSeen + wallOffsetMs > cls.startsAt.getTime() + LATE_AFTER_MINUTES * MINUTE;
    return late ? ATTENDANCE.LATE : ATTENDANCE.ATTENDED;
  };
  const fromClass = (cls: CallClass): CallMatch => ({
    studentProfileId: cls.studentId,
    programId: cls.programId,
    classId: cls.id,
    via: "class",
    attendance: attendance(cls.studentId, cls),
  });
  const fromName = (studentId: string): CallMatch => {
    const programs = byId.get(studentId)?.programIds ?? [];
    return {
      studentProfileId: studentId,
      // One program is an answer; two is the form's question to ask.
      programId: programs.length === 1 ? programs[0] : undefined,
      via: "name",
      attendance: attendance(studentId),
    };
  };

  if (emailed.size === 1) {
    const [id] = emailed.keys();
    const theirs = overlapping.find((x) => x.c.studentId === id);
    return { ...(theirs ? fromClass(theirs.c) : fromName(id)), via: "email" };
  }
  if (strong) {
    const theirs = overlapping.find((x) => x.c.studentId === strong);
    return theirs ? fromClass(theirs.c) : fromName(strong);
  }
  if (overlapping.length > 0) {
    // Two classes the call overlaps equally — a double booking — is no answer.
    const [first, second] = overlapping;
    if (!second || second.shared < first.shared) return fromClass(first.c);
  }
  const weak = only(1);
  return weak ? fromName(weak) : {};
}
