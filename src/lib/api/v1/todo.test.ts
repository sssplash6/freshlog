import { describe, expect, it, vi } from "vitest";

import { programColors, toTodoRow, toTodoRows } from "@/lib/api/v1/todo";
import { prisma } from "@/lib/prisma";
import type { Status } from "@/lib/status";

/**
 * One of freshform's statuses as a row of the app's To do list: the same words,
 * and what the app needs to act on it without reading the website's links.
 */

/** A mentor's row about a student whose time is running out, as `caseloadStatuses` makes it. */
const expiring: Status = {
  type: "ALLOCATION_EXPIRING",
  severity: "attention",
  kind: "actionable",
  label: "1h expires Oct 26",
  explanation: "Schedule a meeting before it is lost.",
  href: "/students/p1",
  subject: { kind: "student", id: "p1", name: "Aziz Tursunov" },
  program: { id: "g1", name: "Global Admissions" },
  at: new Date("2026-10-26T00:00:00.000Z"),
};

const meeting: Status = {
  type: "MEETING_TO_LOG",
  severity: "attention",
  kind: "actionable",
  label: "Meeting to log",
  subject: { kind: "student", id: "draft1", name: "Aziz" },
  href: "/sessions/new?studentProfileId=p1&minutes=55&date=2026-10-21&programId=g1&attendance=LATE",
};

/** A session to confirm, as `studentRows` makes one: the mentor who logged it is its subject. */
const toConfirm: Status = {
  type: "SESSION_UNCONFIRMED",
  severity: "attention",
  kind: "actionable",
  label: "Confirm this session",
  explanation: "Oct 22 · 1h",
  href: "/student/meetings",
  subject: { kind: "mentor", id: "m1", name: "Akmal Karimov" },
  sessionId: "s1",
};

describe("toTodoRow: what the app may do about a row", () => {
  it("gives an expiring student row a log for that student and program", () => {
    expect(toTodoRow(expiring).log).toEqual({
      studentProfileId: "p1",
      programId: "g1",
      minutes: null,
      day: null,
      attendance: null,
    });
  });

  it("leaves the program out of that log when the row has none", () => {
    expect(toTodoRow({ ...expiring, program: undefined }).log).toEqual({
      studentProfileId: "p1",
      programId: null,
      minutes: null,
      day: null,
      attendance: null,
    });
  });

  it("prefills a meeting to log from its link", () => {
    const row = toTodoRow({
      type: "MEETING_TO_LOG",
      severity: "attention",
      kind: "actionable",
      label: "Meeting to log",
      subject: { kind: "student", id: "draft1", name: "Aziz" },
      href: "/sessions/new?studentProfileId=p1&minutes=55&date=2026-10-21&programId=g1&attendance=LATE",
    });
    expect(row.log).toEqual({
      studentProfileId: "p1",
      programId: "g1",
      minutes: 55,
      day: "2026-10-21",
      attendance: "LATE",
    });
  });

  it("takes the student of a meeting from its link, because its subject is the draft", () => {
    const row = toTodoRow(meeting);
    expect(row.subject).toEqual({ kind: "student", id: "draft1", name: "Aziz" });
    expect(row.log?.studentProfileId).toBe("p1");
    // The draft is the subject, so it is what tells this meeting from the next.
    expect(row.key).toBe("MEETING_TO_LOG:draft1:");
  });

  it("reads a meeting's link for what it holds and no more", () => {
    const at = (href: string | undefined) => toTodoRow({ ...meeting, href }).log;
    // Google could not say who attended, or which program it was.
    expect(at("/sessions/new?studentProfileId=p1&minutes=50&date=2026-10-13")).toEqual({
      studentProfileId: "p1",
      programId: null,
      minutes: 50,
      day: "2026-10-13",
      attendance: null,
    });
    // Nothing to log for without a student, and a value that is not one is left blank.
    expect(at("/sessions/new?minutes=50")).toBeNull();
    expect(at(undefined)).toBeNull();
    expect(at("/sessions/new?studentProfileId=p1&minutes=lots&date=yesterday&attendance=PERHAPS")).toEqual({
      studentProfileId: "p1",
      programId: null,
      minutes: null,
      day: null,
      attendance: null,
    });
  });

  it("keeps a rolled-up row's count and gives it nothing to act on", () => {
    const row = toTodoRow({
      type: "ALLOCATION_EXPIRING",
      severity: "attention",
      kind: "actionable",
      label: "5 allocations expire soon",
      count: 5,
      href: "/students?time=expiring&program=g1",
      program: { id: "g1", name: "Global Admissions" },
    });
    expect(row).toMatchObject({ count: 5, subject: null, log: null, sessionId: null });
    // No subject, so only the program tells it from the same count in another program.
    expect(row.key).toBe("ALLOCATION_EXPIRING::g1");
  });

  it("gives a row about a session the session to confirm", () => {
    const unconfirmed: Status = {
      type: "SESSION_UNCONFIRMED",
      severity: "attention",
      kind: "actionable",
      label: "Confirm this session",
    };
    expect(toTodoRow({ ...unconfirmed, sessionId: "s1" }).sessionId).toBe("s1");
    expect(toTodoRow(unconfirmed).sessionId).toBeNull();
  });
});

