"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { logSession } from "@/lib/actions/sessions";
import type { ActionState } from "@/lib/actions/shared";
import { AttendancePicker } from "@/components/forms/attendance-picker";
import { DictateButton } from "@/components/forms/dictate-button";
import { TimeKindPicker } from "@/components/forms/time-kind-picker";
import { AlertIcon, PlusIcon } from "@/components/icons";
import { Select } from "@/components/select";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { GrowingField, Input, MEASURE } from "@/components/ui/field";
import { Receipt } from "@/components/ui/receipt";
import { SaveState, saveStateFrom } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { MAX_SESSION_MINUTES } from "@/lib/constants";
import type { LogState } from "@/lib/queries";
import { programToday } from "@/lib/when";
import { RequiredMark } from "@/components/ui/required-mark";

/**
 * Label above control, and the ONE gap between them — `Field`'s look, so this
 * form's labels read like every other form's. The gap belongs to the label,
 * which every field has, rather than to a wrapper somebody has to remember.
 */
const labelClass = "mb-1.5 block text-sm font-medium text-ink";
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
  goals: { value: string; label: string }[];
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
    goals: { value: string; label: string }[];
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
/** Every field the draft keeps, in the URL and in a failed submit's echo. */
const DRAFT_FIELDS = [
  "studentProfileId",
  "programId",
  "assignmentId",
  "minutes",
  "date",
  "note",
  "attendance",
  "timeKind",
] as const;
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
type LogSessionFormProps = {
  students: LogSessionStudent[];
  /**
   * Whose session this is, for an admin logging one on a mentor's behalf.
   * Empty for a mentor logging their own, and then the field is not there at
   * all — a picker of one is a question with no answer to give.
   */
  mentors?: { value: string; label: string; hint?: string }[];
  mentorId?: string;
  /** Said in place of "Choose…" when there is nobody to pick yet. */
  studentPlaceholder?: string;
  mode?: "inline" | "page";
  draft?: LogSessionDraft;
  /**
   * The ledger "Edit it" opens, with `?edit=<id>#session-<id>` added so the
   * row's edit panel is open on arrival — it went to the ledger only, and
   * "edit" that lands on a list reads as being sent away. A base rather than
   * a `(id) => href` function because a function cannot cross the server-to-
   * client boundary. Passing one type-checks, builds, and throws at render
   * with "Functions cannot be passed directly to Client Components".
   */
  correctBase?: string;
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
  /** Whether this deployment has the keys for a spoken note. */
  canDictate?: boolean;
};

/**
 * "Log another" starts a fresh round in place, with the same student. It was a
 * full page reload, which cost a mentor logging a week of sessions a second
 * per session and an admin the mentor they had picked.
 */
export function LogSessionForm(props: LogSessionFormProps) {
  const [round, setRound] = useState<{ n: number; draft?: LogSessionDraft }>({ n: 0 });
  return (
    <LogSessionRound
      key={round.n}
      {...props}
      draft={round.n === 0 ? props.draft : round.draft}
      onAgain={(draft) => setRound((r) => ({ n: r.n + 1, draft }))}
    />
  );
}

