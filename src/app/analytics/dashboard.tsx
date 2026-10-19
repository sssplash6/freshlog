"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ChartIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from "@/components/icons";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { PageTitle, Section } from "@/components/ui/section";
import type { AnalyticsData, AnalyticsMentor, AnalyticsProgram, AnalyticsRow } from "@/lib/analytics";
import {
  byDay,
  byMonth,
  change,
  dateOf,
  drawnByProgram,
  hoursByDay,
  hoursOf,
  meetingsOf,
  monthOf,
  monthsByProgram,
  niceAxis,
  rankBy,
  select,
  shortHours,
  totals,
  weeksOf,
  yearOf,
  yearsOf,
  type Ranked,
  type Tally,
} from "@/lib/analytics-math";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { initials, personTone } from "@/lib/person-tone";

import s from "./dashboard.module.css";

/**
 * What the page calls its parts. The school's are programs; an institute's are
 * its levels, handed over in the same `programs` slots (`instituteAnalyticsData`)
 * so the drill itself never has to know which it is reading — only the words do.
 */
export type Frame =
  | { kind: "school" }
  | { kind: "institute"; name: string };

type Words = {
  all: string;
  allChip: string;
  across: string;
  parts: string;
  top: string;
  topMentor: string;
  inOne: string;
  inOneMentor: string;
};

