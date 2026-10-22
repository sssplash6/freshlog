"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { logSession } from "@/lib/actions/sessions";
import type { ActionState } from "@/lib/actions/shared";
import { AttendancePicker } from "@/components/forms/attendance-picker";
import { DictateButton } from "@/components/forms/dictate-button";
import { TimeKindPicker } from "@/components/forms/time-kind-picker";
import { AlertIcon } from "@/components/icons";
import { Select, type SelectOption } from "@/components/select";
import { DateField } from "@/components/ui/date-field";
import { DurationField } from "@/components/ui/duration-field";
import { GrowingField, Input } from "@/components/ui/field";
import { Receipt } from "@/components/ui/receipt";
import { SaveState, saveStateFrom } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { MAX_SESSION_MINUTES } from "@/lib/constants";
import type { LogGoal, LogState } from "@/lib/queries";
import { MAX_TASK_LENGTH, NEW_AGENDA_PREFIX, TASK_OTHER, TASK_PRESETS } from "@/lib/tasks";
import { programToday } from "@/lib/when";
import { RequiredMark } from "@/components/ui/required-mark";

/**
 * Label above control, and the ONE gap between them.
 *
 * It used to be a `mt-0.5` wrapper around each control, which meant every
 * control that was not wrapped — the two plain `<input>`s, Minutes and Date —
 * started two pixels above the `Select` beside it. Two pixels is invisible on
 * its own and unmissable on a row where one field sits next to another. The
 * gap belongs to the label, which every field has, rather than to a wrapper
 * somebody has to remember.
 */
const labelClass = "mb-0.5 block text-muted-fg";
const badInputClass = "border-danger-line bg-danger-soft/40";

export type LogSessionStudent = {
  profileId: string;
  /** The student's name — the only thing the picker is scanned by. */
  label: string;
  /** Balance and program: searchable metadata, shown under the name. */
  hint: string;
  /** The one line worth repeating under the closed select. */
  balance?: string;
  /** What logging for them would do to their balance — see `LogState`. */
  state: LogState;
  /** The mentor's own open agenda for this student, in the admin's order. */
  goals: LogGoal[];
  /**
   * The programs of theirs this mentor could be logging into, best first.
   *
   * Almost always one, and then the form never mentions it — it posts the id
   * and asks nothing. A student in two of the mentor's programs gets a select,
   * because the hours, the deadline and the agenda are all different on the
   * other side of that choice.
   */
  programs: {
    value: string;
    label: string;
    balance: string;
    state: LogState;
    goals: LogGoal[];
  }[];
};

/**
 * Where a student sits in the picker, by what logging for them would do. The
 * list is already ordered by it, so each heading opens its own run: people with
 * time to draw on, then people with none behind them, then the two states where
 * a meeting still counts but the balance is already spent.
 */
const GROUP_OF: Record<LogState, string> = {
  ready: "Has time",
  none: "No time allocated",
  overdrawn: "Overdrawn or expired",
  expired: "Overdrawn or expired",
};
const TONE_OF: Record<LogState, "warn" | "danger" | undefined> = {
  ready: undefined,
  none: undefined,
  overdrawn: "danger",
  expired: "warn",
};

/** What the form should open with — a URL draft, or the last failed attempt. */
export type LogSessionDraft = {
  studentProfileId?: string;
  programId?: string;
  assignmentId?: string;
  /** Typed under "Something else…" in the agenda picker. */
  agendaName?: string;
  minutes?: string;
  date?: string;
  note?: string;
  attendance?: string;
  timeKind?: string;
};

/**
 * Where a note too long for the URL lives instead.
 *
 * The whole request head — request line, cookies, browser headers — has to
 * fit inside the server's ~16KB limit, and the draft in the URL is part of
 * it. A note past the limit is not a slow page or an error a boundary can
 * catch: the socket is closed before the request is even read, so the tab's
 * address itself becomes unservable and every reload fails the same way.
 * One mentor lost two days to exactly that.
 *
 * So the URL holds the note only while the whole address stays safely under
 * the limit; a longer one is mirrored here instead and restored from it on
 * mount. 8KB leaves the other half of the head to the session cookie and
 * everything a browser sends.
 */
