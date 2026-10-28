"use client";

import { useMemo, useState } from "react";

import { Avatar } from "@/components/avatar";
import { PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { DateField } from "@/components/ui/date-field";
import { Field, GrowingField, Input } from "@/components/ui/field";
import { RequiredMark } from "@/components/ui/required-mark";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  deleteMentorTask,
  setMentorTask,
  setMentorTaskDone,
} from "@/lib/actions/mentor-tasks";
import { programToday } from "@/lib/when";

/** Kept in step with `MAX_MENTOR_TASK_*` in lib/mentor-tasks.ts (server-only). */
const MAX_TITLE = 120;
const MAX_NOTE = 500;

/** The student list grows a filter once scanning it costs something. */
const STUDENT_SEARCH_THRESHOLD = 8;

type Person = {
  id: string;
  name: string | null;
  email: string;
  avatarUpdatedAt?: Date | null;
};

type StudentOption = { id: string; name: string };

/**
 * Set the program's mentors a task: what, by when, for whom, about whom.
 *
 * Closed, it is the "Set a task" row at the head of the list; open, it unfolds
 * in place, the shape `SetStudentTaskForm` has, so the two read as one family.
 *
 * Mentors are a checklist with "Everyone" at the top, because the two ways an
 * admin asks are "the whole team" and "these three", and one control answers
 * both. Students are optional and many: a task about nobody ("update your
 * booking link") is as ordinary as one about three essays.
 */