function LogSessionRound({
  students,
  mentors = [],
  mentorId = "",
  studentPlaceholder,
  mode = "inline",
  draft,
  correctBase,
  from,
  pageProgram,
  canDictate = false,
  onAgain,
}: LogSessionFormProps & { onAgain: (draft: LogSessionDraft) => void }) {
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
            error: "Not logged. Check your connection.",
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
  // Whose hours the session is on, mirrored from the radio so the overdraw
  // warning below can step aside for Extra — which charges nothing — and so
  // its "Log as Extra" can set the radio. `kindKey` remounts the picker for
  // that, since it holds its own choice.
  const [kind, setKind] = useState(opening.timeKind ?? "PLAN");
  const [kindKey, setKindKey] = useState(0);
  // The agenda item waits behind "Add agenda item" unless the draft already
  // names one — a preselected item is never hidden.
  const [agendaOpen, setAgendaOpen] = useState(Boolean(opening.assignmentId));
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
    for (const name of DRAFT_FIELDS) {
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
   * meeting — which is why it sits over the note. Most sessions name none, so
   * it waits behind "Add agenda item", and only once there is something to
   * pick. "None" is its empty answer.
   */
  const agendaField =
    goals.length === 0 ? null : agendaOpen ? (
      <div className="min-w-0">
        <span className={labelClass}>Agenda item</span>
        <Select
          // Remount per student so the previous student's goal is never
          // left selected behind the new student's list.
          key={`${studentId}:${chosen?.value ?? ""}`}
          name="assignmentId"
          ariaLabel="Agenda item"
          defaultValue={opening.assignmentId}
          options={goals}
          required={false}
          placeholder="None"
        />
        <FieldError message={fieldErrors.assignmentId} />
      </div>
    ) : (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-3 max-sm:h-11"
        onClick={() => setAgendaOpen(true)}
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Add agenda item
      </Button>
    );

  // Minutes and Date share a row: two short answers never stack.
  const minutesField = (
    <div className={cn("w-full min-w-0", MEASURE.xs)}>
      <label htmlFor={minutesId} className={labelClass}>
        Minutes
        <RequiredMark />
      </label>
      <div className="relative">
        {/* Text with a numeric keypad, not `type="number"`: the number input
            drew spinner arrows on focus and took a scroll-wheel nudge as an
            edit. The unit sits in the box, so "90" can only mean minutes. */}
        <Input
          id={minutesId}
          name="minutes"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          measure="xs"
          // No placeholder. A grey "90" in the box read as a value already
          // given, and the mentor submitted a form that was then refused.
          value={minutes}
          onChange={(event) => setMinutes(event.target.value.replace(/\D/g, ""))}
          // A pasted "1.5" used to lose its point and become 15 minutes — ten
          // times what was meant. Anything that is not whole minutes is refused
          // at the paste instead of being quietly reshaped into a different
          // number.
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text").trim();
            if (!/^\d+$/.test(pasted)) event.preventDefault();
          }}
          aria-invalid={Boolean(fieldErrors.minutes) || undefined}
          className={cn("pr-12", fieldErrors.minutes && badInputClass)}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-muted-fg"
        >
          min
        </span>
      </div>
    </div>
  );

  // The lengths a mentor actually logs, one tap each, beside the box. Most
  // sessions are one of these four, and typing them on a phone keypad every
  // week is the slowest part of the form.
  const minutePresets = (
    <div role="group" aria-label="Common lengths" className="flex h-11 items-center gap-1.5">
      {MINUTE_PRESETS.map((m) => {
        const on = minutes === String(m);
        return (
          <button
            key={m}
            type="button"
            aria-pressed={on}
            aria-label={`${m} min`}
            onClick={() => {
              setMinutes(String(m));
              touched({ minutes: String(m) });
            }}
            className={cn(
              "inline-flex min-h-8 min-w-10 items-center justify-center rounded-full px-2.5 text-xs font-medium tabular-nums transition-colors max-sm:min-h-11",
              on ? "bg-brand-soft text-brand" : "bg-fill text-muted-fg hover:text-ink"
            )}
          >
            {m}
          </button>
        );
      })}
    </div>
  );

  // A div, not a label: `<button>` is labelable, so a <label> around the
  // picker's trigger would toggle the panel on every click of the word "Date"
  // — and twice on a click of the trigger itself. `DateField` names itself.
  const dateField = (
    <div className={cn("w-full min-w-0", MEASURE.sm)}>
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
    </div>
  );

  // Asked first: every answer under it is a fact about that mentor.
  const mentorField = mentors.length > 0 && (
    <div className="min-w-0">
      <span className={labelClass}>
        Mentor
        <RequiredMark />
      </span>
      <Select
        name="mentorId"
        ariaLabel="Mentor"
        measure="full"
        invalid={Boolean(fieldErrors.mentorId)}
        defaultValue={mentorId}
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
      <FieldError message={fieldErrors.mentorId} />
    </div>
  );

  // The balance is the picker's own hint on each option, so it is not
  // printed again under the closed select.
  const studentField = (
    <div className="min-w-0">
      <span className={labelClass}>
        Student
        <RequiredMark />
      </span>
      <Select
        name="studentProfileId"
        ariaLabel="Student"
        // Half the row beside the mentor picker; its own measure when alone.
        measure={mentorField ? "full" : "md"}
        invalid={Boolean(fieldErrors.studentProfileId)}
        defaultValue={studentId}
        placeholder={studentPlaceholder}
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
      <FieldError message={fieldErrors.studentProfileId} />
    </div>
  );

  /**
   * Said once a student whose time is spent is chosen, while the log would
   * charge that time: one line naming the state, and the one alternative —
   * Extra, which charges nothing. It does not forbid the log; a meeting that
   * happened is still logged, and pressing Log a session is the "yes".
   */
  const warning = warn && balance && kind !== "EXTRA" && (
    <p
      role="status"
      className="flex flex-wrap items-center gap-x-2.5 rounded-lg bg-warn-soft px-3.5 py-1 text-xs text-warn-ink"
    >
      <AlertIcon className="h-4 w-4 shrink-0" />
      <span className="font-semibold">{balance.split(" — ")[0]}.</span>
      <button
        type="button"
        onClick={() => {
          setKind("EXTRA");
          setKindKey((k) => k + 1);
          touched({ timeKind: "EXTRA" });
        }}
        className="min-h-11 font-semibold text-brand hover:underline sm:min-h-8"
      >
        Log as Extra
      </button>
    </p>
  );

  const programField =
    programs.length > 1 ? (
      <div className="min-w-0">
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
  // inside a label steals the click into the textarea. One line to start,
  // growing as it is typed into.
  const notesField = (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">Notes</span>
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
      <GrowingField
        name="note"
        aria-label="Notes"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
    </div>
  );

  if (page && state?.ok && state.receipt) {
    const subject = state.receipt.subject?.id;
    return (
      <Receipt
        receipt={state.receipt}
        correctHref={
          correctBase
            ? `${correctBase}?edit=${state.receipt.id}#session-${state.receipt.id}`
            : undefined
        }
        onAgain={() => {
          // The spent draft leaves the URL, so a reload is the fresh form and
          // not this session again. Where the form came from — `?student=`,
          // `?back=`, `?program=`, an admin's `?mentor=` — stays. The student
          // goes in as the DRAFT's field, not as `?student=`: that one means
          // "opened from this student's page", and the page takes its Back
          // from it.
          const url = new URL(window.location.href);
          for (const name of DRAFT_FIELDS) url.searchParams.delete(name);
          if (subject) url.searchParams.set("studentProfileId", subject);
          window.history.replaceState(null, "", url);
          onAgain({ studentProfileId: subject, programId: chosen?.value });
        }}
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
        touched();
      }}
      // Both shapes sit on a white card. The fields are grey fills, and grey
      // fills straight on the grey page ground were outlines of nothing.
      className={cn("rounded-xl bg-surface p-4 shadow-sm", page && "sm:p-5")}
    >
      {!page && (
        <h2 className="text-base font-semibold text-ink">Log a session</h2>
      )}
      {/* One column, one reading order at every width: who, how long and
          when, how it went and whose hours, then what the time went toward
          and the note. min-w-0 on every cell: the longest option label could
          otherwise widen the form past the screen on a phone. */}
      <div className={cn("space-y-4", !page && "mt-3")}>
        {/* Who, on one row (DESIGN.md W2): each picker takes half the form. */}
        <div className={cn("grid gap-3", mentorField && "sm:grid-cols-2")}>
          {mentorField}
          {studentField}
        </div>
        {/* Only when it is a real question. One program is posted, not
            asked: a select with a single option is a control that cannot be
            wrong and still costs a row of the screen to read. */}
        {programs.length === 1 && (
          <input type="hidden" name="programId" value={programs[0].value} />
        )}
        {programField}
        {warning}
        <div>
          <div className="flex flex-wrap items-end gap-3">
            {minutesField}
            {minutePresets}
            {dateField}
          </div>
          <FieldError message={fieldErrors.minutes} />
          <FieldError message={fieldErrors.date} />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          <AttendancePicker key={`attendance-${attempt}`} defaultValue={opening.attendance} />
          <TimeKindPicker key={`kind-${attempt}-${kindKey}`} defaultValue={kind} />
        </div>
        {agendaField}
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
        <SubmitButton
          pendingText="Logging…"
          className="w-full sm:w-auto sm:min-w-40"
          disabled={students.length === 0}
        >
          Log a session
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

/** The lengths offered as one-tap answers beside Minutes. */
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
    errors.mentorId = "Choose a mentor.";
  }
  if (!text("studentProfileId")) errors.studentProfileId = "Choose a student.";
  const minutes = text("minutes");
  if (!minutes) errors.minutes = "Enter the minutes.";
  else if (!/^\d+$/.test(minutes) || Number(minutes) < 1) {
    errors.minutes = "Whole minutes, 1 or more.";
  } else if (Number(minutes) > MAX_SESSION_MINUTES) {
    errors.minutes = `At most ${MAX_SESSION_MINUTES} minutes.`;
  }
  if (!text("date")) errors.date = "Choose a date.";
  return errors;
}