const DRAFT_KEY = "freshlog:log-session-draft";
const URL_SAFE = 8192;
/** Longer than any real interruption, short enough that last week's draft is gone. */
const DRAFT_TTL_MS = 48 * 60 * 60 * 1000;

/** The note the URL could not hold, or "" — unreadable storage reads as nothing saved. */
function readNoteMirror(): string {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return "";
    const saved = JSON.parse(raw) as { note?: unknown; at?: unknown };
    if (typeof saved.note !== "string" || !saved.note) return "";
    if (typeof saved.at !== "number" || Date.now() - saved.at > DRAFT_TTL_MS) {
      return "";
    }
    return saved.note;
  } catch {
    return "";
  }
}

/**
 * Log a completed session. Naming the agenda item it went toward is what lets planned
 * hours be read against delivered ones, but it is optional: a meeting that fits
 * none of the tasks still happened, and waiting on an admin to invent one would
 * mean the hours go unlogged. Tasks belong to a student, so the list is
 * re-scoped whenever the student changes, and both selects are keyed to that
 * student so a stale task can't be left selected underneath a new one.
 *
 * Two shapes. `inline` is the card this has always been. `page` is
 * `/sessions/new`: one column, a full-width submit, and a receipt in place of
 * the form on success — on a phone that is the difference between a form you
 * can fill with one thumb and one you cannot.
 */