export function SetMentorTaskForm({
  programId,
  team,
  students,
  defaultOpen = false,
}: {
  programId: string;
  team: Person[];
  students: StudentOption[];
  /** Start unfolded — `?new=1` on the Mentor tasks tab. */
  defaultOpen?: boolean;
}) {
  const [state, action, save] = useSaveState(setMentorTask);
  const [open, setOpen] = useState(defaultOpen && team.length > 0);
  const [mentors, setMentors] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const today = programToday();

  // Fold away once the task is actually set, with a clean slate for the next
  // one — adjusted during render, as `SetStudentTaskForm` does.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) {
      setOpen(false);
      setMentors([]);
      setPicked([]);
      setQuery("");
    }
  }

  const everyone = team.length > 0 && mentors.length === team.length;
  const toggleMentor = (id: string) =>
    setMentors((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const toggleStudent = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const visibleStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? students.filter((s) => s.name.toLowerCase().includes(q)) : students;
  }, [students, query]);
  const nameOf = new Map(students.map((s) => [s.id, s.name]));

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={team.length === 0}
          className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left text-body font-medium text-brand transition-colors hover:bg-fill focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:cursor-default disabled:text-muted-fg disabled:hover:bg-transparent sm:px-5"
        >
          <PlusIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {team.length === 0 ? "Pair a mentor to this program to set them tasks" : "Set a task for mentors"}
        </button>
        <SaveState state={save} className="px-4 has-[span]:pb-2 sm:px-5" />
      </div>
    );
  }

  return (
    <form action={action} className="rise-in space-y-4 px-4 py-3 sm:px-5">
      <input type="hidden" name="programId" value={programId} />
      {mentors.map((id) => (
        <input key={id} type="hidden" name="mentorIds" value={id} />
      ))}
      {picked.map((id) => (
        <input key={id} type="hidden" name="studentIds" value={id} />
      ))}

      <Field label="Task" required>
        <GrowingField
          name="title"
          required
          autoFocus
          maxLength={MAX_TITLE}
          placeholder="Send each of your students' essay feedback"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* A div, not a `Field`: the date field's trigger is a button. */}
        <div className="min-w-0 space-y-1.5">
          <span className="block text-sm font-medium text-ink">
            Deadline<RequiredMark />
          </span>
          <DateField name="dueOn" label="Deadline" required min={today} />
        </div>
      </div>

      <fieldset className="min-w-0 space-y-1.5">
        <legend className="text-sm font-medium text-ink">
          Mentors<RequiredMark />
        </legend>
        <ul className="divide-y divide-line rounded-xl border border-line">
          <li>
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={everyone}
                ref={(el) => {
                  if (el) el.indeterminate = mentors.length > 0 && !everyone;
                }}
                onChange={() => setMentors(everyone ? [] : team.map((m) => m.id))}
                className="h-4 w-4 shrink-0 accent-brand"
              />
              Everyone in the team
              <span className="font-normal text-muted-fg">
                {mentors.length}/{team.length}
              </span>
            </label>
          </li>
          {team.map((m) => (
            <li key={m.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={mentors.includes(m.id)}
                  onChange={() => toggleMentor(m.id)}
                  className="h-4 w-4 shrink-0 accent-brand"
                />
                <Avatar person={m} className="h-6 w-6 shrink-0 text-caption" />
                <span className="min-w-0 truncate">{m.name ?? m.email}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {students.length > 0 && (
        <fieldset className="min-w-0 space-y-1.5">
          <legend className="text-sm font-medium text-ink">
            Students it is about <span className="font-normal text-muted-fg">(optional)</span>
          </legend>
          {picked.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Attached students">
              {picked.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => toggleStudent(id)}
                    aria-label={`Remove ${nameOf.get(id)}`}
                    className="inline-flex min-h-8 items-center gap-1 rounded-full bg-fill px-3 text-xs font-medium text-ink transition-colors hover:bg-fill-strong"
                  >
                    {nameOf.get(id)} <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {students.length > STUDENT_SEARCH_THRESHOLD && (
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a student"
              aria-label="Find a student"
            />
          )}
          <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {visibleStudents.length === 0 ? (
              <li className="px-3 py-2.5 text-sm text-muted-fg">Nobody by that name.</li>
            ) : (
              visibleStudents.map((s) => (
                <li key={s.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={picked.includes(s.id)}
                      onChange={() => toggleStudent(s.id)}
                      className="h-4 w-4 shrink-0 accent-brand"
                    />
                    <span className="min-w-0 truncate">{s.name}</span>
                  </label>
                </li>
              ))
            )}
          </ul>
        </fieldset>
      )}

      <Field label="Notes">
        <GrowingField
          name="note"
          maxLength={MAX_NOTE}
          placeholder="What good looks like, or where to start"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingText="Setting…" disabled={mentors.length === 0}>
          {everyone && team.length > 1
            ? "Set for everyone"
            : mentors.length > 1
              ? `Set for ${mentors.length} mentors`
              : "Set the task"}
        </SubmitButton>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <SaveState state={save} />
    </form>
  );
}

/** Withdraw a task from everyone it was set to — the admin's one correction. */
export function WithdrawMentorTask({ taskId }: { taskId: string }) {
  const [, action, save] = useSaveState(deleteMentorTask);
  return (
    <div>
      <ConfirmInline
        variant="quiet"
        action={action}
        values={{ taskId }}
        pending={save.kind === "saving"}
        label="Withdraw"
        question="It leaves every mentor's list."
        confirmLabel="Yes, withdraw"
        pendingLabel="Withdrawing…"
      />
      <SaveState state={save} />
    </div>
  );
}

/** A mentor's own tick on their share, and the way to take it back. */
export function MentorTaskDoneButton({
  assigneeId,
  done,
}: {
  assigneeId: string;
  done: boolean;
}) {
  const [, action, save] = useSaveState(setMentorTaskDone);
  const pending = save.kind === "saving";
  return (
    <form action={action} aria-busy={pending}>
      <input type="hidden" name="assigneeId" value={assigneeId} />
      <button
        type="submit"
        name="intent"
        value={done ? "reopen" : "done"}
        disabled={pending}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-fill px-3 text-xs font-semibold text-brand transition-colors hover:bg-fill-strong disabled:opacity-50"
      >
        {done ? (
          <>
            <span aria-hidden="true">↺</span> Mark incomplete
          </>
        ) : (
          <>
            <span aria-hidden="true">✓</span> Done
          </>
        )}
      </button>
      <SaveState state={save} />
    </form>
  );
}
