import { describe, expect, it } from "vitest";

import {
  callMinutes,
  emailsIn,
  matchCall,
  nameTokens,
  parseCallReport,
  type CallClass,
  type CallReport,
  type CallStudent,
} from "@/lib/call-match";

const MIN = 60 * 1000;
const OFFSET = 5 * 60 * MIN; // Tashkent
// 15:00 Tashkent on 23 November 2026, as a real instant.
const T15 = Date.UTC(2026, 10, 23, 10, 0);
/** 15:00 Tashkent as `ScheduledClass.startsAt` stores it: the wall clock in UTC. */
const wall = (real: number) => new Date(real + OFFSET);

const aziz: CallStudent = { profileId: "aziz", name: "Aziz Karimov", programIds: ["ga"] };
const azizB: CallStudent = { profileId: "aziz-b", name: "Aziz Rahimov", programIds: ["ga"] };
const malika: CallStudent = { profileId: "malika", name: "Malika Xoliqova", programIds: ["ga", "ms"] };

function report(people: [string, number][], start = T15, end = T15 + 50 * MIN): CallReport {
  return { start, end, people: people.map(([name, firstSeen]) => ({ name, firstSeen })) };
}
function cls(studentId: string, programId: string, startsReal: number, minutes = 60): CallClass {
  return { id: `c-${studentId}`, studentId, programId, startsAt: wall(startsReal), minutes };
}

describe("parseCallReport", () => {
  const now = T15 + 60 * MIN;

  it("reads the start, end, code and people", () => {
    const r = parseCallReport(
      {
        start: String(T15),
        end: String(T15 + 47 * MIN),
        code: "abc-defg-hij",
        p: [`${T15}~Aziz Karimov`, `${T15 + MIN}~Sanjar`],
      },
      now
    );
    expect(r).toEqual({
      start: T15,
      end: T15 + 47 * MIN,
      code: "abc-defg-hij",
      people: [
        { name: "Aziz Karimov", firstSeen: T15 },
        { name: "Sanjar", firstSeen: T15 + MIN },
      ],
    });
  });

  it("refuses a call with no length, from the future, or from long ago", () => {
    expect(parseCallReport({ start: String(T15), end: String(T15) }, now)).toBeNull();
    expect(parseCallReport({ start: "x", end: String(T15) }, now)).toBeNull();
    expect(parseCallReport({ start: String(now + 60 * MIN), end: String(now + 90 * MIN) }, now)).toBeNull();
    expect(parseCallReport({ start: String(now - 30 * 24 * 60 * MIN), end: String(now) }, now)).toBeNull();
  });

  it("drops a malformed person and an odd code rather than the whole report", () => {
    const r = parseCallReport({ start: String(T15), end: String(T15 + MIN), code: "<script>", p: ["nope", "~x", `${T15}~Ok`] }, now);
    expect(r?.code).toBeUndefined();
    expect(r?.people).toEqual([{ name: "Ok", firstSeen: T15 }]);
  });
});

describe("callMinutes", () => {
  it("rounds to the minute and never says zero", () => {
    expect(callMinutes(report([], T15, T15 + 47 * MIN + 29_000))).toBe(47);
    expect(callMinutes(report([], T15, T15 + 10_000))).toBe(1);
  });
});

describe("nameTokens", () => {
  it("reads Cyrillic, apostrophes and kh the way the roster spells them", () => {
    expect(nameTokens("Азиз Каримов")).toEqual(["aziz", "karimov"]);
    expect(nameTokens("Malika Kholiqova")).toEqual(["malika", "xoliqova"]);
    expect(nameTokens("G‘ayrat O'ktamov")).toEqual(["gayrat", "oktamov"]);
  });
});

