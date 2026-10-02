"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { logSession } from "@/lib/actions/sessions";
import type { ActionState } from "@/lib/actions/shared";
import { AttendancePicker } from "@/components/forms/attendance-picker";
import { DictateButton } from "@/components/forms/dictate-button";
import { TimeKindPicker } from "@/components/forms/time-kind-picker";
import { Select } from "@/components/select";
import { DateField } from "@/components/ui/date-field";
import { GrowingField, inputClasses } from "@/components/ui/field";
import { Receipt } from "@/components/ui/receipt";
import { SaveState, saveStateFrom } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { programToday } from "@/lib/when";

/**
 * `min-h-11` for the same reason `Select` has it: 44px, and the two are
 * side by side. The select declares that height and an input derived its own
 * from padding and an inherited line-height, so the pair agreed only by
 * arithmetic that nobody was checking.
 */
const inputClass = inputClasses;
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
    goals: { value: string; label: string }[];
  }[];
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
   * Where "Correct it" goes, minus the session id — this is a base rather than
   * a `(id) => href` function because a function cannot cross the server-to-
   * client boundary. Passing one type-checks, builds, and throws at render
   * with "Functions cannot be passed directly to Client Components".
   */
  correctBase,
  /** The same form, empty — a link, so the back button still works. */
  againHref,
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
  canDictate?: boolean;
}) {
    // The attempt counter is what lets the two SegmentedRadio pickers survive a
  // failed submit. They hold their choice in `useState`, and React 19 resets
  // the form's DOM once the action settles — so the radio goes back to
  // unchecked while the component still believes it is on "Late", and the
  // mentor's answer is silently lost. Remounting them per attempt makes the
  // echoed value the one that wins.
  const [{ state, attempt }, action, pending] = useActionState(
    async (prev: { state: ActionState; attempt: number }, formData: FormData) => {
      try {
        return {
          state: await logSession(prev.state, formData),
          attempt: prev.attempt + 1,
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
          },
          attempt: prev.attempt + 1,
        };
      }
    },
    { state: null as ActionState, attempt: 0 }
  );
  const page = mode === "page";

  // What the form opens with: the last failed attempt if there was one — React
  // 19 clears an uncontrolled form when its action settles, which loses the
  // note and the date along with the one wrong field — otherwise the URL draft.
  const echoed = state && !state.ok ? state.values : undefined;
  const opening: LogSessionDraft = { ...draft, ...echoed };
  const badField = state && !state.ok ? state.field : undefined;

  const [studentId, setStudentId] = useState(
    opening.studentProfileId ?? (students.length === 1 ? students[0].profileId : "")
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  /**
   * Why the browser refused to submit.
   *
   * When a required field is empty the form action never runs and the native
   * bubble is a tooltip pinned to a control that may be off-screen on a phone
   * — so the mentor sees the button do nothing. `invalid` does not bubble, but
   * the capture phase still passes through every ancestor, so one handler here
   * catches every control. Each control keeps naming itself; this only says
   * that something did.
   */
  const [blocked, setBlocked] = useState(false);
  const today = programToday();
  // The note is the one field React owns, because dictation writes into it.
  const [note, setNote] = useState(opening.note ?? "");

  const student = students.find((s) => s.profileId === studentId);
  const programs = student?.programs ?? [];
  // Reset with the student: last week's program is not an answer about this
  // one, and a stale id would be rejected by the action rather than silently
  // used — but a rejection the mentor cannot see the cause of is worse.
  const [programId, setProgramId] = useState(opening.programId ?? "");
  const chosen =
    programs.find((p) => p.value === programId) ??
    (programs.length === 1 ? programs[0] : undefined);
  const goals = chosen?.goals ?? student?.goals ?? [];
  const balance = chosen?.balance ?? student?.balance;
  const noGoals = Boolean(student) && Boolean(chosen) && goals.length === 0;

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
    setBlocked(false);
    rememberDraft(override);
  }

  /**
   * The two fields that sit in different places in the two shapes.
   *
   * Written once and placed twice rather than written twice: they carry the
   * dictation wiring and the error plumbing, and the version of this that
   * duplicated the JSX is how the page shape ended up with a Notes box the
   * inline one did not have.
   */
  /**
   * Optional, and the only field of the three that is about the WORK rather
   * than about the meeting — which is why the page shape puts it over the
   * note and not with the student. It was in the grid at the top, where a
   * third field above it left it alone on a row with half the screen empty
   * beside it.
   */
  const agendaField = (
    <div className="block min-w-0 text-sm">
      <span className={labelClass}>Agenda item worked on</span>
      <Select
        // Remount per student so the previous student's goal is never
        // left selected behind the new student's list.
        key={`${studentId}:${chosen?.value ?? ""}`}
        name="assignmentId"
        ariaLabel="Agenda item worked on"
        defaultValue={opening.assignmentId}
        options={goals}
        required={false}
        placeholder={
          !student
            ? "Pick a student first…"
            : noGoals
              ? "Nothing planned yet"
              : "Optional — choose one…"
        }
      />
      <FieldError show={badField === "assignmentId"} state={state} />
    </div>
  );

  const minutesField = (
    <label className="block min-w-0 text-sm">
      <span className={labelClass}>Minutes *</span>
      <input
        name="minutes"
        type="number"
        min="1"
        step="1"
        required
        inputMode="numeric"
        placeholder="90"
        defaultValue={opening.minutes}
        aria-invalid={badField === "minutes" || undefined}
        className={cn(inputClass, badField === "minutes" && badInputClass)}
      />
      <FieldError show={badField === "minutes"} state={state} />
    </label>
  );

  // A div, not a label: `<button>` is labelable, so a <label> around the
  // picker's trigger would toggle the panel on every click of the word "Date"
  // — and twice on a click of the trigger itself. `DateField` names itself.
  const dateField = (
    <div className="block min-w-0 text-sm">
      <span className={labelClass}>Date *</span>
      <DateField
        name="date"
        label="Date"
        required
        defaultValue={opening.date ?? today}
        // No future sessions. It is the program's today, not the browser's —
        // see `programToday`.
        max={today}
        invalid={badField === "date"}
        onChange={(date) => touched({ date })}
      />
      <FieldError show={badField === "date"} state={state} />
    </div>
  );

  /**
   * The label row and the box are separate pieces because the page shape sets
   * the column of one-tap fields against the BOX — its first label on the
   * box's top border, its last pill on the bottom one — and a single block
   * would have started that column at the word "Notes" instead, a row above.
   */
  // A div, not a label: the dictate button sits on this row, and a button
  // inside a label steals the click into the textarea.
  const notesLabel = (
    <div className="mb-0.5 flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-fg">Notes</span>
      {canDictate && (
        <DictateButton
          studentProfileId={studentId || undefined}
          onText={(text) => {
            // Append: a second take adds to the first instead of
            // wiping it, and anything already typed survives.
            const next = note.trim() ? `${note.trim()} ${text}` : text;
            setNote(next);
            touched({ note: next });
          }}
        />
      )}
    </div>
  );

  const notesBox = (
    // Never shorter than the four fields beside it: the box is a grid item
    // that stretches to its row, and the row is as tall as that column. An
    // empty box the depth of one line, next to a column four times its
    // height, reads as the afterthought it is not. It grows past them from
    // there, as anything typed into it must.
    <GrowingField
      name="note"
      aria-label="Notes"
      placeholder="Optional — what you covered, and what's next"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className={cn(page && "lg:min-h-48", "px-2.5 py-2")}
      />
  );

  const notesField = (
    <div className="flex min-w-0 flex-col text-sm sm:col-span-2 lg:col-span-3">
      {notesLabel}
      {notesBox}
    </div>
  );

  if (page && state?.ok && state.receipt) {
    const nextSessionHref = againHref
      ? `${againHref}${againHref.includes("?") ? "&" : "?"}student=${encodeURIComponent(state.receipt.subject?.id ?? "")}`
      : undefined;

    return (
      <Receipt
        receipt={state.receipt}
                correctHref={correctBase ? `${correctBase}${state.receipt.id}` : undefined}
        onAgainHref={nextSessionHref}
      />
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      onChange={() => touched()}
      onInvalidCapture={() => setBlocked(true)}
      // Both shapes sit on a white card. The fields are grey fills, and grey
      // fills straight on the grey page ground were outlines of nothing —
      // the form only read as a form once it had a surface to be on.
      className={cn("rounded-xl bg-surface p-4 shadow-sm", page && "sm:p-5")}
    >
      {!page && (
        <h2 className="text-base font-semibold text-ink">Log a completed session</h2>
      )}
      {/* min-w-0 on every cell: a grid item's automatic minimum size is its
          content, so the longest option label was widening the column past the
          screen on a phone — and the dropdown, anchored to it, went with it. */}
      <div
        className={cn(
          "grid gap-3",
          page ? "gap-4 sm:grid-cols-2" : "mt-3 sm:grid-cols-2 lg:grid-cols-3"
        )}
      >
        {/* Whose session it is, asked first because every answer under it is
            a fact about that mentor: their students, their balances, their
            agenda. Absent for a mentor logging their own. */}
        {mentors.length > 0 && (
          <div className="block min-w-0 text-sm">
            <span className={labelClass}>Mentor *</span>
            <Select
              name="mentorId"
              ariaLabel="Mentor"
              defaultValue={mentorId}
              placeholder="Whose session was this?"
              // Always, rather than past the six-option threshold: a school
              // with five mentors today has nine next term, and this is the
              // one list an admin arrives at knowing the name they want.
              searchable
              recentKey="log-session-mentor"
              options={mentors}
              onChange={(value) => {
                // A trip to the server, because the caseload is theirs and
                // not something this form can derive. The draft is already in
                // the URL — `rememberDraft` put it there — so everything
                // typed survives, and so does the STUDENT: an admin who came
                // from Khabiba's file is still on Khabiba's file after they
                // say which mentor met her, and being made to find her again
                // is the whole reason that link carries her id. The page
                // drops her only if the mentor they picked cannot reach her.
                //
                // The agenda item cannot survive: tasks belong to a mentor,
                // so the one on screen is the last mentor's.
                const url = new URL(window.location.href);
                url.searchParams.set("mentor", value);
                url.searchParams.delete("assignmentId");
                router.replace(`${url.pathname}${url.search}`);
              }}
            />
            <FieldError show={badField === "mentorId"} state={state} />
          </div>
        )}
        <div className="block min-w-0 text-sm">
          <span className={labelClass}>Student *</span>
          <Select
            name="studentProfileId"
            ariaLabel="Student"
            defaultValue={studentId}
            placeholder={studentPlaceholder}
            onChange={(value) => {
              setStudentId(value);
              setProgramId("");
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
            }))}
          />
          {balance && <p className="mt-1 text-xs text-muted-fg">{balance}</p>}
          <FieldError show={badField === "studentProfileId"} state={state} />
        </div>
        {/* Only when it is a real question. One program is posted, not asked:
            a select with a single option is a control that cannot be wrong and
            still costs a row of the screen to read. */}
        {programs.length === 1 && (
          <input type="hidden" name="programId" value={programs[0].value} />
        )}
        {programs.length > 1 && (
          <div className="block min-w-0 text-sm">
            <span className={labelClass}>Program *</span>
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
              }))}
            />
            <FieldError show={badField === "programId"} state={state} />
          </div>
        )}
        {!page && agendaField}
        {!page && minutesField}
        {!page && dateField}
        {!page && notesField}
      </div>

      {/* Who and what, then everything about the meeting itself.

          The note is the only long answer of the five, so it takes a column
          and the four one-tap ones stack beside it. In a single file these ran
          past the fold on a laptop and made a 90-second form read as a
          questionnaire. One column below `lg`: side by side on a phone would
          leave the note about twenty characters a line. */}
      {page && (
        <>
          {/* Two columns of equal height, and the left one is a stack rather
              than rows of its own: the agenda item, then the note under it,
              then the box taking whatever the column has left. Neither side is
              told a height in pixels — the grid stretches both to the taller,
              which is the column of one-tap fields, and the note gives up
              exactly the height the agenda item takes. */}
          <div className="mt-4 grid gap-x-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col">
              {agendaField}
              <div className="mt-3">{notesLabel}</div>
              {/* A grid, not a block: it is what makes the box fill what is
                  left of the column rather than stop at its own content. */}
              <div className="grid min-w-0 flex-1">{notesBox}</div>
            </div>
            <div className="mt-4 flex flex-col gap-3 lg:mt-0">
              {minutesField}
              {dateField}
              <AttendancePicker
                key={`attendance-${attempt}`}
                defaultValue={opening.attendance}
              />
              <TimeKindPicker key={`kind-${attempt}`} defaultValue={opening.timeKind} />
            </div>
          </div>
          {/* The one primary action, at the end of the reading order: full
              width under a thumb, its own width against the right edge on a
              desktop, where a bar the width of the form was the loudest thing
              on the page. */}
          <div className="mt-5 flex sm:justify-end">
            <SubmitButton pendingText="Logging…" className="w-full sm:w-auto sm:min-w-40">
              Log session
            </SubmitButton>
          </div>
        </>
      )}

      {!page && (
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <AttendancePicker
              key={`attendance-${attempt}`}
              defaultValue={opening.attendance}
            />
            <TimeKindPicker key={`kind-${attempt}`} defaultValue={opening.timeKind} />
          </div>
          <SubmitButton pendingText="Logging…" className="min-w-40">
            Log session
          </SubmitButton>
        </div>
      )}

            {/* The whole-form error, for the failures no single field owns: not
          assigned to the program, hours expired, already logged. Suppressed
          when a field owns it, or the same sentence appears twice. */}
      {blocked && (
        <p role="alert" className="mt-3 text-xs font-medium text-danger-ink">
          Something above still needs filling in — it is marked in red.
        </p>
      )}
      {!badField && <SaveState state={saveStateFrom(state, pending)} />}
    </form>
  );
}

/**
 * The error, under the field that caused it.
 *
 * A form with seven inputs and one message at the bottom makes the reader
 * re-read all seven to find out which one is wrong. The server names the field
 * (`ActionState.field`) precisely so this can sit next to it.
 */
function FieldError({ show, state }: { show: boolean; state: ActionState }) {
  if (!show || !state || state.ok) return null;
  return (
    <p role="alert" className="mt-1 text-xs font-medium text-danger-ink">
      {state.error}
    </p>
  );
}