export function LogSessionForm({
  students,
  mentors = [],
  mentorId = "",
  studentPlaceholder,
  mode = "inline",
  draft,
    /**
   * The ledger "Edit it" opens, with `?edit=<id>#session-<id>` added so the
   * row's edit panel is open on arrival — it went to the ledger only, and
   * "edit" that lands on a list reads as being sent away. A base rather than
   * a `(id) => href` function because a function cannot cross the server-to-
   * client boundary. Passing one type-checks, builds, and throws at render
   * with "Functions cannot be passed directly to Client Components".
   */
  correctBase,
  /** The same form, empty — a link, so the back button still works. */
  againHref,
  from,
  pageProgram,
  /** Whether this deployment has the keys for a spoken note. */
  canDictate = false,
}: {
  students: LogSessionStudent[];
  /**
   * Whose session this is, for an admin logging one on a mentor's behalf.
   * Empty for a mentor logging their own, and then the field is not there at
   * all — a picker of one is a question with no answer to give.
   */
  mentors?: { value: string; label: string; hint?: string }[];
  mentorId?: string;
  /** Said in place of "Select…" when there is nobody to pick yet. */
  studentPlaceholder?: string;
  mode?: "inline" | "page";
  draft?: LogSessionDraft;
    correctBase?: string;
  againHref?: string;
  /** The program the reader came through, kept on the link back to the student. */
  from?: string;
  /**
   * The program the reader is working in: the one this page is IN (opened from
   * a program's own page), or the one they came through to the student. A fact
   * about where they are rather than an answer about one student, so it is
   * what a student's program starts at — wherever that student is in it — and
   * the student's own last answer is not.
   */
  pageProgram?: string;
  canDictate?: boolean;
}) {
    // The attempt counter is what lets the two SegmentedRadio pickers survive a
  // failed submit. They hold their choice in `useState`, and React 19 resets
  // the form's DOM once the action settles — so the radio goes back to
  // unchecked while the component still believes it is on "Late", and the
  // mentor's answer is silently lost. Remounting them per attempt makes the
  // echoed value the one that wins.
  const [{ state, attempt, errors: missing }, action, pending] = useActionState(
    async (
      prev: { state: ActionState; attempt: number; errors: FieldErrors },
      formData: FormData
    ) => {
      // Checked here, before the round trip, and every field at once. The
      // browser's own check fired on one field at a time in a tooltip that
      // vanished on the next tap, while the fields the form drew itself
      // answered in red under the control — two voices on one submit, and a
      // footer promising "marked in red" over a Minutes box that was not.
      const errors = checkFields(formData);
      if (Object.keys(errors).length > 0) {
        const values: Record<string, string> = {};
        for (const [name, value] of formData.entries()) {
          if (typeof value === "string") values[name] = value;
        }
        return {
          state: { ok: false, error: "", values } as ActionState,
          attempt: prev.attempt + 1,
          errors,
        };
      }
      try {
        return {
          state: await logSession(prev.state, formData),
          attempt: prev.attempt + 1,
          errors: {},
        };
      } catch {
        // A server action that never lands — a dropped connection, a proxy
        // that ate the POST, an origin the deployment does not recognise —
        // rejects here, and React renders nothing for a rejected action. The
        // mentor pressed the button and the page sat there, which is the one
        // failure they cannot report and cannot work around.
        //
        // Echo the fields back the way a refused submit does, so a retry does
        // not start from an empty form.
        const values: Record<string, string> = {};
        for (const [name, value] of formData.entries()) {
          if (typeof value === "string") values[name] = value;
        }
        return {
          state: {
            ok: false as const,
            error:
              "That did not reach the server, so nothing was logged. Check your connection and try again.",
            values,
          } as ActionState,
          attempt: prev.attempt + 1,
          errors: {},
        };
      }
    },
    { state: null as ActionState, attempt: 0, errors: {} as FieldErrors }
  );
  const page = mode === "page";

  // What the form opens with: the last failed attempt if there was one — React
  // 19 clears an uncontrolled form when its action settles, which loses the
  // note and the date along with the one wrong field — otherwise the URL draft.
  const echoed = state && !state.ok ? state.values : undefined;
  const opening: LogSessionDraft = { ...draft, ...echoed };
  // One map of field → message, whoever wrote it: the check above, which can
  // name several, or the server, which names one. Each field reads its own.
  const serverField = state && !state.ok && state.error ? state.field : undefined;
  // What the check says NOW, once a submit has been refused. The messages used
  // to stay until the next submit, so a student was chosen and 45 typed with
  // "Choose a student." and "Enter how long it took." still printed under them
  // — the form contradicting what the fields said (October 2026 audit). The
  // answer is re-asked of the form after each change; `null` means no refused
  // check is open, and `missing` is what the last submit found.
  const [recheck, setRecheck] = useState<{ of: typeof missing; now: FieldErrors } | null>(null);
  const [edits, setEdits] = useState(0);
  const live = recheck && recheck.of === missing ? recheck.now : missing;
  const fieldErrors: FieldErrors =
    Object.keys(missing).length > 0
      ? live
      : serverField && state && !state.ok
        ? { [serverField]: state.error }
        : {};
  const errorCount = Object.keys(fieldErrors).length;

  const [studentId, setStudentId] = useState(
    opening.studentProfileId ?? (students.length === 1 ? students[0].profileId : "")
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  // The minutes are React's so a preset can write them.
  const [minutes, setMinutes] = useState(opening.minutes ?? "");
  // Whose hours the meeting is on, mirrored from the radio so the overdraw
  // confirmation below can step aside for Extra — which charges nothing.
  const [kind, setKind] = useState(opening.timeKind ?? "PLAN");
  const today = programToday();
  // The note is the one field React owns, because dictation writes into it.
  const [note, setNote] = useState(opening.note ?? "");

  const student = students.find((s) => s.profileId === studentId);
  const programs = student?.programs ?? [];
  // Reset with the student: last week's program is not an answer about this
  // one, and a stale id would be rejected by the action rather than silently
  // used — but a rejection the mentor cannot see the cause of is worse.
  // Picking a student on a page that is "In Master's Program" went to the
  // student's alphabetically first program, so a session could be logged in
  // Global Admissions from the Master's page.
  const startingProgram = (offered: readonly { value: string }[]) =>
    pageProgram && offered.some((p) => p.value === pageProgram) ? pageProgram : "";
  const [programId, setProgramId] = useState(
    opening.programId ?? startingProgram(programs)
  );
  const chosen =
    programs.find((p) => p.value === programId) ??
    (programs.length === 1 ? programs[0] : undefined);
  const goals = chosen?.goals ?? student?.goals ?? [];
  const balance = chosen?.balance ?? student?.balance;
  const logState = chosen?.state ?? student?.state;
  // What the agenda picker holds, for the box "Something else…" opens. Keyed
  // like the picker, which remounts per student and program and so starts
  // again from the draft.
  const agendaKey = `${studentId}:${chosen?.value ?? ""}`;
  const [agendaPick, setAgendaPick] = useState({
    key: agendaKey,
    value: opening.assignmentId ?? "",
  });
  const agendaValue =
    agendaPick.key === agendaKey ? agendaPick.value : (opening.assignmentId ?? "");
  const [agendaName, setAgendaName] = useState(opening.agendaName ?? "");
  // A student whose time is already spent, one way or the other.
  const warn = logState === "overdrawn" || logState === "expired";
  const minutesId = useId();

  /**
   * Keep the draft in the URL, so a phone interruption — a call, a lock
   * screen, a back tap — does not lose a half-written session.
   *
   * `history.replaceState` rather than a router push: this must not re-render
   * the page or add a history entry, and the values are only ever read back on
   * a fresh load.
   */
  function rememberDraft(override?: Record<string, string>) {
    if (!page || typeof window === "undefined") return;
    const form = formRef.current;
    if (!form) return;
    const url = new URL(window.location.href);
    let noteValue = "";
    // Every field, so a reload restores the same form a failed submit does.
    // Attendance and kind are one tap each, but "cheap to redo" is not the
    // same as "restored", and two draft mechanisms that disagree is worse
    // than either.
    for (const name of [
      "studentProfileId",
      "programId",
      "assignmentId",
      "agendaName",
      "minutes",
      "date",
      "note",
      "attendance",
      "timeKind",
    ]) {
      // `override` is for a value React has just set but the DOM has not
      // rendered yet — reading the form then would save the previous one.
      const value = override?.[name] ?? String(new FormData(form).get(name) ?? "");
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
      if (name === "note") noteValue = value;
    }
    // The note is the only field with no natural size limit — and the only
    // one that can take the URL past what the server will read. Over the
    // line it stays out of the address and the mirror below answers reloads.
    if (url.href.length > URL_SAFE) url.searchParams.delete("note");
    window.history.replaceState(null, "", url);
    try {
      window.localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ note: noteValue, at: Date.now() })
      );
    } catch {
      // Storage full or refused: the URL still holds every draft that fits.
    }
  }

  // Whatever the URL could not hold is restored once, on mount — and only
  // into a still-empty box, so a `?note=` the address did carry always wins
  // over the mirror of an older draft. Deferred a microtask rather than run
  // in the effect body, where a synchronous setState would cascade renders.
  useEffect(() => {
    if (!page) return;
    queueMicrotask(() => {
      const saved = readNoteMirror();
      if (saved) setNote((n) => (n ? n : saved));
    });
  }, [page]);

  // A submitted draft is spent: the note it carried must not come back as
  // somebody else's blank form. The URL copy dies with the receipt; the
  // mirror has to be removed by hand.
  useEffect(() => {
    if (!state?.ok) return;
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Optional — a leftover mirror expires on its own inside DRAFT_TTL_MS.
    }
  }, [state]);

  /**
   * The mentor touched something.
   *
   * Both halves matter and neither can be left to the form's own `onChange`:
   * a `Select` writes its value through React state without dispatching a DOM
   * change, so the form never hears it — which is why `rememberDraft` was
   * already being called by hand at every one of these call sites.
   */
  function touched(override?: Record<string, string>) {
    rememberDraft(override);
    setEdits((n) => n + 1);
  }

  // After a refused submit, ask the form again whenever something it checks
  // changes. Deferred a microtask, like the draft restore above: the form's
  // DOM has to have rendered the new value before it can be read.
  useEffect(() => {
    if (Object.keys(missing).length === 0) return;
    queueMicrotask(() => {
      const form = formRef.current;
      if (form) setRecheck({ of: missing, now: checkFields(new FormData(form)) });
    });
  }, [missing, studentId, minutes, programId, edits]);

  /**
   * Optional, and the only field that is about the WORK rather than about the
   * meeting. "None" is its empty answer: the old placeholder, "Optional —
   * choose one…", was also the first row of the list, so the list opened with
   * a ticked instruction.
   */
  //
  // It offered only what an admin had already put on the agenda, so a meeting
  // about anything else — or with a student whose agenda was empty — could not
  // say what it was for. Mentors asked to name it anyway: the presets and
  // "Something else…" follow the student's own items, and picking one adds it
  // to their agenda (or goes to the open item already called that).
  const listed = new Set(goals.map((g) => g.purpose.trim().toLowerCase()));
  const agendaOptions: SelectOption[] = student
    ? [
        ...goals.map((g) => ({ value: g.value, label: g.label, group: "On their agenda" })),
        ...TASK_PRESETS.filter((p) => !listed.has(p.toLowerCase())).map((p) => ({
          value: `${NEW_AGENDA_PREFIX}${p}`,
          label: p,
          group: "Add to their agenda",
        })),
        { value: TASK_OTHER, label: "Something else…", group: "Add to their agenda" },
      ]
    : [];
  const agendaField = (
    <div className="block min-w-0 text-sm">
      <span className={labelClass}>Agenda item worked on</span>
      <Select
        // Remount per student so the previous student's goal is never
        // left selected behind the new student's list.
        key={agendaKey}
        name="assignmentId"
        ariaLabel="Agenda item worked on"
        invalid={Boolean(fieldErrors.assignmentId)}
        defaultValue={opening.assignmentId}
        options={agendaOptions}
        required={false}
        placeholder={!student ? "Pick a student first" : "None"}
        onChange={(value) => {
          setAgendaPick({ key: agendaKey, value });
          touched({ assignmentId: value });
        }}
      />
      {agendaValue === TASK_OTHER && (
        <Input
          name="agendaName"
          type="text"
          aria-label="Name of the agenda item"
          autoFocus
          maxLength={MAX_TASK_LENGTH}
          placeholder="Name the work"
          value={agendaName}
          onChange={(event) => setAgendaName(event.target.value)}
          aria-invalid={Boolean(fieldErrors.assignmentId) || undefined}
          className={cn("rise-in mt-2", fieldErrors.assignmentId && badInputClass)}
        />
      )}
      <FieldError message={fieldErrors.assignmentId} />
    </div>
  );

  const minutesField = (
    <div className="block min-w-0 text-sm">
      <label htmlFor={minutesId} className={labelClass}>
        How long
        <RequiredMark />
      </label>
      {/* Hours and minutes, posted as one total in minutes. Either box may be
          left empty, so "90" in Minutes alone still means 90. */}
      <DurationField
        id={minutesId}
        name="minutes"
        value={minutes}
        onChange={(total) => {
          setMinutes(total);
          touched({ minutes: total });
        }}
        invalid={Boolean(fieldErrors.minutes)}
      />
      {/* The lengths a mentor actually logs, one tap each. Most sessions are
          one of these four, and typing them on a phone keypad every week is
          the slowest part of the form. */}
      <div role="group" aria-label="Common lengths" className="mt-1.5 flex flex-wrap gap-1.5">
        {MINUTE_PRESETS.map((m) => {
          const on = minutes === String(m);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setMinutes(String(m));
                touched({ minutes: String(m) });
              }}
              className={cn(
                "inline-flex min-h-8 items-center rounded-full px-3 text-xs font-medium tabular-nums transition-colors max-sm:min-h-11",
                on ? "bg-brand-soft text-brand" : "bg-fill text-muted-fg hover:text-ink"
              )}
            >
              {m} min
            </button>
          );
        })}
      </div>
      <FieldError message={fieldErrors.minutes} />
    </div>
  );

  // A div, not a label: `<button>` is labelable, so a <label> around the
  // picker's trigger would toggle the panel on every click of the word "Date"
  // — and twice on a click of the trigger itself. `DateField` names itself.
  const dateField = (
    <div className="block min-w-0 text-sm">
      <span className={labelClass}>
        Date
        <RequiredMark />
      </span>
      <DateField
        name="date"
        label="Date"
        required
        defaultValue={opening.date ?? today}
        // No future sessions. It is the program's today, not the browser's —
        // see `programToday`.
        max={today}
        invalid={Boolean(fieldErrors.date)}
        onChange={(date) => touched({ date })}
      />
      <FieldError message={fieldErrors.date} />
    </div>
  );

  const mentorField = mentors.length > 0 && (
    // Its own row, half its width: every answer under it is a fact about that
    // mentor, so it is asked first and on its own.
    <div className="block min-w-0 text-sm sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
      <span className={labelClass}>
        Mentor
        <RequiredMark />
      </span>
      <div>
        <Select
          name="mentorId"
          ariaLabel="Mentor"
          invalid={Boolean(fieldErrors.mentorId)}
          defaultValue={mentorId}
          placeholder="Whose session was this?"
          // Always, rather than past the six-option threshold: a school with
          // five mentors today has nine next term, and this is the one list an
          // admin arrives at knowing the name they want.
          searchable
          recentKey="log-session-mentor"
          options={mentors}
          onChange={(value) => {
            // A trip to the server, because the caseload is theirs and not
            // something this form can derive. The draft is already in the URL,
            // so everything typed survives, and so does the STUDENT — dropped
            // only if the mentor picked cannot reach them. The agenda item
            // cannot survive: tasks belong to a mentor.
            const url = new URL(window.location.href);
            url.searchParams.set("mentor", value);
            url.searchParams.delete("assignmentId");
            router.replace(`${url.pathname}${url.search}`);
          }}
        />
      </div>
      <FieldError message={fieldErrors.mentorId} />
    </div>
  );

  const studentField = (
    <div className="block min-w-0 text-sm">
      <span className={labelClass}>
        Student
        <RequiredMark />
      </span>
      <div>
        <Select
          name="studentProfileId"
          ariaLabel="Student"
          invalid={Boolean(fieldErrors.studentProfileId)}
          defaultValue={studentId}
          placeholder={studentPlaceholder ?? "Choose a student"}
          onChange={(value) => {
            setStudentId(value);
            setProgramId(
              startingProgram(students.find((s) => s.profileId === value)?.programs ?? [])
            );
            touched();
          }}
          // A mentor logs for the same few students week after week, and a
          // full caseload is far too long to scan: last picks lead, and the
          // rest is filtered by name, balance or program.
          recentKey="log-session-student"
          options={students.map((s) => ({
            value: s.profileId,
            label: s.label,
            hint: s.hint,
            group: GROUP_OF[s.state],
            tone: TONE_OF[s.state],
          }))}
        />
      </div>
      {balance && !warn && <p className="mt-1 text-xs text-muted-fg">{balance}</p>}
      <FieldError message={fieldErrors.studentProfileId} />
    </div>
  );

  /**
   * Said once a student whose time is spent is chosen, across the whole form
   * rather than under the Student field — where it pushed only the left column
   * down and left a 120px hole beside it.
   *
   * Two different situations, said as two: hours that EXPIRED were never
   * overdrawn, and telling a mentor a session "adds to the overdraw" of a
   * student who has simply run out of calendar was the wrong problem and the
   * wrong fix. It does not forbid the log — a meeting that happened is still
   * logged — it names the cost, the honest alternative, and asks once.
   */
  const warning = warn && balance && (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg bg-warn-soft px-3.5 py-2.5 text-xs text-warn-ink sm:col-span-2"
    >
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p>
          <span className="font-semibold">{balance.split(" — ")[0]}.</span>{" "}
          {logState === "expired" ? (
            <>
              Log it as <span className="font-semibold">Extra</span> and nothing is
              charged, or ask an admin to extend their time.
            </>
          ) : (
            <>
              Counting it toward their time adds to the overdraw. As{" "}
              <span className="font-semibold">Extra</span>, nothing is charged.
            </>
          )}
        </p>
        {kind !== "EXTRA" && (
          // A confirmation, not a block, asked only while the log WOULD
          // charge spent time, and keyed to the student so one person's "yes"
          // is never carried to the next. `needsAck` tells the check above
          // that the question was on screen.
          <>
            <input type="hidden" name="needsAck" value="1" />
            <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
              <input
                key={`${studentId}:${programId}`}
                type="checkbox"
                name="acknowledgeOverdraw"
                aria-invalid={Boolean(fieldErrors.acknowledgeOverdraw) || undefined}
                className="h-5 w-5 shrink-0 accent-[var(--color-brand)]"
              />
              <span>
                {logState === "expired"
                  ? "Count it toward their expired time anyway"
                  : "Log it anyway — it adds to the overdraw"}
              </span>
            </label>
            <FieldError message={fieldErrors.acknowledgeOverdraw} />
          </>
        )}
      </div>
    </div>
  );

  const programField =
    programs.length > 1 ? (
      <div className="block min-w-0 text-sm">
        <span className={labelClass}>
          Program
          <RequiredMark />
        </span>
        <Select
          key={studentId}
          name="programId"
          ariaLabel="Program"
          defaultValue={programId || programs[0].value}
          onChange={(value) => {
            setProgramId(value);
            touched();
          }}
          options={programs.map((p) => ({
            value: p.value,
            label: p.label,
            hint: p.balance,
            group: GROUP_OF[p.state],
            tone: TONE_OF[p.state],
          }))}
        />
        <FieldError message={fieldErrors.programId} />
      </div>
    ) : null;

  // A div, not a label: the dictate button sits on this row, and a button
  // inside a label steals the click into the textarea.
  const notesField = (
    <div className="flex min-w-0 flex-col text-sm sm:col-span-2">
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <span className="text-muted-fg">Notes</span>
        {canDictate && (
          <DictateButton
            studentProfileId={studentId || undefined}
            onText={(text) => {
              // Append: a second take adds to the first instead of wiping
              // it, and anything already typed survives.
              const next = note.trim() ? `${note.trim()} ${text}` : text;
              setNote(next);
              touched({ note: next });
            }}
          />
        )}
      </div>
      {/* Three lines to start and growing from there. It was stretched to
          match a column of four fields beside it — a 290px empty box, the
          tallest thing on the form, for the one answer that is optional. */}
      <GrowingField
        name="note"
        aria-label="Notes"
        placeholder="Optional — what you covered, and what's next"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="min-h-24 px-2.5 py-2"
      />
    </div>
  );

  if (page && state?.ok && state.receipt) {
    // The student goes in as the DRAFT's field, not as `?student=`: that one
    // means "opened from this student's page", and the page takes its Back
    // from it. `againHref` already carries it when that is where they came from.
    const nextSessionHref = againHref
      ? `${againHref}${againHref.includes("?") ? "&" : "?"}studentProfileId=${encodeURIComponent(state.receipt.subject?.id ?? "")}`
      : undefined;

    return (
      <Receipt
        receipt={state.receipt}
        correctHref={
          correctBase
            ? `${correctBase}?edit=${state.receipt.id}#session-${state.receipt.id}`
            : undefined
        }
        onAgainHref={nextSessionHref}
        from={from}
      />
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      // The form checks itself (`checkFields`), so every missing answer is
      // named at once, under its own field, in one voice.
      noValidate
      onChange={(event) => {
        const target = event.target as unknown as HTMLInputElement;
        if (target.name === "timeKind") setKind(target.value);
        // The duration boxes report their own total, which the DOM has not
        // rendered yet; a draft read now would save the previous one.
        if (target.dataset?.autosaveField) return;
        touched();
      }}
      // Both shapes sit on a white card. The fields are grey fills, and grey
      // fills straight on the grey page ground were outlines of nothing.
      className={cn("rounded-xl bg-surface p-4 shadow-sm", page && "sm:p-5")}
    >
      {!page && (
        <h2 className="text-base font-semibold text-ink">Log a completed session</h2>
      )}
      {/* One reading order at every width: who, how long, when, then what the
          time went toward, how it went, whose hours, and last the one long
          answer. The phone used to put an optional Notes box above the two
          required fields, and the desktop left Student alone on its row.
          min-w-0 on every cell: a grid item's automatic minimum size is its
          content, so the longest option label could widen the column past the
          screen on a phone. */}
      <div className={cn("grid gap-4 sm:grid-cols-2", !page && "mt-3")}>
        {mentorField}
        {studentField}
        {minutesField}
        {warning}
        {dateField}
        {/* Only when it is a real question. One program is posted, not
            asked: a select with a single option is a control that cannot be
            wrong and still costs a row of the screen to read. */}
        {programs.length === 1 && (
          <input type="hidden" name="programId" value={programs[0].value} />
        )}
        {programField}
        {agendaField}
        <AttendancePicker key={`attendance-${attempt}`} defaultValue={opening.attendance} />
        <TimeKindPicker key={`kind-${attempt}`} defaultValue={opening.timeKind} />
        {notesField}
      </div>

      {/* The whole-form line, for what no single field owns — or, when fields
          do own it, a count of them, so a mentor scrolled to the button knows
          to look up. It said "it is marked in red" over a field that was not. */}
      {errorCount > 0 ? (
        <p role="alert" className="mt-4 text-xs font-medium text-danger-ink">
          {errorCount === 1
            ? "Fix the field marked above."
            : `Fix the ${errorCount} fields marked above.`}
        </p>
      ) : (
        <SaveState state={saveStateFrom(state, pending)} />
      )}

      {/* The one primary action, at the end of the reading order. On a phone
          it stays in reach: pinned above the tab bar while the form scrolls
          under it, so a mentor does not hunt for it 1,700px down. */}
      <div
        className={cn(
          "mt-4 flex sm:justify-end",
          page &&
            "max-sm:sticky max-sm:bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] max-sm:z-10 max-sm:-mx-4 max-sm:-mb-4 max-sm:bg-surface/95 max-sm:px-4 max-sm:py-3 max-sm:backdrop-blur"
        )}
      >
        {/* A button greyed out with no reason read as broken. With nobody to
            choose from yet it says what is missing — the same words the empty
            Student field carries. */}
        {students.length === 0 && studentPlaceholder && (
          <p className="mr-3 hidden self-center text-xs text-muted-fg sm:block">
            {studentPlaceholder.replace(/…$/, ".")}
          </p>
        )}
        <SubmitButton
          pendingText="Logging…"
          className="w-full sm:w-auto sm:min-w-40"
          disabled={students.length === 0}
        >
          Log session
        </SubmitButton>
      </div>
    </form>
  );
}