describe("matchCall", () => {
  const base = { mentorName: "Sanjar Usmonov", wallOffsetMs: OFFSET };

  it("takes the student whose full name is on a tile, and says they came", () => {
    const m = matchCall({ ...base, report: report([["Aziz Karimov", T15]]), students: [aziz, azizB], classes: [] });
    expect(m).toEqual({ studentProfileId: "aziz", programId: "ga", via: "name", attendance: "ATTENDED" });
  });

  it("matches a Cyrillic display name to a Latin roster name", () => {
    const m = matchCall({ ...base, report: report([["Азиз Каримов", T15]]), students: [aziz, azizB], classes: [] });
    expect(m.studentProfileId).toBe("aziz");
  });

  it("leaves the program to the form when the student is in two", () => {
    const m = matchCall({ ...base, report: report([["Malika Xoliqova", T15]]), students: [malika], classes: [] });
    expect(m).toMatchObject({ studentProfileId: "malika", programId: undefined });
  });

  it("does not guess between two students who share a first name", () => {
    const m = matchCall({ ...base, report: report([["Aziz", T15]]), students: [aziz, azizB], classes: [] });
    expect(m).toEqual({});
  });

  it("takes a first name when only one student has it", () => {
    const m = matchCall({ ...base, report: report([["Malika", T15]]), students: [aziz, malika], classes: [] });
    expect(m.studentProfileId).toBe("malika");
  });

  it("never matches the mentor's own tile", () => {
    const sanjar: CallStudent = { profileId: "s", name: "Sanjar Usmonov", programIds: ["ga"] };
    const m = matchCall({ ...base, report: report([["Sanjar Usmonov", T15]]), students: [sanjar], classes: [] });
    expect(m).toEqual({});
  });

  it("falls back to the class in the diary when nobody's name is readable", () => {
    const m = matchCall({ ...base, report: report([]), students: [aziz, malika], classes: [cls("malika", "ms", T15)] });
    expect(m).toEqual({ studentProfileId: "malika", programId: "ms", classId: "c-malika", via: "class", attendance: undefined });
  });

  it("marks a student late who joined more than five minutes into the class", () => {
    const m = matchCall({
      ...base,
      report: report([["Malika Xoliqova", T15 + 9 * MIN]]),
      students: [malika],
      classes: [cls("malika", "ms", T15)],
    });
    expect(m).toMatchObject({ classId: "c-malika", attendance: "LATE" });
  });

  it("counts a call opened early as that class", () => {
    const m = matchCall({
      ...base,
      report: report([], T15 - 20 * MIN, T15 + 30 * MIN),
      students: [aziz],
      classes: [cls("aziz", "ga", T15)],
    });
    expect(m.classId).toBe("c-aziz");
  });

  it("believes who was in the call over who was in the diary", () => {
    const m = matchCall({
      ...base,
      report: report([["Aziz Karimov", T15]]),
      students: [aziz, malika],
      classes: [cls("malika", "ms", T15)],
    });
    expect(m).toEqual({ studentProfileId: "aziz", programId: "ga", via: "name", attendance: "ATTENDED" });
  });

  it("ignores a class at another time of day", () => {
    const m = matchCall({ ...base, report: report([]), students: [aziz], classes: [cls("aziz", "ga", T15 + 3 * 60 * MIN)] });
    expect(m).toEqual({});
  });

  it("ignores a class in a program the form cannot log into", () => {
    const m = matchCall({ ...base, report: report([]), students: [aziz], classes: [cls("aziz", "ms", T15)] });
    expect(m).toEqual({});
  });

  describe("by the email in a Meet name", () => {
    const azizE = { ...aziz, email: "aziz.k@gmail.com" };
    const azizBE = { ...azizB, email: "Aziz.R@Gmail.com" };
    const malikaE = { ...malika, email: "malika@freshman.academy" };

    it("finds the student whose email it is, and says so", () => {
      const m = matchCall({ ...base, report: report([["Aziz aziz.r@gmail.com", T15]]), students: [azizE, azizBE], classes: [] });
      expect(m).toEqual({ studentProfileId: "aziz-b", programId: "ga", via: "email", attendance: "ATTENDED" });
    });

    it("needs no name words at all", () => {
      const m = matchCall({ ...base, report: report([["AZIZ.K@GMAIL.COM", T15]]), students: [azizE, azizBE], classes: [] });
      expect(m).toMatchObject({ studentProfileId: "aziz", via: "email", attendance: "ATTENDED" });
    });

    it("beats a full name somebody else in the call has", () => {
      const m = matchCall({
        ...base,
        report: report([["Aziz Karimov", T15], ["Malika malika@freshman.academy", T15]]),
        students: [azizE, malikaE],
        classes: [],
      });
      expect(m).toMatchObject({ studentProfileId: "malika", via: "email" });
    });

    it("takes the program and the lateness from the class it overlaps", () => {
      const m = matchCall({
        ...base,
        report: report([["Malika Xoliqova malika@freshman.academy", T15 + 9 * MIN]]),
        students: [malikaE],
        classes: [cls("malika", "ms", T15)],
      });
      expect(m).toEqual({ studentProfileId: "malika", programId: "ms", classId: "c-malika", via: "email", attendance: "LATE" });
    });

    it("leaves the program open for a student in two, with no class to say which", () => {
      const m = matchCall({ ...base, report: report([["malika@freshman.academy", T15]]), students: [malikaE], classes: [] });
      expect(m).toMatchObject({ studentProfileId: "malika", programId: undefined, via: "email" });
    });

    it("is no answer when two students' emails are in the call", () => {
      const m = matchCall({
        ...base,
        report: report([["aziz.k@gmail.com", T15], ["aziz.r@gmail.com", T15]]),
        students: [azizE, azizBE],
        classes: [],
      });
      expect(m.via).not.toBe("email");
    });

    it("ignores an email that is nobody's on the caseload", () => {
      const m = matchCall({ ...base, report: report([["Aziz Karimov stranger@gmail.com", T15]]), students: [azizE], classes: [] });
      expect(m).toMatchObject({ studentProfileId: "aziz", via: "name" });
    });
  });
});

describe("emailsIn", () => {
  it("finds every email in a display name, lowercased", () => {
    expect(emailsIn("Aziz Karimov (Aziz.K+meet@Gmail.com)")).toEqual(["aziz.k+meet@gmail.com"]);
    expect(emailsIn("Aziz Karimov")).toEqual([]);
  });
});