describe("toTodoRow: how a row is told apart", () => {
  it("names a row by its type, its subject and its program, each left blank when it has none", () => {
    const bare: Status = { type: "GOOGLE_RECONNECT", severity: "attention", kind: "actionable", label: "Google disconnected" };
    expect(toTodoRow(expiring).key).toBe("ALLOCATION_EXPIRING:p1:g1");
    expect(toTodoRow({ ...expiring, subject: undefined }).key).toBe("ALLOCATION_EXPIRING::g1");
    expect(toTodoRow({ ...expiring, program: undefined }).key).toBe("ALLOCATION_EXPIRING:p1:");
    expect(toTodoRow(bare).key).toBe("GOOGLE_RECONNECT::");
  });

  it("two rows about one student in two programs get different keys", () => {
    // The app keys its list on this, so two rows must never share one. A mentor who
    // holds time with a student in Global Admissions and in the Master's Program has a
    // caseload row, and so a row here, for each.
    const inG1 = toTodoRow({ ...expiring, program: { id: "g1", name: "Global Admissions" } });
    const inG2 = toTodoRow({ ...expiring, program: { id: "g2", name: "Master's Program" } });
    expect(inG1.subject).toEqual(inG2.subject);
    expect(inG1.type).toBe(inG2.type);
    expect(inG1.key).not.toBe(inG2.key);
    expect(inG1.key).toBe("ALLOCATION_EXPIRING:p1:g1");
    expect(inG2.key).toBe("ALLOCATION_EXPIRING:p1:g2");
  });

  it("adds the session to the key of a session to confirm, and to no other row", () => {
    expect(toTodoRow(toConfirm).key).toBe("SESSION_UNCONFIRMED:m1::s1");
    // A row with no session, which a roll-up is, is keyed as it always was.
    expect(toTodoRow({ ...toConfirm, sessionId: undefined }).key).toBe("SESSION_UNCONFIRMED:m1:");
    expect(toTodoRow(expiring).key).toBe("ALLOCATION_EXPIRING:p1:g1");
  });

  it("two sessions to confirm from one mentor get different keys", () => {
    // The mentor is all a session to confirm names as its subject, and it names no
    // program, so but for the session two of one mentor's would share a key. The
    // app keys its list on this.
    const first = toTodoRow({ ...toConfirm, sessionId: "s1" });
    const second = toTodoRow({ ...toConfirm, sessionId: "s2" });
    expect(first.subject).toEqual(second.subject);
    expect(first.program).toEqual(second.program);
    expect(first.key).not.toBe(second.key);
    expect(first.key).toBe("SESSION_UNCONFIRMED:m1::s1");
    expect(second.key).toBe("SESSION_UNCONFIRMED:m1::s2");
  });
});

describe("toTodoRow: what is carried over", () => {
  it("carries freshform's words and nothing that is not in the contract", () => {
    expect(toTodoRow(expiring)).toEqual({
      key: "ALLOCATION_EXPIRING:p1:g1",
      type: "ALLOCATION_EXPIRING",
      severity: "attention",
      label: "1h expires Oct 26",
      explanation: "Schedule a meeting before it is lost.",
      subject: { kind: "student", id: "p1", name: "Aziz Tursunov" },
      program: { id: "g1", name: "Global Admissions", colorIndex: 0 },
      count: null,
      href: "/students/p1",
      sessionId: null,
      log: { studentProfileId: "p1", programId: "g1", minutes: null, day: null, attendance: null },
    });
  });

  it("says null for what a status leaves out", () => {
    const row = toTodoRow({ type: "GOOGLE_RECONNECT", severity: "attention", kind: "actionable", label: "Google disconnected" });
    expect(row).toMatchObject({ explanation: null, subject: null, program: null, count: null, href: null });
  });

  it("carries no instants, so the row is the same after a trip through JSON", () => {
    const row = toTodoRow(expiring);
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });

  it("does not pass the subject or the program through as they came", () => {
    // A runtime row can hold more than its type says: exchangeStatuses hands over
    // the whole program row it read.
    const fuller = {
      ...expiring,
      subject: { kind: "student" as const, id: "p1", name: "Aziz Tursunov", email: "aziz@example.com" },
      program: { id: "g1", name: "Global Admissions", colorIndex: 4, archivedAt: null },
    };
    const row = toTodoRow(fuller);
    expect(row.subject).toEqual({ kind: "student", id: "p1", name: "Aziz Tursunov" });
    expect(Object.keys(row.program ?? {}).sort()).toEqual(["colorIndex", "id", "name"]);
  });
});