function wordsFor(frame: Frame): Words {
  if (frame.kind === "institute") {
    return {
      all: frame.name,
      allChip: "All levels",
      across: `Hours mentors spent with students, across ${frame.name}.`,
      parts: "Levels",
      top: `Top mentors in ${frame.name}`,
      topMentor: `Mentors in ${frame.name}`,
      inOne: "Who delivered the most",
      inOneMentor: "Mentors at this level",
    };
  }
  return {
    all: "All programs",
    allChip: "All programs",
    across: "Hours mentors spent with students, across every program.",
    parts: "Programs",
    top: "Top mentors across the school",
    topMentor: "Mentors across the school",
    inOne: "Who delivered the most",
    inOneMentor: "Mentors in this program",
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The colour of a figure that belongs to no one program. */
const DEFAULT = "var(--color-brand)";
/**
 * Hours, in the one colour hours wear: a mentor's bar on the leaderboard is
 * an amount of time, and in this app time-as-a-fill is orange. It was brand
 * blue, the colour of things you press.
 */
const HOURS = "var(--color-accent)";
/** Extra time is the same hue, lighter — never a second colour. */
const EXTRA_OPACITY = 0.35;

/**
 * Missed time is the same hue again, striped: the student was charged and the
 * mentor kept the slot, so it is hours, but not hours anybody spent together.
 * The stripe is the ledger's own (`HoursBreakdown`), so "missed" looks the
 * same on a student's page and here.
 */
function fillOf(color: string, striped?: boolean): string {
  if (!striped) return color;
  // Mixed toward the SURFACE, as in `HoursBreakdown`: on a dark card the light
  // half of the stripe has to be the card's own ground.
  return `repeating-linear-gradient(135deg, ${color} 0 4px, color-mix(in srgb, ${color} 40%, var(--color-surface)) 4px 8px)`;
}

/**
 * A program's colour on this page: its own, out of eight that are kept apart
 * (`--prog-0`…`--prog-7` in the stylesheet), so no two programs in a stack, a
 * legend or a row of cards share one.
 *
 * The n-th program takes the n-th colour. Live programs choose before archived
 * ones, so an old program never takes a current one's colour, and the order is
 * fixed for the life of the page, so a program keeps its colour when a filter
 * removes its neighbours. Past eight programs the colours start again.
 */
const PALETTE = 8;
const colorCache = new WeakMap<AnalyticsProgram[], string[]>();
function colorOf(data: AnalyticsData, program: number): string {
  let colors = colorCache.get(data.programs);
  if (!colors) {
    const out: string[] = [];
    data.programs
      .map((p, i) => ({ p, i }))
      .sort((a, b) => Number(a.p.archived) - Number(b.p.archived) || a.i - b.i)
      .forEach(({ i }, n) => {
        out[i] = `var(--prog-${n % PALETTE})`;
      });
    colors = out;
    colorCache.set(data.programs, colors);
  }
  return colors[program] ?? "var(--color-muted-fg)";
}

type Today = { year: number; month: number; day: number };
type View = { year: number; month: number | null; program: number | null; mentor: number | null };

export function Dashboard({
  data,
  today,
  audience = "staff",
  selfMentorId,
  frame = { kind: "school" },
  elsewhere,
}: {
  data: AnalyticsData;
  today: Today;
  /** The school, or one institute with its levels in the program slots. */
  frame?: Frame;
  /**
   * The other frame, for a reader who has both: an institute's people can
   * still read the whole school, which is unscoped for every mentor and member
   * of staff by design. Absent for everybody in the school frame only.
   */
  elsewhere?: { label: string; href: string };
  /**
   * Who is reading — lens, not authority. The rows are the same either way;
   * what changes is whether the page leads with a school-wide ranking (staff,
   * whose job is comparing mentors) or with the reader's own year (a mentor,
   * for whom that ranking is a podium they did not ask for).
   */
  audience?: "staff" | "mentor";
  /** The reader's own row in `data.mentors`, when they have one. */
  selfMentorId?: string;
}) {
  const selfIndex = useMemo(
    () => {
      const i = selfMentorId
        ? data.mentors.findIndex((m) => m.id === selfMentorId)
        : -1;
      return i >= 0 ? i : null;
    },
    [data.mentors, selfMentorId]
  );
  const [view, go] = useView(data, today, audience === "mentor" ? selfIndex : null);
  const words = wordsFor(frame);
  const { year, month, program, mentor } = view;
  const accent = program != null ? colorOf(data, program) : DEFAULT;

  // The scope of the current level for the whole year, and narrowed to the month.
  const yearRows = useMemo(
    () => select(data.rows, { year, program, mentor }),
    [data.rows, year, program, mentor]
  );
  const periodRows = useMemo(
    () => (month == null ? yearRows : select(yearRows, { year, month })),
    [yearRows, year, month]
  );

  const years = useMemo(() => yearsOf(data.rows, today.year), [data.rows, today.year]);
  const latestWithData = years.find((y) => data.rows.some((r) => yearOf(r[3]) === y));

  // Scroll back to the top when the level changes, not on the first paint.
  const level = `${program}-${mentor}`;
  const firstLevel = useRef(level);
  useEffect(() => {
    if (firstLevel.current === level) return;
    firstLevel.current = level;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [level]);

  // Months that have happened: a sparkline must not dive to zero in October.
  const last = year === today.year ? today.month : 11;

  const mentorRow = mentor != null ? data.mentors[mentor] : null;
  const programRow = program != null ? data.programs[program] : null;
  // A mentor reading their own year. The page was written for an admin
  // looking at somebody else — the mentor's own name as the h1, "What they
  // logged each month" — so it spoke about the reader in the third person.
  const self = mentor != null && mentor === selfIndex;

  const crumbs = (programRow || mentorRow) && (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Where you are">
      <Crumb current={program == null && mentor == null} onClick={() => go({ program: null, mentor: null })}>
        {words.all}
      </Crumb>
      {/* Each slash is held to the crumb after it, so a long name wraps
          whole onto the next line instead of leaving a "/" at the end of
          the one above it. */}
      {programRow && (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
          <span className="text-muted-fg/50" aria-hidden>/</span>
          <Crumb current={mentor == null} onClick={() => go({ mentor: null })}>
            <Dot color={accent} />
            <span className="min-w-0 truncate">{programRow.name}</span>
          </Crumb>
        </span>
      )}
      {mentorRow && (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
          <span className="text-muted-fg/50" aria-hidden>/</span>
          <Crumb current onClick={() => undefined}>
            <span className="min-w-0 truncate">{self ? "You" : mentorRow.name}</span>
          </Crumb>
        </span>
      )}
    </nav>
  );

  return (
    <div className={cn(s.root, "space-y-4")}>
      <PageTitle
        eyebrow={(programRow || mentorRow) && !self ? "Analytics" : undefined}
        leading={mentorRow && !self ? <MentorAvatar mentor={mentorRow} large /> : undefined}
        title={
          self ? (
            "Your analytics"
          ) : programRow && !mentorRow ? (
            <span className="inline-flex max-w-full items-center gap-3">
              <Dot color={accent} className="h-3 w-3" />
              <span className="min-w-0 truncate">{programRow.name}</span>
            </span>
          ) : (
            mentorRow?.name ?? "Analytics"
          )
        }
        subtitle={crumbs}
        actions={
          <>
            {/* A plain link, not a drill: the other frame is a different read
                on the server, not a different slice of this one. */}
            {elsewhere && (
              <a href={elsewhere.href} className={buttonClasses("secondary", "sm")}>
                {elsewhere.label}
              </a>
            )}
            {month != null && (
              <button
                type="button"
                className={buttonClasses("secondary", "sm")}
                onClick={() => go({ month: null })}
                aria-label="Show the whole year"
              >
                {MONTHS_LONG[month]}
                <XIcon className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="inline-flex items-center rounded-lg bg-fill p-0.5">
              <button
                type="button"
                className="grid h-11 w-11 place-items-center rounded-md text-muted-fg transition-colors hover:bg-surface hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent sm:h-8 sm:w-8"
                aria-label="Previous year"
                disabled={year <= years[years.length - 1]}
                onClick={() => go({ year: year - 1, month: null })}
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <span className="min-w-12 text-center text-body font-semibold tabular-nums text-ink">
                {year}
              </span>
              <button
                type="button"
                className="grid h-11 w-11 place-items-center rounded-md text-muted-fg transition-colors hover:bg-surface hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent sm:h-8 sm:w-8"
                aria-label="Next year"
                disabled={year >= today.year}
                onClick={() => go({ year: year + 1, month: null })}
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          </>
        }
      />

      {yearRows.length === 0 ? (
        <div className={cn(s.enter, "rounded-xl bg-surface shadow-sm")} key={`empty-${level}-${year}`}>
          <EmptyState framed={false} icon={<ChartIcon />} title={`No sessions logged in ${year}`}>
            <p>
              {mentorRow
                ? `${mentorRow.name} has no meetings on record here for this year.`
                : "Hours show up on this page once mentors log their meetings."}
            </p>
            {latestWithData != null && latestWithData !== year && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => go({ year: latestWithData, month: null })}
              >
                Jump to {latestWithData}
              </Button>
            )}
          </EmptyState>
        </div>
      ) : (
        <div key={`${level}`} className={cn(s.enter, "space-y-4")}>
          {mentor != null && <MentorScope data={data} view={view} go={go} ranked={audience === "staff"} words={words} />}
          <Hero data={data} view={view} today={today} yearRows={yearRows} periodRows={periodRows} />
          <MonthsCard data={data} view={view} go={go} yearRows={yearRows} />
          {program == null && mentor == null && (
            <>
              <ProgramCards data={data} view={view} go={go} last={last} words={words} />
              <Leaderboard
                data={data}
                view={view}
                go={go}
                title={
                  audience === "mentor" ? words.topMentor : words.top
                }
                ranked={audience === "staff"}
                periodRows={periodRows}
                yearRows={yearRows}
                limit={8}
                last={last}
              />
            </>
          )}
          {program != null && mentor == null && (
            <Leaderboard
              data={data}
              view={view}
              go={go}
              title={
                audience === "mentor" ? words.inOneMentor : words.inOne
              }
              ranked={audience === "staff"}
              periodRows={periodRows}
              yearRows={yearRows}
              last={last}
            />
          )}
          {mentor != null && <MentorDetail view={view} today={today} go={go} yearRows={yearRows} accent={accent} self={self} />}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ state */

/**
 * The view lives in the URL, written with `history.pushState` so a click never
 * waits on the server — Next keeps `useSearchParams` in step with it — while
 * the back button still walks back up the levels and a view can be shared.
 */
function useView(
  data: AnalyticsData,
  today: Today,
  selfIndex: number | null
): [View, (next: Partial<View>) => void] {
  const params = useSearchParams();
  // The self-default applies only to the landing — once the reader navigates,
  // "All programs" must actually reach it rather than snapping back to them.
  // State, not a ref: the memo below reads it during render.
  const [navigated, setNavigated] = useState(false);

  const view = useMemo<View>(() => {
    const y = Number(params.get("y"));
    const m = Number(params.get("m"));
    const p = data.programs.findIndex((x) => x.id === params.get("p"));
    const u = data.mentors.findIndex((x) => x.id === params.get("u"));
    return {
      year: Number.isInteger(y) && y > 2000 && y <= today.year ? y : today.year,
      month: Number.isInteger(m) && m >= 1 && m <= 12 ? m - 1 : null,
      program: p >= 0 ? p : null,
      mentor:
        u >= 0
          ? u
          : p < 0 && selfIndex != null && !navigated
            ? selfIndex
            : null,
    };
  }, [params, data.programs, data.mentors, today.year, selfIndex, navigated]);

  const go = useCallback(
    (next: Partial<View>) => {
      setNavigated(true);
      const v = { ...view, ...next };
      const q = new URLSearchParams();
      // Which frame this is was chosen on the server and is not part of the
      // view; carried so a reload after drilling lands in the same one.
      const frame = params.get("frame");
      if (frame) q.set("frame", frame);
      if (v.year !== today.year) q.set("y", String(v.year));
      if (v.month != null) q.set("m", String(v.month + 1));
      if (v.program != null) q.set("p", data.programs[v.program].id);
      if (v.mentor != null) q.set("u", data.mentors[v.mentor].id);
      const qs = q.toString();
      window.history.pushState(null, "", qs ? `?${qs}` : window.location.pathname);
    },
    [view, today.year, data.programs, data.mentors, params]
  );

  return [view, go];
}

/** Ease a number toward its target, so a changed figure is seen to change. */
function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const origin = from.current;
    let frame = requestAnimationFrame(function tick(now) {
      const k = reduce ? 1 : Math.min(1, (now - start) / duration);
      const v = origin + (target - origin) * (1 - (1 - k) ** 3);
      from.current = v;
      setValue(v);
      if (k < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

/** False for one frame after mount, so bars can grow from the baseline. */
function useGrown(): boolean {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return grown;
}

/* ------------------------------------------------------------------- hero */

function Hero({
  data,
  view,
  today,
  yearRows,
  periodRows,
}: {
  data: AnalyticsData;
  view: View;
  today: Today;
  yearRows: AnalyticsRow[];
  periodRows: AnalyticsRow[];
}) {
  const { year, month, program, mentor } = view;
  const t = useMemo(() => totals(periodRows), [periodRows]);

  // What to compare against: the same stretch of time one step back, cut at
  // today's date while the current period is still running — a half-finished
  // month against a whole one is a fall that did not happen.
  const compare = useMemo(() => {
    const scope = { program, mentor };
    if (month != null) {
      const py = month === 0 ? year - 1 : year;
      const pm = month === 0 ? 11 : month - 1;
      const running = year === today.year && month === today.month;
      const rows = select(data.rows, { year: py, month: pm, ...scope }).filter(
        (r) => !running || dateOf(r[3]) <= today.day
      );
      const against = running ? `${MONTHS[pm]} 1–${today.day}` : MONTHS_LONG[pm];
      const nowRows = running ? periodRows.filter((r) => dateOf(r[3]) <= today.day) : periodRows;
      return { before: totals(rows).hours, now: totals(nowRows).hours, against };
    }
    const running = year === today.year;
    const rows = select(data.rows, { year: year - 1, ...scope }).filter(
      (r) =>
        !running ||
        monthOf(r[3]) < today.month ||
        (monthOf(r[3]) === today.month && dateOf(r[3]) <= today.day)
    );
    return {
      before: totals(rows).hours,
      now: t.hours,
      against: running ? `the same period of ${year - 1}` : String(year - 1),
    };
  }, [data.rows, year, month, program, mentor, today, periodRows, t.hours]);

  const delta = change(compare.now, compare.before);
  // Counted up in MINUTES and printed the way every other total in the app
  // is: "110h 39m". It was decimal hours — "73.2 hours" over a bar labelled
  // "73h" and a footer saying "73h 10m" — one quantity in three formats.
  const minutesShown = useCountUp(t.hours);
  const meetings = meetingsOf(t);
  const avg = meetings ? t.hours / meetings : 0;
  const noShowRate = t.noShows / Math.max(1, t.sessions + t.noShows);

  // A mentor has no "mentors" figure; their busiest month says more.
  const busiest = useMemo(() => {
    const months = byMonth(yearRows);
    let best = -1;
    months.forEach((m, i) => {
      if (hoursOf(m) > 0 && (best < 0 || hoursOf(m) > hoursOf(months[best]))) best = i;
    });
    return best < 0 ? null : { month: best, minutes: hoursOf(months[best]) };
  }, [yearRows]);

  // No caption: the period is already in the header, in the year switcher and
  // the month chip beside it, and "2026" printed twice read as two things.
  return (
    <Section title="Hours with students">
      {/* ONE lead figure, in the orange that means hours everywhere else, and
          the six supporting figures under a hairline at a third of its size —
          they used to be six tinted tiles beside it, which read as seven
          numbers of equal weight. */}
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5 tabular-nums" aria-label={formatDuration(t.hours)}>
            <span className="text-lead font-semibold leading-none tracking-tight text-accent-ink">
              {formatDuration(Math.round(minutesShown))}
            </span>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-fg">
            {/* It read "New none same period 2025": a badge and a fragment
                that only parsed together. With nothing to compare against,
                say so in a sentence instead of a figure. */}
            {delta == null ? (
              <span>Nothing logged in {compare.against} to compare with</span>
            ) : (
              <>
                <Delta value={delta} />
                <span>vs {compare.against}</span>
              </>
            )}
          </p>
        </div>
        {/* In plan against extra, drawn. It was a sentence under the figure and
            the right two thirds of the card were empty; the split is the one
            thing about a period's hours that is a proportion, so it is a bar. */}
        <PlanSplit completed={t.completed} extra={t.extra} missed={t.noShow} />
      </div>
      {/* THREE figures under the lead, not six (October 2026). Six of equal
          weight is the stat strip DESIGN.md bans: nothing ranked, so nothing
          read. Extra and missed time are already the bar beside the lead; the
          count of missed meetings rides as the hint of the figure it
          qualifies. */}
      <dl className="grid grid-cols-3 gap-x-6 gap-y-3 border-t border-line px-4 py-3 sm:px-5">
        <Stat
          label="Sessions"
          value={meetings.toLocaleString("en-US")}
          hint={
            t.noShows > 0
              ? `${formatDuration(avg)} on average · ${t.noShows} missed (${Math.round(noShowRate * 100)}%)`
              : `${formatDuration(avg)} on average`
          }
        />
        <Stat
          label="Students"
          value={t.students.toLocaleString("en-US")}
          hint={t.students ? `${formatDuration(t.hours / t.students)} each` : "—"}
        />
        {mentor == null ? (
          <Stat
            label="Mentors active"
            value={t.mentors.toLocaleString("en-US")}
            hint={t.mentors ? `${formatDuration(t.hours / t.mentors)} each` : "—"}
          />
        ) : (
          <Stat
            label="Busiest month"
            value={busiest ? MONTHS_LONG[busiest.month] : "—"}
            hint={
              busiest
                ? formatDuration(busiest.minutes)
                : "no sessions"
            }
          />
        )}
      </dl>
    </Section>
  );
}

/** Hours in plan, beyond it, and missed, as one proportional bar. */
function PlanSplit({ completed, extra, missed }: { completed: number; extra: number; missed: number }) {
  const total = completed + extra + missed;
  const pct = (m: number) => (total > 0 ? (m / total) * 100 : 0);
  return (
    <div
      className="w-full min-w-0 sm:w-72 lg:w-80"
      role="img"
      aria-label={`${formatDuration(completed)} in plan, ${formatDuration(extra)} extra, ${formatDuration(missed)} missed`}
    >
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-fill">
        {completed > 0 && (
          <span className="h-full rounded-full bg-accent" style={{ width: `${pct(completed)}%` }} />
        )}
        {extra > 0 && (
          <span
            className="h-full rounded-full bg-accent"
            style={{ width: `${pct(extra)}%`, opacity: EXTRA_OPACITY }}
          />
        )}
        {missed > 0 && (
          <span className="h-full rounded-full" style={{ width: `${pct(missed)}%`, background: fillOf(HOURS, true) }} />
        )}
      </div>
      <div className="mt-2 flex justify-between gap-4 text-xs text-muted-fg">
        <span>
          <span className="font-medium tabular-nums text-ink">{formatDuration(completed)}</span> in plan
        </span>
        <span>
          <span className="font-medium tabular-nums text-ink">{formatDuration(extra)}</span> extra
        </span>
        {/* Said even at nothing, as "extra" is: three figures that are always
            there read as a key; one that comes and goes reads as an alert. */}
        <span>
          <span className="font-medium tabular-nums text-ink">{formatDuration(missed)}</span> missed
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0">
      <dt className="min-w-0 truncate text-xs text-muted-fg">{label}</dt>
      <dd className="mt-0.5 text-figure-md font-semibold leading-tight tabular-nums text-ink">{value}</dd>
      {/* Wraps rather than truncating: a third of a phone is narrow, and the
          hint now carries the no-shows the strip used to give a column. */}
      <dd className="min-w-0 text-xs text-muted-fg">{hint}</dd>
    </div>
  );
}

/**
 * The change against the last period, as a glyph and a number in ink. It was
 * a green or red pill, but a quieter month is not a problem and red is for
 * problems — the arrow already says which way it went.
 */
function Delta({ value }: { value: number | null }) {
  if (value == null) return <span className="font-medium text-ink">New</span>;
  const pct = Math.round(value * 100);
  return (
    <span className="font-medium tabular-nums text-ink">
      {pct > 0 ? "▲" : pct < 0 ? "▼" : "•"} {Math.abs(pct)}%
    </span>
  );
}

/* ---------------------------------------------------------------- columns */

type Segment = { key: string; label: string; value: number; color: string; opacity?: number; striped?: boolean };
type Column = {
  key: string;
  label: string;
  /** A narrower label for a narrow chart: "S" for "Sep". */
  short?: string;
  title: string; segments: Segment[]; tally: Tally; weekend?: boolean };
type LegendItem = { label: string; color: string; opacity: number; striped?: boolean };

/**
 * How one level stacks its hours: by program, or in plan against extra — with
 * missed time on top either way, striped, so it is counted in the bar's height
 * and never mistaken for a program's delivered hours.
 */
function seriesFor(data: AnalyticsData, view: View, rows: AnalyticsRow[]) {
  const programsHere = new Set(rows.map((r) => r[0]));
  const anyMissed = rows.some((r) => r[5] === 2);
  const byProgram = view.program == null && programsHere.size > 1;
  const color =
    view.program != null
      ? colorOf(data, view.program)
      : programsHere.size === 1
        ? colorOf(data, [...programsHere][0])
        : DEFAULT;
  const programs = [...programsHere].sort((a, b) => a - b);

  const missedColor = byProgram ? DEFAULT : color;
  const segments = (bucket: AnalyticsRow[], tally: Tally): Segment[] => [
    ...(byProgram
      ? programs.map((p) => ({
          key: String(p),
          label: data.programs[p].name,
          color: colorOf(data, p),
          value: bucket.reduce((sum, r) => (r[0] === p && r[5] !== 2 ? sum + r[4] : sum), 0),
        }))
      : [
          { key: "plan", label: "In plan", color, value: tally.completed },
          { key: "extra", label: "Extra", color, value: tally.extra, opacity: EXTRA_OPACITY },
        ]),
    { key: "missed", label: "Missed", color: missedColor, value: tally.noShow, striped: true },
  ];

  const legend: LegendItem[] = [
    ...(byProgram
      ? programs.map((p) => ({ label: data.programs[p].name, color: colorOf(data, p), opacity: 1 }))
      : [
          { label: "In plan", color, opacity: 1 },
          { label: "Extra, out of plan", color, opacity: EXTRA_OPACITY },
        ]),
    ...(anyMissed ? [{ label: "Missed, charged", color: missedColor, opacity: 1, striped: true }] : []),
  ];

  return { segments, legend };
}

function MonthsCard({
  data,
  view,
  go,
  yearRows,
}: {
  data: AnalyticsData;
  view: View;
  go: (next: Partial<View>) => void;
  yearRows: AnalyticsRow[];
}) {
  const { year, month } = view;
  const { segments, legend } = useMemo(() => seriesFor(data, view, yearRows), [data, view, yearRows]);

  const columns = useMemo<Column[]>(() => {
    const buckets: AnalyticsRow[][] = Array.from({ length: 12 }, () => []);
    for (const r of yearRows) buckets[monthOf(r[3])].push(r);
    const tallies = byMonth(yearRows);
    return tallies.map((tally, i) => ({
      key: String(i),
      label: MONTHS[i],
      short: MONTHS[i][0],
      title: `${MONTHS_LONG[i]} ${year}`,
      segments: segments(buckets[i], tally),
      tally,
    }));
  }, [yearRows, year, segments]);

  const days = useMemo<Column[] | null>(() => {
    if (month == null) return null;
    const bucket = yearRows.filter((r) => monthOf(r[3]) === month);
    const byDate: AnalyticsRow[][] = [];
    for (const r of bucket) (byDate[dateOf(r[3]) - 1] ??= []).push(r);
    return byDay(bucket, year, month).map((tally, i) => {
      const weekday = new Date(Date.UTC(year, month, i + 1)).getUTCDay();
      return {
        key: String(i),
        label: String(i + 1),
        title: `${WEEKDAYS[weekday]}, ${i + 1} ${MONTHS_LONG[month]}`,
        segments: segments(byDate[i] ?? [], tally),
        tally,
        weekend: weekday === 0 || weekday === 6,
      };
    });
  }, [yearRows, year, month, segments]);

  // The year starts at its first month with anything in it. Six empty columns
  // before July were half the chart spent saying "nothing happened yet" —
  // true, but said once by the axis starting where the record does. A picked
  // month earlier than that (from the URL) still shows from there.
  const firstActive = columns.findIndex(
    (c) => hoursOf(c.tally) > 0 || c.tally.sessions > 0 || c.tally.noShows > 0,
  );
  const from = Math.max(0, Math.min(firstActive < 0 ? 0 : firstActive, month ?? 11));
  const shown = columns.slice(from);

  const monthTally = month != null ? columns[month].tally : null;
  const activeDays = days?.filter((d) => hoursOf(d.tally) > 0).length ?? 0;
  const bestDay = days?.reduce<Column | null>((best, d) => (!best || hoursOf(d.tally) > hoursOf(best.tally) ? d : best), null);

  return (
    <Section
      title="Month by month"
      // The column tooltip rises above the tallest bar, past the card's edge.
      className="overflow-visible!"
    >
      {legend.length > 1 && <Legend items={legend} className="px-4 pt-3 sm:px-5" />}
      <div className="px-4 py-3 sm:px-5">
        <Columns
          key={`${year}`}
          columns={shown}
          height={220}
          selected={month == null ? null : month - from}
          onSelect={(i) => go({ month: month === i + from ? null : i + from })}
          hint="Click to open this month"
        />
      </div>
      {days && month != null && monthTally && (
        <div className={cn(s.enter, "border-t border-line px-4 py-3 sm:px-5")} key={`${year}-${month}`}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-title font-semibold text-ink">Inside {MONTHS_LONG[month]}</h3>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-fg">
              <span>
                <span className="font-medium tabular-nums text-ink">{formatDuration(hoursOf(monthTally))}</span> total
              </span>
              <span>
                <span className="font-medium tabular-nums text-ink">{activeDays}</span> active {activeDays === 1 ? "day" : "days"}
              </span>
              {bestDay && hoursOf(bestDay.tally) > 0 && (
                <span>
                  busiest <span className="font-medium text-ink">{bestDay.title.split(",")[1].trim()}</span> · {formatDuration(hoursOf(bestDay.tally))}
                </span>
              )}
            </div>
          </div>
          <Columns columns={days} height={140} thin labelEvery={days.length > 20 ? 5 : 1} />
        </div>
      )}
    </Section>
  );
}

function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-fg", className)}>
      {items.map((l) => (
        <span key={l.label} className="inline-flex items-center gap-1.5">
          <Dot color={l.color} opacity={l.opacity} striped={l.striped} />
          {l.label}
        </span>
      ))}
    </div>
  );
}

function Columns({
  columns,
  height,
  selected = null,
  onSelect,
  thin = false,
  labelEvery = 1,
  hint,
}: {
  columns: Column[];
  height: number;
  selected?: number | null;
  onSelect?: (i: number) => void;
  thin?: boolean;
  labelEvery?: number;
  hint?: string;
}) {
  const grown = useGrown();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...columns.map((c) => c.segments.reduce((sum, x) => sum + x.value, 0)), 0);
  const axis = niceAxis(max, thin ? 2 : 4);
  const ticks: number[] = [];
  for (let v = 0; v <= axis.top + 1; v += axis.step) ticks.push(v);

  return (
    <div className={cn(s.chart, thin && s.thin)}>
      <div className={s.yAxis} style={{ height }}>
        {ticks.map((v) => (
          <span key={v} className={s.yTick} style={{ bottom: `${(v / axis.top) * 100}%` }}>
            {v === 0 ? "0" : shortHours(v)}
          </span>
        ))}
      </div>
      <div className={s.plot} style={{ height }}>
        {ticks.slice(1).map((v) => (
          <div key={v} className={s.gridline} style={{ bottom: `${(v / axis.top) * 100}%` }} />
        ))}
        <div className={s.cols}>
          {columns.map((c, i) => {
            const total = c.segments.reduce((sum, x) => sum + x.value, 0);
            const edge = i < 2 ? s.tooltipLeft : i > columns.length - 3 ? s.tooltipRight : "";
            const Tag = onSelect ? "button" : "div";
            return (
              <Tag
                key={c.key}
                type={onSelect ? "button" : undefined}
                className={cn(
                  s.col,
                  !onSelect && s.colStatic,
                  selected === i && s.colActive,
                  selected != null && selected !== i && s.dim
                )}
                // The tooltip goes with the click: left up after picking a bar,
                // it sat over the stat strip the click had just changed.
                onClick={
                  onSelect
                    ? () => {
                        setHover(null);
                        onSelect(i);
                      }
                    : undefined
                }
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-pressed={onSelect ? selected === i : undefined}
                aria-label={`${c.title}: ${formatDuration(total)}`}
              >
                <div className="relative flex w-full flex-col items-center">
                  {hover === i && (
                    <div className={cn(s.tooltip, edge)} role="tooltip">
                      <div className={s.tipTitle}>{c.title}</div>
                      {c.segments
                        .filter((x) => x.value > 0)
                        .map((x) => (
                          <div key={x.key} className={s.tipRow}>
                            <span className={s.tipKey}>
                              <Dot color={x.color} opacity={x.opacity} striped={x.striped} />
                              {x.label}
                            </span>
                            <span className={s.tipVal}>{formatDuration(x.value)}</span>
                          </div>
                        ))}
                      {/* The figure on the bar, so the rows above add up to something. */}
                      {c.segments.filter((x) => x.value > 0).length > 1 && (
                        <div className={cn(s.tipRow, s.tipTotal)}>
                          <span>Total</span>
                          <span className="tabular-nums">{formatDuration(total)}</span>
                        </div>
                      )}
                      <div className={s.tipRow}>
                        <span className={s.tipKey}>Sessions</span>
                        <span className={s.tipVal}>
                          {meetingsOf(c.tally)}
                          {c.tally.noShows > 0 && `, ${c.tally.noShows} missed`}
                        </span>
                      </div>
                      {total === 0 && <div className="text-muted-fg">No sessions</div>}
                      {hint && onSelect && selected !== i && <div className={s.tipHint}>{hint}</div>}
                    </div>
                  )}
                  {!thin && total > 0 && <span className={s.capLabel}>{shortHours(total)}</span>}
                  {!thin && total === 0 && <div className={s.empty} />}
                  <div className={s.stack}>
                    {c.segments.map((x, k) =>
                      x.value > 0 ? (
                        <div
                          key={x.key}
                          className={s.seg}
                          style={{
                            background: fillOf(x.color, x.striped),
                            opacity: x.opacity ?? 1,
                            height: grown ? Math.max(2, (x.value / axis.top) * height - 2) : 0,
                            ["--delay" as string]: `${i * (thin ? 12 : 35) + k * 40}ms`,
                          }}
                        />
                      ) : null
                    )}
                  </div>
                </div>
              </Tag>
            );
          })}
        </div>
      </div>
      <div className={s.xAxis}>
        {columns.map((c, i) => (
          <span
            key={c.key}
            className={cn(s.xLabel, selected === i && s.xLabelActive, c.weekend && s.xLabelWeekend)}
          >
            {i % labelEvery !== 0 && i !== columns.length - 1 ? (
              ""
            ) : c.short ? (
              // Both, and the chart's own width picks: twelve "Sep"s in a
              // 300px phone chart ran together into "NovDec".
              <>
                <span className={s.xLong}>{c.label}</span>
                <span className={s.xShort}>{c.short}</span>
              </>
            ) : (
              c.label
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- programs */

function ProgramCards({
  data,
  view,
  go,
  last,
  words,
}: {
  words: Words;
  data: AnalyticsData;
  view: View;
  go: (next: Partial<View>) => void;
  last: number;
}) {
  const { year, month } = view;
  const yearRows = useMemo(() => select(data.rows, { year }), [data.rows, year]);
  const periodRows = useMemo(() => (month == null ? yearRows : select(yearRows, { year, month })), [yearRows, year, month]);
  const ranked = useMemo(() => new Map(rankBy(periodRows, yearRows, 0).map((r) => [r.index, r])), [periodRows, yearRows]);
  const trends = useMemo(() => monthsByProgram(yearRows, data.programs.length), [yearRows, data.programs.length]);
  // Progress against a program's grant is a stock question: the drawn hours
  // are all-time, not the period's, so the gauge does not pretend the program
  // is barely started when March is picked.
  const drawn = useMemo(() => drawnByProgram(data.rows, data.programs.length), [data.rows, data.programs.length]);

  // Busiest first. A program with nothing logged in the period is not a card:
  // a full-height card of "0 min · 0 mentors · 0 students · 0 sessions" with
  // a flat sparkline is a lot of furniture to say "nothing yet", so those
  // are one quiet line each under the grid.
  const all = data.programs
    .map((p, i) => ({ p, i, r: ranked.get(i) }))
    .filter(({ p, r }) => !p.archived || r)
    .sort((a, b) => (b.r?.hours ?? 0) - (a.r?.hours ?? 0));
  const order = all.filter(({ r }) => (r?.hours ?? 0) > 0);
  const idle = all.filter(({ r }) => (r?.hours ?? 0) === 0);
  const period = month != null ? MONTHS_LONG[month] : String(year);

  return (
    <section className="@container min-w-0">
      {/* Section's own header, by hand: this group is a grid of cards rather
          than one card, and Section's body is always exactly one. Section's
          size, too — it was 20px, a step above every other heading. */}
      <div className="pb-2.5 pt-2">
        <h2 className="text-title font-semibold tracking-[-0.01em] text-ink">{words.parts}</h2>
      </div>
      <div className={cn("grid gap-3", cardColumns(order.length))}>
        {order.map(({ p, i, r }, n) => {
          const progress = p.granted > 0 ? drawn[i] / p.granted : 0;
          const color = colorOf(data, i);
          return (
            <button
              key={p.id}
              type="button"
              className={cn(
                s.rise,
                // Resting elevation on hover, plus a wash — `shadow-lg` is the
                // floating-menu height, and a card is not a menu.
                "group flex min-w-0 flex-col gap-3 rounded-xl bg-surface p-4 text-left shadow-sm transition-colors hover:bg-fill/40"
              )}
              style={{ ["--delay" as string]: `${n * 60}ms` }}
              onClick={() => go({ program: i, mentor: null })}
            >
              <span className="flex items-center gap-2">
                <Dot color={color} />
                <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{p.name}</span>
                {p.archived && (
                  <span className="shrink-0 rounded-full bg-fill px-2.5 py-[0.1875rem] text-xs font-medium text-muted-fg">Archived</span>
                )}
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-fg transition-transform group-hover:translate-x-0.5" />
              </span>
              {/* The figure never breaks ("9h / 30m"); the caption is what
                  gives way, wrapping beneath it when the card is narrow. */}
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="shrink-0 whitespace-nowrap text-figure-lg font-semibold leading-none tracking-tight tabular-nums text-ink">
                  {formatDuration(r?.hours ?? 0)}
                </span>
                {/* "TO DATE", said: the gauge is all-time on purpose (a grant
                    is a stock, not a flow), but beside a figure for the picked
                    period it read as that period's share — September and the
                    whole year both "13% of the 734h granted". */}
                <span className="min-w-0 text-xs tabular-nums text-muted-fg">
                  {p.granted > 0
                    ? `${Math.round(progress * 100)}% of ${formatDuration(p.granted)} total, to date`
                    : "no total set"}
                </span>
              </span>
              <span className="block h-1 overflow-hidden rounded-full bg-fill" aria-hidden>
                <span className={cn(s.shareFill, "block h-full rounded-full")} style={{ width: `${Math.min(100, progress * 100)}%`, background: color }} />
              </span>
              <Sparkline values={trends[i].slice(0, last + 1)} color={color} width={220} height={36} highlight={month} fluid />
              {/* Pinned to the card's foot, and broken only between its three
                  parts — it wrapped mid-phrase, so cards beside each other
                  ended at different heights. */}
              <span className="mt-auto flex flex-wrap gap-x-1.5 text-xs tabular-nums text-muted-fg">
                <span className="whitespace-nowrap">{count(r?.mentors ?? 0, "mentor")} ·</span>
                <span className="whitespace-nowrap">{count(r?.students ?? 0, "student")} ·</span>
                <span className="whitespace-nowrap">{count(r ? meetingsOf(r) : 0, "session")}</span>
              </span>
            </button>
          );
        })}
      </div>
      {idle.length > 0 && (
        <ul className={cn("overflow-clip rounded-xl bg-surface shadow-sm divide-y divide-line", order.length > 0 && "mt-3")}>
          {idle.map(({ p, i }) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => go({ program: i, mentor: null })}
                className="group flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-fg transition-colors hover:bg-fill/40 sm:px-5"
              >
                <Dot color={colorOf(data, i)} />
                <span className="min-w-0 truncate font-medium text-ink">{p.name}</span>
                <span className="min-w-0 flex-1 truncate">
                  · nothing logged in {period}
                  {p.granted > 0 ? ` · ${formatDuration(p.granted)} total` : ""}
                </span>
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-fg" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "1 mentor", "13 mentors". */
function count(n: number, noun: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? noun : `${noun}s`}`;
}

/**
 * Columns that never leave one card alone on the last row: four cards go
 * one, two, then four across; three go one, then three. It was an auto-fill
 * grid, which put four programs at 3 + 1 on a tablet. Container widths, not
 * the viewport's, because the sidebar takes a different share at each size.
 */
function cardColumns(n: number): string {
  if (n % 4 === 0) return "@lg:grid-cols-2 @4xl:grid-cols-4";
  if (n % 3 === 0) return "@2xl:grid-cols-3";
  if (n % 2 === 0) return "@lg:grid-cols-2";
  return "@lg:grid-cols-2 @4xl:grid-cols-3";
}

/* ------------------------------------------------------------ leaderboard */

function Leaderboard({
  data,
  view,
  go,
  title,
  ranked: withRank = true,
  periodRows,
  yearRows,
  limit,
  last,
}: {
  data: AnalyticsData;
  view: View;
  go: (next: Partial<View>) => void;
  title: string;
  /**
   * Whether the order is stated as a ranking. Off for a mentor reading it:
   * the rows still sort by hours — the list is the school's, and hiding
   * positions would only pretend it is not — but nobody's own work needs a
   * place number against their colleagues'.
   */
  ranked?: boolean;
  periodRows: AnalyticsRow[];
  yearRows: AnalyticsRow[];
  limit?: number;
  last: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const ranked = useMemo(() => rankBy(periodRows, yearRows, 1), [periodRows, yearRows]);
  // A search looks through everyone in the list, not just the rows showing,
  // and keeps each mentor's place in the full order: a filtered "3" is still
  // third, not first of one.
  const needle = query.trim().toLowerCase();
  const found = useMemo(
    () =>
      ranked
        .map((r, n) => ({ r, rank: n + 1 }))
        .filter(({ r }) => !needle || data.mentors[r.index].name.toLowerCase().includes(needle)),
    [ranked, needle, data.mentors]
  );
  const shown = limit && !expanded && !needle ? found.slice(0, limit) : found;
  const top = ranked[0]?.hours ?? 0;
  const period = view.month != null ? MONTHS_LONG[view.month] : String(view.year);

  return (
    <Section
      title={title}
      eyebrow={`${withRank ? "Ranked by" : "Most"} hours with students in ${period}.`}
      action={
        // `py-2.5` cancels the action slot's -my-2, which is for a 44px link
        // and left this 12px legend hard against the top edge of the card.
        <Legend
          className="py-2.5"
          items={[
            { label: "In plan", color: HOURS, opacity: 1 },
            { label: "Extra", color: HOURS, opacity: EXTRA_OPACITY },
            { label: "Missed", color: HOURS, opacity: 1, striped: true },
          ]}
        />
      }
    >
      {ranked.length === 0 ? (
        <p className="px-4 py-3 text-body text-muted-fg sm:px-5">No mentor logged a session in {period}.</p>
      ) : (
        <>
          <label className="relative block border-b border-line px-4 py-2.5 sm:px-5">
            <span className="sr-only">Search mentors</span>
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg sm:left-8"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search mentors"
              autoComplete="off"
              enterKeyHint="search"
              className="pl-9 [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
          {found.length === 0 && (
            <p className="px-4 py-3 text-body text-muted-fg sm:px-5">
              No mentor matching “{query.trim()}” logged a session in {period}.
            </p>
          )}
          <div className="divide-y divide-line">
            {shown.map(({ r, rank }, n) => (
              <MentorRow
                key={r.index}
                r={r}
                last={last}
                rank={rank}
                showRank={withRank}
                top={top}
                mentor={data.mentors[r.index]}
                highlight={view.month}
                delay={n * 40}
                onOpen={() => go({ mentor: r.index })}
              />
            ))}
          </div>
        </>
      )}
      {limit && !needle && ranked.length > limit && (
        <button
          type="button"
          className="block w-full border-t border-line px-4 py-3 text-left text-body font-medium text-brand transition-colors hover:bg-fill sm:px-5"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "Show the top " + limit : `Show all ${ranked.length} mentors`}
        </button>
      )}
    </Section>
  );
}

function MentorRow({
  r,
  last,
  rank,
  showRank = true,
  top,
  mentor,
  highlight,
  delay,
  onOpen,
}: {
  r: Ranked;
  last: number;
  rank: number;
  /** Place numbers are for staff; a mentor gets the list, not a ranking. */
  showRank?: boolean;
  top: number;
  mentor: AnalyticsMentor;
  highlight: number | null;
  delay: number;
  onOpen: () => void;
}) {
  const grown = useGrown();
  const scale = top ? 100 / top : 0;
  return (
    <button
      type="button"
      className={cn(
        s.rise,
        "group grid min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fill sm:px-5",
        showRank
          ? "grid-cols-[1.25rem_auto_minmax(0,1fr)_auto_auto]"
          : "grid-cols-[auto_minmax(0,1fr)_auto_auto]"
      )}
      onClick={onOpen}
      style={{ ["--delay" as string]: `${delay}ms` }}
    >
      {showRank && (
        <span className="text-center text-xs tabular-nums text-muted-fg">{rank}</span>
      )}
      <MentorAvatar mentor={mentor} />
      <span className="flex min-w-0 flex-col">
        <span className="min-w-0 truncate text-body font-medium text-ink">{mentor.name}</span>
        <span className="mt-1.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-fill" aria-hidden>
          <span className={s.barSeg} style={{ width: grown ? `${r.completed * scale}%` : 0, background: HOURS }} />
          {r.extra > 0 && (
            <span
              className={s.barSeg}
              style={{ width: grown ? `${r.extra * scale}%` : 0, background: HOURS, opacity: EXTRA_OPACITY }}
            />
          )}
          {r.noShow > 0 && (
            <span
              className={s.barSeg}
              style={{ width: grown ? `${r.noShow * scale}%` : 0, background: fillOf(HOURS, true) }}
            />
          )}
        </span>
        <span className="mt-1 min-w-0 truncate text-xs text-muted-fg">
          {meetingsOf(r)} {meetingsOf(r) === 1 ? "session" : "sessions"}
          {r.noShows ? ` (${r.noShows} missed)` : ""} · {r.students} {r.students === 1 ? "student" : "students"}
          {meetingsOf(r) ? ` · ${formatDuration(r.hours / meetingsOf(r))} avg` : ""}
        </span>
      </span>
      <span className="flex items-center gap-3">
        <span className="max-sm:hidden">
          <Sparkline
            values={r.trend.slice(0, last + 1)}
            color="var(--color-muted-fg)"
            dotColor={HOURS}
            width={72}
            height={24}
            highlight={highlight}
          />
        </span>
        <span className="min-w-12 whitespace-nowrap text-right text-body font-semibold tabular-nums text-ink">{formatDuration(r.hours)}</span>
      </span>
      <ChevronRightIcon className="h-4 w-4 text-muted-fg transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

/* ----------------------------------------------------------------- mentor */

function MentorDetail({
  view,
  today,
  go,
  yearRows,
  accent,
  self = false,
}: {
  view: View;
  today: Today;
  go: (next: Partial<View>) => void;
  yearRows: AnalyticsRow[];
  accent: string;
  /** The reader is this mentor: speak to them, not about them. */
  self?: boolean;
}) {
  const { year, month } = view;

  const months = useMemo(() => byMonth(yearRows), [yearRows]);
  const students = useMemo(() => {
    const out = Array.from({ length: 12 }, () => new Set<number>());
    for (const r of yearRows) out[monthOf(r[3])].add(r[2]);
    return out.map((x) => x.size);
  }, [yearRows]);
  const maxMonth = Math.max(...months.map(hoursOf), 1);
  const lastMonth = year === today.year ? today.month : 11;
  // The table starts at the first month with a session in it: six rows of
  // "—" from January to June were the first thing a mentor who started in
  // July read about their own year.
  const firstMonth = Math.max(
    0,
    months.findIndex((m) => hoursOf(m) > 0 || m.sessions > 0 || m.noShows > 0),
  );
  // The month in progress gets no change figure: "▼ 99%" on October 5 was a
  // fall that had not happened, measured against a month that had finished.
  const running = year === today.year ? today.month : -1;

  return (
    <>
      <Section title={`Every day of ${year}`}>
        <div className="px-4 py-3 sm:px-5">
          <Heatmap rows={yearRows} year={year} color={accent} selected={month} onPick={(m) => go({ month: m })} />
        </div>
      </Section>
      <Section
        title={self ? "What you logged each month" : "What they logged each month"}
      >
        {/* `scroll-x` rather than a bare overflow: on a phone the last columns
            run past the card, and the fade is what says there is more. */}
        <div className="scroll-x px-4 py-2 sm:px-5">
          <table className={s.table}>
            <thead>
              <tr>
                <th>Month</th>
                <th>Hours</th>
                <th>Sessions</th>
                <th>Missed</th>
                <th>Students</th>
                <th>Avg</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                if (i > lastMonth || i < firstMonth) return null;
                const h = hoursOf(m);
                const prev = i > 0 ? hoursOf(months[i - 1]) : 0;
                const d = change(h, prev);
                return (
                  <tr
                    key={i}
                    className={cn(month === i && s.rowOn, h === 0 && s.rowEmpty)}
                    onClick={() => go({ month: month === i ? null : i })}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        go({ month: month === i ? null : i });
                      }
                    }}
                  >
                    <td>
                      <span className="max-sm:hidden">{MONTHS_LONG[i]}</span>
                      <span className="sm:hidden">{MONTHS[i]}</span>
                    </td>
                    <td>
                      <span className={s.inlineBar} style={{ width: (h / maxMonth) * 48, background: accent }} />
                      <span className="font-medium">{h ? formatDuration(h) : "—"}</span>
                    </td>
                    <td>{meetingsOf(m) || "—"}</td>
                    <td>{m.noShow ? formatDuration(m.noShow) : "—"}</td>
                    <td>{students[i] || "—"}</td>
                    <td>{meetingsOf(m) ? formatDuration(h / meetingsOf(m)) : "—"}</td>
                    <td className="text-xs">
                      {i === firstMonth || i === running || (h === 0 && prev === 0) ? (
                        i === running ? <span className="text-muted-fg">so far</span> : ""
                      ) : (
                        <Delta value={d} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

/** Which of the mentor's programs to read, and — for staff — where they stand in it. */
function MentorScope({
  data,
  view,
  go,
  ranked = true,
  words,
}: {
  words: Words;
  data: AnalyticsData;
  view: View;
  go: (next: Partial<View>) => void;
  /** Staff see "#n of m mentors"; a mentor looking at a colleague needs no ranking. */
  ranked?: boolean;
}) {
  const { year, month, program, mentor } = view;

  // Every program this mentor has hours in this year, for the switcher.
  const theirPrograms = useMemo(() => {
    const ids = new Set(select(data.rows, { year, mentor }).map((r) => r[0]));
    return [...ids].sort((a, b) => a - b);
  }, [data.rows, year, mentor]);

  // Where they stand among the mentors of the same scope.
  const standing = useMemo(() => {
    const scopeRows = select(data.rows, { year, month, program });
    const ranked = rankBy(scopeRows, scopeRows, 1);
    const at = ranked.findIndex((r) => r.index === mentor);
    return at < 0 ? null : { rank: at + 1, of: ranked.length };
  }, [data.rows, year, month, program, mentor]);

  if (theirPrograms.length === 0) return null;
  // Filter chips on the page ground, the way every other filter in the app
  // sits — a card around two chips was a box with nothing to hold.
  const chip = (on: boolean) =>
    cn(
      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
      on ? "bg-brand text-on-brand" : "bg-fill text-ink hover:bg-fill-strong"
    );
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {theirPrograms.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Program">
          <button type="button" className={chip(program == null)} aria-pressed={program == null} onClick={() => go({ program: null })}>
            {words.allChip}
          </button>
          {theirPrograms.map((p) => (
            <button
              key={p}
              type="button"
              className={chip(program === p)}
              aria-pressed={program === p}
              onClick={() => go({ program: p })}
            >
              <Dot color={colorOf(data, p)} />
              {data.programs[p].name}
            </button>
          ))}
        </div>
      ) : (
        <span className="text-xs text-muted-fg">
          Works in {data.programs[theirPrograms[0]]?.name}
        </span>
      )}
      {ranked && standing && (
        <span className="text-xs text-muted-fg">
          <span className="font-medium tabular-nums text-ink">#{standing.rank}</span> of {standing.of} mentors
          {program != null ? ` in ${data.programs[program].name}` : ""} ·{" "}
          {month != null ? MONTHS_LONG[month] : year}
        </span>
      )}
    </div>
  );
}

function Heatmap({
  rows,
  year,
  color,
  selected,
  onPick,
}: {
  rows: AnalyticsRow[];
  year: number;
  color: string;
  selected: number | null;
  onPick: (month: number) => void;
}) {
  const weeks = useMemo(() => weeksOf(year), [year]);
  const hours = useMemo(() => hoursByDay(rows), [rows]);
  // A phone shows about twenty weeks of the fifty-three. Open on the end of
  // the year, where the recent days are, rather than on an empty January.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [year]);
  const max = Math.max(...hours.values(), 1);
  const level = (m: number) => (m <= 0 ? 0 : m / max <= 0.25 ? 1 : m / max <= 0.5 ? 2 : m / max <= 0.75 ? 3 : 4);
  const mix = [0, 28, 52, 76, 100];
  const fill = (lv: number) =>
    lv === 0 ? undefined : `color-mix(in oklab, ${color} ${mix[lv]}%, var(--color-surface))`;

  return (
    <>
      <div ref={scroller} className={cn(s.heat, "scroll-x")}>
        <div className={s.heatGrid}>
          {weeks.map((week, w) => {
            // Label the week a month begins in, and the first week of the year.
            const opener = week.find((d) => d != null && (dateOf(d) === 1 || w === 0));
            const labelMonth = opener != null ? monthOf(opener) : null;
            return [
              <span key={`m${w}`} className={s.heatMonth}>
                {labelMonth != null ? MONTHS[labelMonth] : ""}
              </span>,
              ...week.map((d, k) => {
                if (d == null) return <span key={`${w}-${k}`} className={cn(s.heatCell, s.heatVoid)} />;
                const m = hours.get(d) ?? 0;
                const mo = monthOf(d);
                const date = new Date(Date.UTC(year, mo, dateOf(d)));
                const label = `${WEEKDAYS[date.getUTCDay()]}, ${dateOf(d)} ${MONTHS[mo]}: ${m ? formatDuration(m) : "no sessions"}`;
                return (
                  <button
                    key={`${w}-${k}`}
                    type="button"
                    className={s.heatCell}
                    title={label}
                    aria-label={label}
                    onClick={() => onPick(mo)}
                    style={{
                      background: fill(level(m)),
                      opacity: selected != null && selected !== mo ? 0.35 : 1,
                      cursor: "pointer",
                    }}
                  />
                );
              }),
            ];
          })}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-xs text-muted-fg">
        Less
        {[0, 1, 2, 3, 4].map((lv) => (
          <span key={lv} className={s.heatCell} style={{ background: fill(lv) }} />
        ))}
        More
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ bits */

function Sparkline({
  values,
  color,
  dotColor = color,
  width,
  height,
  highlight,
  fluid = false,
}: {
  values: number[];
  color: string;
  /** The current-month marker, when the line itself is a quiet grey. */
  dotColor?: string;
  width: number;
  height: number;
  highlight: number | null;
  fluid?: boolean;
}) {
  const max = Math.max(...values, 1);
  const pad = 4;
  const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(values.length - 1)},${height - pad}L${x(0)},${height - pad}Z`;
  let dot = highlight;
  if (dot == null) for (let i = values.length - 1; i >= 0; i--) if (values[i] > 0) { dot = i; break; }

  return (
    <svg
      className={s.spark}
      width={fluid ? "100%" : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={area} fill={color} opacity={0.08} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {dot != null && !fluid && (
        <circle cx={x(dot)} cy={y(values[dot])} r={3} fill={dotColor} stroke="var(--color-surface)" strokeWidth={1.5} />
      )}
      {dot != null && fluid && highlight != null && (
        <line x1={x(dot)} x2={x(dot)} y1={pad} y2={height - pad} stroke={color} strokeWidth={1} opacity={0.5} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

/** A small round mark in a series colour — the app's program dot, any hue. */
function Dot({
  color,
  opacity,
  striped,
  className,
}: {
  color: string;
  opacity?: number;
  striped?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("h-2 w-2 shrink-0 rounded-full", className)}
      style={{ background: fillOf(color, striped), opacity }}
    />
  );
}

/**
 * The app's avatar, drawn from what the analytics read carries. `Avatar`
 * wants the upload timestamp to build its URL; the read already hands over
 * the built URL, so this renders the same two shapes — a photo ringed in the
 * person's hue, or their initials on it — without rebuilding it.
 */
function MentorAvatar({ mentor, large = false }: { mentor: AnalyticsMentor; large?: boolean }) {
  const size = large ? "h-12 w-12 text-base" : "h-9 w-9 text-xs";
  const tone = personTone(mentor.id);
  if (mentor.avatar) {
    // eslint-disable-next-line @next/next/no-img-element -- a served avatar, already sized
    return <img src={mentor.avatar} alt="" aria-hidden className={cn("shrink-0 rounded-full bg-canvas object-cover ring-2", tone.ring, size)} />;
  }
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold text-on-tone", tone.badge, size)}
    >
      {initials(mentor.name, "")}
    </span>
  );
}

function Crumb({ current, onClick, children }: { current: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors",
        current ? "cursor-default font-medium text-ink" : "text-muted-fg hover:bg-fill hover:text-ink"
      )}
      onClick={current ? undefined : onClick}
      aria-current={current ? "page" : undefined}
    >
      {children}
    </button>
  );
}
