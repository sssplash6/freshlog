"use client";

import { useId, useRef, useState } from "react";

import { InboxIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { peopleFromCells, peopleFromText, type ImportedPerson } from "@/lib/roster-import";

/**
 * Fill an add form's rows from a list somebody already has: pasted from a
 * spreadsheet or an email, or a CSV or Excel file. Nothing is sent from here —
 * the rows land in the form, where every one can be read and corrected before
 * the submit button adds them.
 *
 * The Excel reader is loaded only when a workbook is picked: it is the one
 * heavy thing here, and most visits to the page never import anything.
 */
export function RosterImport({
  noun,
  onImport,
}: {
  /** "student" or "mentor": what the status line counts. */
  noun: string;
  onImport: (people: ImportedPerson[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  const found = text.trim() ? peopleFromText(text) : [];
  const plural = (n: number) => `${n} ${noun}${n === 1 ? "" : "s"}`;

  const take = (people: ImportedPerson[], from: string) => {
    if (people.length === 0) {
      setProblem(`No ${noun}s found in ${from}. Put one per line, with their email address.`);
      return;
    }
    onImport(people);
    setText("");
    setProblem(null);
    setOpen(false);
  };

  const readFile = async (picked: File) => {
    setReading(true);
    setProblem(null);
    try {
      if (/\.xlsx$/i.test(picked.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        take(peopleFromCells(await readSheet(picked)), picked.name);
      } else if (/\.(csv|tsv|txt)$/i.test(picked.name)) {
        take(peopleFromText(await picked.text()), picked.name);
      } else {
        setProblem("Choose an Excel (.xlsx), CSV or text file. An older .xls can be saved as .xlsx from Excel.");
      }
    } catch {
      setProblem(`${picked.name} could not be read. Save it again as .xlsx or CSV and try once more.`);
    } finally {
      setReading(false);
      if (file.current) file.current.value = "";
    }
  };

  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)} className="gap-1.5">
        <InboxIcon className="h-4 w-4 shrink-0" />
        Paste or import a list
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg bg-canvas p-3">
      <label htmlFor={fieldId} className="block text-xs font-medium text-muted-fg">
        Paste from a spreadsheet or an email: one {noun} per line, with their email address
      </label>
      <Textarea
        id={fieldId}
        rows={5}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setProblem(null);
        }}
        placeholder={"Malika\tRahimova\tmalika@example.com\nAzim Egamberdiev <azim@example.com>"}
        autoFocus
      />
      {/* Not a <form>: this sits inside the add form, and a nested form
          would submit the outer one. */}
      <input
        ref={file}
        type="file"
        accept=".xlsx,.csv,.tsv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) void readFile(picked);
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-fg" aria-live="polite">
          {problem ? (
            <span className="font-medium text-danger-ink">{problem}</span>
          ) : found.length > 0 ? (
            <>
              <span className="font-medium tabular-nums text-ink">{plural(found.length)}</span> found
            </>
          ) : (
            "Or choose an Excel or CSV file."
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="secondary" disabled={reading} onClick={() => file.current?.click()}>
            {reading ? "Reading…" : "Choose file"}
          </Button>
          <Button
            type="button"
            variant={found.length > 0 ? "primary" : "secondary"}
            disabled={found.length === 0}
            onClick={() => take(found, "the list")}
          >
            {found.length > 0 ? `Add ${plural(found.length)} to the list` : "Add to the list"}
          </Button>
        </div>
      </div>
    </div>
  );
}
