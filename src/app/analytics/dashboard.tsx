"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { AnalyticsData, AnalyticsMentor, AnalyticsRow } from "@/lib/analytics";
import {
  byDay,
  byMonth,
  change,
  dateOf,
  hoursByDay,
  hoursOf,
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
import { formatDuration } from "@/lib/format";

import s from "./dashboard.module.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Fixed slot per program, by its place in the name-sorted list — never by rank. */
const SLOTS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];
const colorOf = (program: number) => SLOTS[program] ?? "var(--other)";

type Today = { year: number; month: number; day: number };
type View = { year: number; month: number | null; program: number | null; mentor: number | null };

export function Dashboard({ data, today }: { data: AnalyticsData; today: Today }) {
  const [view, go] = useView(data, today);
  const { year, month, program, mentor } = view;
  const accent = program != null ? colorOf(program) : "var(--s1)";

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

  return (
    <div className={s.root} style={{ ["--accent" as string]: accent }}>
      <header className={s.header}>
        <div style={{ minWidth: 0 }}>
          <p className={s.eyebrow}>Analytics · hours delivered</p>
          <h1 className={s.title}>
            {mentorRow ? (
              <Avatar mentor={mentorRow} color={accent} large />
            ) : programRow ? (
              <span className={s.dot} style={{ background: accent, width: 14, height: 14 }} />
            ) : null}
            <span className={s.titleText}>
              {mentorRow?.name ?? programRow?.name ?? "All programs"}
            </span>
          </h1>
          {(programRow || mentorRow) && (
          <nav className={s.crumbs} aria-label="Where you are">
            <Crumb current={program == null && mentor == null} onClick={() => go({ program: null, mentor: null })}>
              All programs
            </Crumb>
            {programRow && (
              <>
                <span className={s.crumbSep}>/</span>
                <Crumb current={mentor == null} onClick={() => go({ mentor: null })}>
                  <span className={s.swatch} style={{ background: accent }} />
                  {programRow.name}
                </Crumb>
              </>
            )}
            {mentorRow && (
              <>
                <span className={s.crumbSep}>/</span>
                <Crumb current onClick={() => undefined}>{mentorRow.name}</Crumb>
              </>
            )}
          </nav>
          )}
        </div>
        <div className={s.controls}>
          {month != null && (
            <button type="button" className={s.pill} onClick={() => go({ month: null })} aria-label="Show the whole year">
              {MONTHS_LONG[month]}
              <span className={s.pillX} aria-hidden>×</span>
            </button>
          )}
          <div className={s.stepper}>
            <button
              type="button"
              className={s.stepBtn}
              aria-label="Previous year"
              disabled={year <= years[years.length - 1]}
              onClick={() => go({ year: year - 1, month: null })}
            >
              <Chevron dir="left" />
            </button>
            <span className={s.stepValue}>{year}</span>
            <button
              type="button"
              className={s.stepBtn}
              aria-label="Next year"
              disabled={year >= today.year}
              onClick={() => go({ year: year + 1, month: null })}
            >
              <Chevron dir="right" />
            </button>
          </div>
        </div>
      </header>

      {yearRows.length === 0 ? (
        <section className={`${s.card} ${s.enter}`} key={`empty-${level}-${year}`}>
          <div className={s.empty}>
            <div className={s.emptyArt}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 20h16M7 16v-3M12 16V9M17 16v-6" />
              </svg>
            </div>
            <p className={s.emptyTitle}>No sessions logged in {year}</p>
            <p style={{ margin: 0 }}>
              {mentorRow
                ? `${mentorRow.name} has no meetings on record here for this year.`
                : "Hours show up on this page once mentors log their meetings."}
            </p>
            {latestWithData != null && latestWithData !== year && (
              <button type="button" className={s.linkBtn} onClick={() => go({ year: latestWithData, month: null })}>
                Jump to {latestWithData}
              </button>
            )}
          </div>
        </section>
      ) : (
        <div key={`${level}`} className={s.enter} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {mentor != null && <MentorScope data={data} view={view} go={go} />}
          <Hero data={data} view={view} today={today} yearRows={yearRows} periodRows={periodRows} />
          <MonthsCard data={data} view={view} go={go} yearRows={yearRows} />
          {program == null && mentor == null && (
            <>
              <ProgramCards data={data} view={view} go={go} last={last} />
              <Leaderboard
                data={data}
                view={view}
                go={go}
                title="Top mentors across the school"
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
              title="Who delivered the most"
              periodRows={periodRows}
              yearRows={yearRows}
              last={last}
            />
          )}
          {mentor != null && <MentorDetail view={view} today={today} go={go} yearRows={yearRows} />}
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
function useView(data: AnalyticsData, today: Today): [View, (next: Partial<View>) => void] {
  const params = useSearchParams();

  const view = useMemo<View>(() => {
    const y = Number(params.get("y"));
    const m = Number(params.get("m"));
    const p = data.programs.findIndex((x) => x.id === params.get("p"));
    const u = data.mentors.findIndex((x) => x.id === params.get("u"));
    return {
      year: Number.isInteger(y) && y > 2000 && y <= today.year ? y : today.year,
      month: Number.isInteger(m) && m >= 1 && m <= 12 ? m - 1 : null,
      program: p >= 0 ? p : null,
      mentor: u >= 0 ? u : null,
    };
  }, [params, data.programs, data.mentors, today.year]);

  const go = useCallback(
    (next: Partial<View>) => {
      const v = { ...view, ...next };
      const q = new URLSearchParams();
      if (v.year !== today.year) q.set("y", String(v.year));
      if (v.month != null) q.set("m", String(v.month + 1));
      if (v.program != null) q.set("p", data.programs[v.program].id);
      if (v.mentor != null) q.set("u", data.mentors[v.mentor].id);
      const qs = q.toString();
      window.history.pushState(null, "", qs ? `?${qs}` : window.location.pathname);
    },
    [view, today.year, data.programs, data.mentors]
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
      const label = running ? `vs ${MONTHS[pm]} 1–${today.day}` : `vs ${MONTHS_LONG[pm]}`;
      const nowRows = running ? periodRows.filter((r) => dateOf(r[3]) <= today.day) : periodRows;
      return { before: totals(rows).hours, now: totals(nowRows).hours, label };
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
      label: running ? `vs same period ${year - 1}` : `vs ${year - 1}`,
    };
  }, [data.rows, year, month, program, mentor, today, periodRows, t.hours]);

  const delta = change(compare.now, compare.before);
  const hours = useCountUp(t.hours / 60);
  const avg = t.sessions ? t.hours / t.sessions : 0;
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

  const period = month != null ? `${MONTHS_LONG[month]} ${year}` : String(year);

  return (
    <section className={`${s.card} ${s.hero}`}>
      <div className={s.heroMain}>
        <span className={s.heroLabel}>Hours with students · {period}</span>
        <div className={s.heroValue} aria-label={formatDuration(t.hours)}>
          {hours < 100 ? hours.toFixed(1) : Math.round(hours).toLocaleString("en-US")}
          <span className={s.heroUnit}>hours</span>
        </div>
        <div className={s.heroFoot}>
          <Delta value={delta} />
          <span>{delta == null ? (compare.before === 0 ? `none ${compare.label.slice(3)}` : "") : compare.label}</span>
        </div>
        <div className={s.heroFoot} style={{ marginTop: 4 }}>
          <span>
            <b style={{ color: "var(--ink-2)" }}>{formatDuration(t.completed)}</b> in plan
          </span>
          <span>·</span>
          <span>
            <b style={{ color: "var(--ink-2)" }}>{formatDuration(t.extra)}</b> extra
          </span>
        </div>
      </div>
      <div className={s.stats}>
        <Stat label="Sessions" value={t.sessions.toLocaleString("en-US")} hint={`${shortHours(avg)} on average`} />
        <Stat label="Students met" value={t.students.toLocaleString("en-US")} hint={t.students ? `${shortHours(t.hours / t.students)} each` : "—"} />
        {mentor == null ? (
          <Stat label="Mentors active" value={t.mentors.toLocaleString("en-US")} hint={t.mentors ? `${shortHours(t.hours / t.mentors)} each` : "—"} />
        ) : (
          <Stat
            label="Busiest month"
            value={busiest ? MONTHS[busiest.month] : "—"}
            hint={busiest ? shortHours(busiest.minutes) : "no sessions"}
          />
        )}
        <Stat label="Extra time" value={shortHours(t.extra)} hint="out of plan" />
        <Stat label="No-shows" value={t.noShows.toLocaleString("en-US")} hint={`${Math.round(noShowRate * 100)}% of sessions`} />
        <Stat label="Per week" value={shortHours(t.hours / weeksSpanned(year, month, today))} hint="average" />
      </div>
    </section>
  );
}

/** Weeks the period has actually run for — a running year is not 52 weeks old. */
function weeksSpanned(year: number, month: number | null, today: Today): number {
  const start = Date.UTC(year, month ?? 0, 1);
  const naturalEnd = month == null ? Date.UTC(year + 1, 0, 1) : Date.UTC(year, month + 1, 1);
  const now = Date.UTC(today.year, today.month, today.day + 1);
  const end = Math.min(naturalEnd, now);
  return Math.max(1, (end - start) / (7 * 86400000));
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className={s.stat}>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue}>{value}</div>
      <div className={s.statHint}>{hint}</div>
    </div>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value == null) return <span className={`${s.delta} ${s.deltaFlat}`}>new</span>;
  const pct = Math.round(value * 100);
  const cls = pct > 0 ? s.deltaUp : pct < 0 ? s.deltaDown : s.deltaFlat;
  return (
    <span className={`${s.delta} ${cls}`}>
      {pct > 0 ? "▲" : pct < 0 ? "▼" : "•"} {Math.abs(pct)}%
    </span>
  );
}