/** One field's error, under the field that caused it. */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-xs font-medium text-danger-ink">
      {message}
    </p>
  );
}

type FieldErrors = Partial<Record<string, string>>;

/** The lengths offered as one-tap answers under How long. */
const MINUTE_PRESETS = [30, 45, 60, 90] as const;


/**
 * Every required answer, checked at once, in the words a field shows under
 * itself. The server checks all of it again; this only saves the round trip
 * and names everything missing instead of the first thing.
 */
function checkFields(data: FormData): FieldErrors {
  const errors: FieldErrors = {};
  const text = (name: string) => String(data.get(name) ?? "").trim();
  if (data.has("mentorId") && !text("mentorId")) {
    errors.mentorId = "Choose whose session this was.";
  }
  if (!text("studentProfileId")) errors.studentProfileId = "Choose a student.";
  const minutes = text("minutes");
  if (!minutes) errors.minutes = "Enter how long it took.";
  else if (!/^\d+$/.test(minutes) || Number(minutes) < 1) {
    errors.minutes = "Enter how long it took, 1 minute or more.";
  } else if (Number(minutes) > MAX_SESSION_MINUTES) {
    errors.minutes = `A session is at most ${MAX_SESSION_MINUTES} minutes (24 hours).`;
  }
  if (!text("date")) errors.date = "Choose the date it happened.";
  if (text("assignmentId") === TASK_OTHER && !text("agendaName")) {
    errors.assignmentId = "Name the agenda item, or pick None.";
  }
  if (text("needsAck") && !data.get("acknowledgeOverdraw")) {
    errors.acknowledgeOverdraw = "Tick this to log it, or choose Extra below.";
  }
  return errors;
}