describe("programColors: the dot a row's program wears", () => {
  it("looks up the colour of each program the rows name, and of no others", async () => {
    const [a, b] = await Promise.all([
      prisma.program.create({ data: { name: "Global Admissions", colorIndex: 2 } }),
      prisma.program.create({ data: { name: "Master's Program", colorIndex: 5 } }),
    ]);
    await prisma.program.create({ data: { name: "Research", colorIndex: 7 } });

    const colors = await programColors([
      { program: { id: a.id, name: a.name } },
      { program: { id: b.id, name: b.name } },
      { program: { id: a.id, name: a.name } },
      {},
    ]);
    expect(Object.fromEntries(colors)).toEqual({ [a.id]: 2, [b.id]: 5 });
  });

  it("gives a row the colour of its program", async () => {
    const p = await prisma.program.create({ data: { name: "Master's Program", colorIndex: 5 } });
    const status: Status = { ...expiring, program: { id: p.id, name: p.name } };
    const colors = await programColors([status]);
    expect(toTodoRow(status, colors).program).toEqual({ id: p.id, name: "Master's Program", colorIndex: 5 });
  });

  it("falls back to the first slot for a program it could not find", () => {
    expect(toTodoRow(expiring, new Map()).program?.colorIndex).toBe(0);
  });

  it("asks nothing, and answers nothing, when no row names a program", async () => {
    const findMany = vi.spyOn(prisma.program, "findMany");
    try {
      expect((await programColors([{}, { program: undefined }])).size).toBe(0);
      expect(findMany).not.toHaveBeenCalled();
    } finally {
      findMany.mockRestore();
    }
  });
});

/** A student lent to a host program, as `exchangeStatuses` words it: the program is the HOST. */
const exchange: Status = {
  type: "EXCHANGE_UNALLOCATED",
  severity: "attention",
  kind: "actionable",
  label: "Hours not allocated",
  href: "/students/p1",
  subject: { kind: "student", id: "p1", name: "Aziz Tursunov" },
  program: { id: "h1", name: "Global Admissions" },
};

describe("toTodoRows: a whole list", () => {
  it("gives rows that would share a key keys of their own, the first keeping the one it has", async () => {
    // A student sent to one host program from two of a mentor's programs is two rows of
    // one kind about one student in one program, and the app keys its list on `key`.
    const rows = await toTodoRows([exchange, expiring, exchange, exchange]);
    expect(rows.map((row) => row.key)).toEqual([
      "EXCHANGE_UNALLOCATED:p1:h1",
      "ALLOCATION_EXPIRING:p1:g1",
      "EXCHANGE_UNALLOCATED:p1:h1#2",
      "EXCHANGE_UNALLOCATED:p1:h1#3",
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    // Only the key tells them apart.
    expect({ ...rows[3], key: rows[0].key }).toEqual(rows[0]);
  });

  it("leaves a list whose keys are all different exactly as the formula made it", async () => {
    const list = [expiring, meeting, { ...toConfirm, sessionId: "s1" }, { ...toConfirm, sessionId: "s2" }];
    const rows = await toTodoRows(list);
    expect(rows).toEqual(list.map((status) => toTodoRow(status)));
    // Two sessions of one mentor's are told apart by the session, not by a number.
    expect(rows.slice(2).map((row) => row.key)).toEqual(["SESSION_UNCONFIRMED:m1::s1", "SESSION_UNCONFIRMED:m1::s2"]);
  });

  it("gives a row naming a program that program's colorIndex, with no map passed in", async () => {
    const [a, b] = await Promise.all([
      prisma.program.create({ data: { name: "Global Admissions", colorIndex: 2 } }),
      prisma.program.create({ data: { name: "Master's Program", colorIndex: 5 } }),
    ]);
    const findMany = vi.spyOn(prisma.program, "findMany");
    try {
      const rows = await toTodoRows([
        { ...expiring, program: { id: a.id, name: a.name } },
        { ...expiring, program: { id: b.id, name: b.name } },
        meeting,
      ]);
      expect(rows.map((row) => row.program?.colorIndex ?? null)).toEqual([2, 5, null]);
      // Both programs' colours come from one read of the list, not one read a row.
      expect(findMany).toHaveBeenCalledTimes(1);
    } finally {
      findMany.mockRestore();
    }
  });
});
