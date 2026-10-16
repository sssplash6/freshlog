"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { inputClasses } from "@/components/ui/field";
import { setBugStatus } from "@/lib/actions/bugs";
import { cn } from "@/lib/cn";
import {
  BUG_STATUSES,
  BUG_STATUS_LABELS,
  isClosingStatus,
  type BugStatus,
} from "@/lib/bugs";

/**
 * Move a card along the board without opening it.
 *
 * New, In progress and In review save on the spot. Done and Won't do need
 * words — a fix line everybody reads, or a note to the reporter — so choosing
 * either opens the report with that status already picked, rather than
 * pretending a one-click "Done" can write the line for you.
 */
export function BugStatusMenu({ id, status, title }: { id: string; status: BugStatus; title: string }) {
  const router = useRouter();
  const [value, setValue] = useState<BugStatus>(status);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function choose(next: BugStatus) {
    if (isClosingStatus(next)) {
      router.push(`/bugs/${id}?status=${next}`);
      return;
    }
    const previous = value;
    setValue(next);
    setError(null);
    const data = new FormData();
    data.append("id", id);
    data.append("status", next);
    startSaving(async () => {
      const state = await setBugStatus(null, data);
      if (state && !state.ok) {
        setValue(previous);
        setError(state.error);
      }
    });
  }

  return (
    <div className="shrink-0">
      <select
        aria-label={`Status of ${title}`}
        value={value}
        disabled={saving}
        onChange={(event) => choose(event.target.value as BugStatus)}
        className={cn(inputClasses, "w-auto py-1.5 sm:text-xs")}
      >
        {BUG_STATUSES.map((s) => (
          <option key={s} value={s}>
            {isClosingStatus(s) && s !== status ? `${BUG_STATUS_LABELS[s]}…` : BUG_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
