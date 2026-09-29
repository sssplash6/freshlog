"use client";

import { useState } from "react";

import { CrownIcon } from "@/components/icons";
import { Select } from "@/components/select";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { MAX_TASK_LENGTH, TASK_BANK, TASK_OTHER, TASK_PRESETS } from "@/lib/tasks";

/** An open agenda item this pairing already has, offered so it can be topped up. */
export type OpenTask = { purpose: string; hint?: string };

/**
 * Names the piece of work hours are for — a line of the student's AGENDA, not
 * one of the tasks a mentor sets them (`lib/student-tasks.ts` says which is
 * which). One of the presets, one of the items this mentor already has open
 * with the student (which tops its budget up instead of creating a
 * near-duplicate), or anything typed into the box that "Something else…"
 * reveals.
 *
 * Two fields ride out to the action — the picked value and the typed one — and
 * lib/tasks.ts#parseTaskField resolves them the same way on every form.
 */
export function TaskPicker({
  openTasks = [],
  name = "task",
  customName = "taskCustom",
  compact = false,
  optional = false,
  className,
  hint,
  bankOption = false,
  onPick,
}: {
  /** Lead with the student's hour bank. Admins of a bank program only. */
  bankOption?: boolean;
  /** Told what was picked, for a form that changes shape around it. */
  onPick?: (value: string) => void;
  openTasks?: OpenTask[];
  /** Field names, for actions that call this field something else (`purpose`). */
  name?: string;
  customName?: string;
  /** Tighter labels, for the narrow row-action popovers. */
  compact?: boolean;
  /** Time may be granted before the work has a name; this drops the asterisk
   *  and lets the picker be cleared back to nothing. */
  optional?: boolean;
  className?: string;
  hint?: React.ReactNode;
}) {
  const [picked, setPicked] = useState("");

  // Open tasks lead: when one exists, granting more hours for it is the likely
  // intent, and the alternative (a second row with the same name) is one an
  // admin would have to clean up later.
  const openPurposes = new Set(openTasks.map((t) => t.purpose));
  const options = [
    // Pinned first: it is not a piece of work but the balance all of it is
    // drawn from, and the crown is how the rest of the app marks it.
    ...(bankOption
      ? [
          {
            value: TASK_BANK,
            label: "Hour bank",
            icon: <CrownIcon className="h-4 w-4 shrink-0 text-accent-ink" />,
          },
        ]
      : []),
    ...openTasks.map((t) => ({
      value: t.purpose,
      label: t.hint ? `${t.purpose} · ${t.hint}` : t.purpose,
    })),
    ...TASK_PRESETS.filter((p) => !openPurposes.has(p)).map((p) => ({
      value: p,
      label: p,
    })),
    { value: TASK_OTHER, label: "Something else…" },
  ];

  return (
    <div className={cn("min-w-0", className)}>
      <span
        className={cn(
          "block",
          compact
            ? "text-xs font-medium text-muted-fg"
            : "text-xs font-medium text-muted-fg",
        )}
      >
        Agenda{!optional && <span className="text-accent-ink"> *</span>}
      </span>
      <div className="mt-1">
        <Select
          name={name}
          ariaLabel="Agenda item this time is for"
          options={options}
          placeholder={
            optional ? "Nothing named yet — decide later" : "What is this time for?"
          }
          required={!optional}
          onChange={(value) => {
            setPicked(value);
            onPick?.(value);
          }}
        />
      </div>
      {picked === TASK_OTHER && (
        <Input
          name={customName}
          type="text"
          required
          autoFocus
          maxLength={MAX_TASK_LENGTH}
          placeholder="Name the work"
          className="rise-in mt-2"
        />
      )}
      {hint && (
        <p className="mt-1.5 text-xs font-normal normal-case tracking-normal text-muted-fg">
          {hint}
        </p>
      )}
    </div>
  );
}
