// The answer sheets for the rules the app works out itself (parity plan T0.3): the website's own functions run over
// many cases, written as JSON for the app's jest to run its copies over the same cases. LOCAL development only.
//
//   npx tsx scripts/parity/golden.ts <app>/src/__tests__/golden
//
// Each sheet is the cases and the website's answer to each. A sheet the app disagrees with is a difference to fix.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SESSION_ANSWER, SESSION_STATUS } from "../../src/lib/constants";
import { sessionStatuses } from "../../src/lib/status";
import { daysAway, programToday } from "../../src/lib/when";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Every `step` from `from` for `count` instants: the hours around Tashkent's midnight and the UTC one, over days. */
const instants = (from: string, step: number, count: number) => Array.from({ length: count }, (_, i) => new Date(Date.parse(from) + i * step));
const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (dayText: string, n: number) => day(new Date(Date.parse(`${dayText}T00:00:00.000Z`) + n * DAY));

function main() {
  const out = process.argv[2];
  if (!out) throw new Error("Name the app's src/__tests__/golden directory.");
  mkdirSync(out, { recursive: true });
  const write = (name: string, rule: string, cases: unknown[]) =>
    writeFileSync(join(out, `${name}.json`), `${JSON.stringify({ rule, cases }, null, 1)}\n`);

  // Tashkent's today for an instant (`programToday`): every 17 minutes over four days, across both midnights.
  write(
    "tashkent-day",
    "programToday(now)",
    instants("2026-10-28T12:00:00.000Z", 17 * 60 * 1000, 4 * 24 * 4).map((now) => ({ now: now.toISOString(), today: programToday(now) }))
  );

  // Whether a session still asks its student (`sessionStatuses`' SESSION_UNCONFIRMED): its day as the log form stores
  // it (that day's UTC midnight), at instants every 50 minutes from the day before to 32 days after.
  const sessionDay = "2026-09-15";
  write(
    "answer-window",
    "sessionStatuses(active, in plan, unanswered, date).includes(SESSION_UNCONFIRMED)",
    instants(`${addDays(sessionDay, -1)}T00:00:00.000Z`, 50 * 60 * 1000, Math.ceil((34 * DAY) / (50 * 60 * 1000))).map((now) => ({
      day: sessionDay,
      now: now.toISOString(),
      asks: sessionStatuses(
        { attended: true, late: false, status: SESSION_STATUS.ACTIVE, withinPlan: true, studentAnswer: null, date: new Date(`${sessionDay}T00:00:00.000Z`) },
        { audience: "student", userId: "s", now }
      ).some((s) => s.type === "SESSION_UNCONFIRMED"),
      // An answered one never asks.
      answered: sessionStatuses(
        { attended: true, late: false, status: SESSION_STATUS.ACTIVE, withinPlan: true, studentAnswer: SESSION_ANSWER.CONFIRMED, date: new Date(`${sessionDay}T00:00:00.000Z`) },
        { audience: "student", userId: "s", now }
      ).some((s) => s.type === "SESSION_UNCONFIRMED"),
    }))
  );

  // A mentor task's due day (`MentorTaskDue`): late before its day, soon from today to a week out; and a student
  // task's TASK_OVERDUE (`taskStatuses`: due before now). Due days as the forms store them (UTC midnight), at
  // instants every 5 hours over three weeks; `daysLeft` is what freshform sends with each.
  const dueDays = ["2026-10-30", "2026-11-02", "2026-11-06"];
  write(
    "task-due",
    "MentorTaskDue: late = days < 0, soon = !late && days <= 7; TASK_OVERDUE = dueOn < now",
    dueDays.flatMap((due) =>
      instants("2026-10-20T00:00:00.000Z", 5 * HOUR, Math.ceil((21 * DAY) / (5 * HOUR))).map((now) => {
        const dueOn = new Date(`${due}T00:00:00.000Z`);
        const days = daysAway(dueOn, now);
        const late = days < 0;
        return { due, now: now.toISOString(), daysLeft: days, mentorLate: late, mentorSoon: !late && days <= 7, overdue: dueOn.getTime() < now.getTime() };
      })
    )
  );
  console.log(`wrote 3 sheets to ${out}`);
}

main();