/* ---------------------------------------------------------------- columns */

type Segment = { key: string; label: string; value: number; color: string; opacity?: number };
type Column = { key: string; label: string; title: string; segments: Segment[]; tally: Tally; weekend?: boolean };

/** How one level stacks its hours: by program, or in plan against extra. */
function seriesFor(data: AnalyticsData, view: View, rows: AnalyticsRow[]) {
  const programsHere = new Set(rows.filter((r) => r[5] !== 2).map((r) => r[0]));
  const byProgram = view.program == null && programsHere.size > 1;
  const color = view.program != null ? colorOf(view.program) : programsHere.size === 1 ? colorOf([...programsHere][0]) : "var(--s1)";
  const programs = [...programsHere].sort((a, b) => a - b);

  const segments = (bucket: AnalyticsRow[], tally: Tally): Segment[] =>
    byProgram
      ? programs.map((p) => ({
          key: String(p),
          label: data.programs[p].name,
          color: colorOf(p),
          value: bucket.reduce((sum, r) => (r[0] === p && r[5] !== 2 ? sum + r[4] : sum), 0),
        }))
      : [
          { key: "plan", label: "In plan", color, value: tally.completed },
          { key: "extra", label: "Extra", color, value: tally.extra, opacity: 0.4 },
        ];

  const legend = byProgram
    ? programs.map((p) => ({ label: data.programs[p].name, color: colorOf(p), opacity: 1 }))
    : [
        { label: "In plan", color, opacity: 1 },
        { label: "Extra, out of plan", color, opacity: 0.4 },
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

  const monthTally = month != null ? columns[month].tally : null;
  const activeDays = days?.filter((d) => hoursOf(d.tally) > 0).length ?? 0;
  const bestDay = days?.reduce<Column | null>((best, d) => (!best || hoursOf(d.tally) > hoursOf(best.tally) ? d : best), null);

  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <div>
          <h2 className={s.cardTitle}>Month by month</h2>
          <p className={s.cardSub}>
            {month == null ? "Pick a month to open it day by day." : "Pick the month again, or another, to switch."}
          </p>
        </div>
        {legend.length > 1 && (
          <div className={s.legend}>
            {legend.map((l) => (
              <span key={l.label} className={s.legendItem}>
                <span className={s.swatch} style={{ background: l.color, opacity: l.opacity }} />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <Columns
        key={`${year}`}
        columns={columns}
        height={220}
        selected={month}
        onSelect={(i) => go({ month: month === i ? null : i })}
        hint="Click to open this month"
      />
      {days && month != null && monthTally && (
        <div className={s.drawer} key={`${year}-${month}`}>
          <div className={s.drawerHead}>
            <h3 className={s.cardTitle}>Inside {MONTHS_LONG[month]}</h3>
            <div className={s.drawerFacts}>
              <span>
                <b>{formatDuration(hoursOf(monthTally))}</b> total
              </span>
              <span>
                <b>{activeDays}</b> active {activeDays === 1 ? "day" : "days"}
              </span>
              {bestDay && hoursOf(bestDay.tally) > 0 && (
                <span>
                  busiest <b>{bestDay.title.split(",")[1].trim()}</b> · {shortHours(hoursOf(bestDay.tally))}
                </span>
              )}
            </div>
          </div>
          <Columns columns={days} height={140} thin labelEvery={days.length > 20 ? 5 : 1} />
        </div>
      )}
    </section>
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
    <div className={`${s.chart} ${thin ? s.thin : ""}`}>
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
                className={[
                  s.col,
                  !onSelect && s.colStatic,
                  selected === i && s.colActive,
                  selected != null && selected !== i && s.dim,
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={onSelect ? () => onSelect(i) : undefined}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-pressed={onSelect ? selected === i : undefined}
                aria-label={`${c.title}: ${formatDuration(total)}`}
              >
                <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                  {hover === i && (
                    <div className={`${s.tooltip} ${edge}`} role="tooltip">
                      <div className={s.tipTitle}>{c.title}</div>
                      {c.segments
                        .filter((x) => x.value > 0)
                        .map((x) => (
                          <div key={x.key} className={s.tipRow}>
                            <span className={s.tipKey}>
                              <span className={s.swatch} style={{ background: x.color, opacity: x.opacity ?? 1 }} />
                              {x.label}
                            </span>
                            <span className={s.tipVal}>{formatDuration(x.value)}</span>
                          </div>
                        ))}
                      <div className={s.tipRow}>
                        <span className={s.tipKey}>Sessions</span>
                        <span className={s.tipVal}>{c.tally.sessions}</span>
                      </div>
                      {c.tally.noShows > 0 && (
                        <div className={s.tipRow}>
                          <span className={s.tipKey}>No-shows</span>
                          <span className={s.tipVal}>{c.tally.noShows}</span>
                        </div>
                      )}
                      {total === 0 && c.tally.noShows === 0 && <div style={{ opacity: 0.7 }}>No sessions</div>}
                      {hint && onSelect && selected !== i && <div className={s.tipHint}>{hint}</div>}
                    </div>
                  )}
                  {!thin && total > 0 && <span className={s.capLabel}>{shortHours(total)}</span>}
                  <div className={s.stack}>
                    {c.segments.map((x, k) =>
                      x.value > 0 ? (
                        <div
                          key={x.key}
                          className={s.seg}
                          style={{
                            background: x.color,
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
            className={[s.xLabel, selected === i && s.xLabelActive, c.weekend && s.xLabelWeekend].filter(Boolean).join(" ")}
          >
            {i % labelEvery === 0 || i === columns.length - 1 ? c.label : ""}
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
}: {
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
  const all = totals(periodRows).hours;

  // Busiest first; a program with no hours this period still gets a card, last.
  const order = data.programs
    .map((p, i) => ({ p, i, r: ranked.get(i) }))
    .filter(({ p, r }) => !p.archived || r)
    .sort((a, b) => (b.r?.hours ?? 0) - (a.r?.hours ?? 0));

  return (
    <section>
      <div className={s.cardHead} style={{ marginBottom: 12 }}>
        <div>
          <h2 className={s.cardTitle}>Programs</h2>
          <p className={s.cardSub}>Open one to see which mentors carry it.</p>
        </div>
      </div>
      <div className={s.programGrid}>
        {order.map(({ p, i, r }, n) => {
          const share = all ? (r?.hours ?? 0) / all : 0;
          return (
            <button
              key={p.id}
              type="button"
              className={s.programCard}
              style={{ ["--c" as string]: colorOf(i), ["--delay" as string]: `${n * 60}ms` }}
              onClick={() => go({ program: i, mentor: null })}
            >
              <div className={s.programTop}>
                <span className={s.programName}>
                  <span className={s.dot} style={{ background: colorOf(i) }} />
                  <span className={s.programNameText}>{p.name}</span>
                  {p.archived && <span className={s.tag}>Archived</span>}
                </span>
                <Chevron dir="right" className={s.chev} />
              </div>
              <div className={s.programFigure}>
                <span className={s.programHours}>{shortHours(r?.hours ?? 0)}</span>
                <span className={s.programShare}>{Math.round(share * 100)}% of all hours</span>
              </div>
              <div className={s.shareTrack}>
                <div className={s.shareFill} style={{ width: `${share * 100}%` }} />
              </div>
              <Sparkline values={trends[i].slice(0, last + 1)} color={colorOf(i)} width={220} height={40} highlight={month} fluid />
              <div className={s.programMeta}>
                <span>
                  <b>{r?.mentors ?? 0}</b> mentors
                </span>
                <span>
                  <b>{r?.students ?? 0}</b> students
                </span>
                <span>
                  <b>{r?.sessions ?? 0}</b> sessions
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ leaderboard */

function Leaderboard({
  data,
  view,
  go,
  title,
  periodRows,
  yearRows,
  limit,
  last,
}: {
  data: AnalyticsData;
  view: View;
  go: (next: Partial<View>) => void;
  title: string;
  periodRows: AnalyticsRow[];
  yearRows: AnalyticsRow[];
  limit?: number;
  last: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const ranked = useMemo(() => rankBy(periodRows, yearRows, 1), [periodRows, yearRows]);
  const shown = limit && !expanded ? ranked.slice(0, limit) : ranked;
  const top = ranked[0]?.hours ?? 0;
  const color = view.program != null ? colorOf(view.program) : "var(--s1)";
  const period = view.month != null ? MONTHS_LONG[view.month] : String(view.year);

  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <div>
          <h2 className={s.cardTitle}>{title}</h2>
          <p className={s.cardSub}>
            Ranked by hours with students in {period}. Open a mentor to see every month.
          </p>
        </div>
        <div className={s.legend}>
          <span className={s.legendItem}>
            <span className={s.swatch} style={{ background: color }} />
            In plan
          </span>
          <span className={s.legendItem}>
            <span className={s.swatch} style={{ background: color, opacity: 0.4 }} />
            Extra
          </span>
        </div>
      </div>
      {ranked.length === 0 ? (
        <p className={s.cardSub}>No mentor logged a session in {period}.</p>
      ) : (
        <div className={s.board}>
          {shown.map((r, n) => (
            <MentorRow
              key={r.index}
              r={r}
              last={last}
              rank={n + 1}
              top={top}
              mentor={data.mentors[r.index]}
              color={color}
              highlight={view.month}
              delay={n * 40}
              onOpen={() => go({ mentor: r.index })}
            />
          ))}
        </div>
      )}
      {limit && ranked.length > limit && (
        <button type="button" className={s.linkBtn} onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show the top " + limit : `Show all ${ranked.length} mentors`}
        </button>
      )}
    </section>
  );
}

function MentorRow({
  r,
  last,
  rank,
  top,
  mentor,
  color,
  highlight,
  delay,
  onOpen,
}: {
  r: Ranked;
  last: number;
  rank: number;
  top: number;
  mentor: AnalyticsMentor;
  color: string;
  highlight: number | null;
  delay: number;
  onOpen: () => void;
}) {
  const grown = useGrown();
  const scale = top ? 100 / top : 0;
  return (
    <button type="button" className={s.row} onClick={onOpen} style={{ ["--delay" as string]: `${delay}ms` }}>
      <span className={s.rank}>
        {rank <= 3 ? <span className={`${s.medal} ${[s.medal1, s.medal2, s.medal3][rank - 1]}`}>{rank}</span> : rank}
      </span>
      <Avatar mentor={mentor} color={color} />
      <span className={s.who}>
        <span className={s.whoName}>{mentor.name}</span>
        <span className={s.bar} aria-hidden>
          <span className={s.barSeg} style={{ width: grown ? `${r.completed * scale}%` : 0, background: color }} />
          {r.extra > 0 && (
            <span className={s.barSeg} style={{ width: grown ? `${r.extra * scale}%` : 0, background: color, opacity: 0.4 }} />
          )}
        </span>
        <span className={s.whoMeta}>
          {r.sessions} {r.sessions === 1 ? "session" : "sessions"} · {r.students} {r.students === 1 ? "student" : "students"}
          {r.sessions ? ` · ${shortHours(r.hours / r.sessions)} avg` : ""}
        </span>
      </span>
      <span className={s.figure}>
        <span className={s.sparkHide}>
          <Sparkline values={r.trend.slice(0, last + 1)} color={color} width={84} height={28} highlight={highlight} />
        </span>
        <span className={s.figureValue}>{shortHours(r.hours)}</span>
      </span>
      <Chevron dir="right" className={s.chev} />
    </button>
  );
}

/* ----------------------------------------------------------------- mentor */

function MentorDetail({
  view,
  today,
  go,
  yearRows,
}: {
  view: View;
  today: Today;
  go: (next: Partial<View>) => void;
  yearRows: AnalyticsRow[];
}) {
  const { year, month, program } = view;
  const accent = program != null ? colorOf(program) : "var(--s1)";

  const months = useMemo(() => byMonth(yearRows), [yearRows]);
  const students = useMemo(() => {
    const out = Array.from({ length: 12 }, () => new Set<number>());
    for (const r of yearRows) if (r[5] !== 2) out[monthOf(r[3])].add(r[2]);
    return out.map((x) => x.size);
  }, [yearRows]);
  const maxMonth = Math.max(...months.map(hoursOf), 1);
  const lastMonth = year === today.year ? today.month : 11;

  return (
    <>
      <section className={s.card}>
        <div className={s.cardHead}>
          <div>
            <h2 className={s.cardTitle}>Every day of {year}</h2>
            <p className={s.cardSub}>Darker means more hours that day.</p>
          </div>
        </div>
        <Heatmap rows={yearRows} year={year} color={accent} selected={month} onPick={(m) => go({ month: m })} />
      </section>
      <section className={s.card}>
        <div className={s.cardHead}>
          <div>
            <h2 className={s.cardTitle}>What they logged each month</h2>
            <p className={s.cardSub}>Pick a row to open that month.</p>
          </div>
        </div>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Month</th>
                <th>Hours</th>
                <th>Sessions</th>
                <th>Students</th>
                <th>Avg</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                if (i > lastMonth) return null;
                const h = hoursOf(m);
                const prev = i > 0 ? hoursOf(months[i - 1]) : 0;
                const d = change(h, prev);
                return (
                  <tr
                    key={i}
                    className={[month === i && s.rowOn, h === 0 && s.rowEmpty].filter(Boolean).join(" ")}
                    onClick={() => go({ month: month === i ? null : i })}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        go({ month: month === i ? null : i });
                      }
                    }}
                  >
                    <td>{MONTHS_LONG[i]}</td>
                    <td>
                      <span className={s.inlineBar} style={{ width: (h / maxMonth) * 48, background: accent }} />
                      <b>{h ? formatDuration(h) : "—"}</b>
                    </td>
                    <td>{m.sessions || "—"}</td>
                    <td>{students[i] || "—"}</td>
                    <td>{m.sessions ? formatDuration(h / m.sessions) : "—"}</td>
                    <td>{i === 0 || (h === 0 && prev === 0) ? "" : <Delta value={d} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** Which of the mentor's programs to read, and where they stand in it. */
function MentorScope({ data, view, go }: { data: AnalyticsData; view: View; go: (next: Partial<View>) => void }) {
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
  return (
    <section className={s.card} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        {theirPrograms.length > 1 ? (
          <div className={s.chips} role="group" aria-label="Program">
            <button type="button" className={`${s.chip} ${program == null ? s.chipOn : ""}`} onClick={() => go({ program: null })}>
              All programs
            </button>
            {theirPrograms.map((p) => (
              <button
                key={p}
                type="button"
                className={`${s.chip} ${program === p ? s.chipOn : ""}`}
                onClick={() => go({ program: p })}
              >
                <span className={s.swatch} style={{ background: colorOf(p) }} />
                {data.programs[p].name}
              </button>
            ))}
          </div>
        ) : (
          <span className={s.cardSub} style={{ margin: 0 }}>
            Works in {data.programs[theirPrograms[0]]?.name}
          </span>
        )}
        {standing && (
          <span className={s.cardSub} style={{ margin: 0 }}>
            <b style={{ color: "var(--ink)" }}>#{standing.rank}</b> of {standing.of} mentors
            {program != null ? ` in ${data.programs[program].name}` : ""} ·{" "}
            {month != null ? MONTHS_LONG[month] : year}
          </span>
        )}
      </section>
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
  const max = Math.max(...hours.values(), 1);
  const level = (m: number) => (m <= 0 ? 0 : m / max <= 0.25 ? 1 : m / max <= 0.5 ? 2 : m / max <= 0.75 ? 3 : 4);
  const mix = [0, 28, 52, 76, 100];
  const fill = (lv: number) =>
    lv === 0 ? undefined : `color-mix(in oklab, ${color} ${mix[lv]}%, var(--grid))`;

  return (
    <>
      <div className={s.heat}>
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
                if (d == null) return <span key={`${w}-${k}`} className={`${s.heatCell} ${s.heatVoid}`} />;
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
      <div className={s.heatScale}>
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
  width,
  height,
  highlight,
  fluid = false,
}: {
  values: number[];
  color: string;
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
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {dot != null && !fluid && (
        <circle cx={x(dot)} cy={y(values[dot])} r={3.5} fill={color} stroke="var(--card)" strokeWidth={2} />
      )}
      {dot != null && fluid && highlight != null && (
        <line x1={x(dot)} x2={x(dot)} y1={pad} y2={height - pad} stroke={color} strokeWidth={1} opacity={0.5} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

function Avatar({ mentor, color, large = false }: { mentor: AnalyticsMentor; color: string; large?: boolean }) {
  const cls = `${s.avatar} ${large ? s.avatarLg : ""}`;
  if (mentor.avatar) {
    // eslint-disable-next-line @next/next/no-img-element -- a served avatar, already sized
    return <img src={mentor.avatar} alt="" className={cls} />;
  }
  const initials = mentor.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span className={cls} style={{ ["--c" as string]: color }} aria-hidden>
      {initials}
    </span>
  );
}

function Crumb({ current, onClick, children }: { current: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`${s.crumb} ${current ? s.crumbCurrent : ""}`}
      onClick={current ? undefined : onClick}
      aria-current={current ? "page" : undefined}
    >
      {children}
    </button>
  );
}

function Chevron({ dir, className }: { dir: "left" | "right"; className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}
