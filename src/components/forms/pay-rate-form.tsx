"use client";

import { Select, type SelectOption } from "@/components/select";
import { DateField } from "@/components/ui/date-field";
import { Field, Input } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { setMentorRate } from "@/lib/actions/pay";

/**
 * Set what a mentor is paid per logged hour, from a day.
 *
 * Every save adds a rate; none changes an old one. That is the whole of how a
 * mistake is fixed — save again from the same day — so the hint says it where
 * the mistake would be made. The server checks all of it again.
 */
export function PayRateForm({
  mentors,
  min,
  max,
  today,
}: {
  mentors: SelectOption[];
  /** `YYYY-MM-DD`: the first of this month in Tashkent. */
  min: string;
  /** `YYYY-MM-DD`: a year from today. */
  max: string;
  /** `YYYY-MM-DD`: the first day offered. */
  today: string;
}) {
  const [result, action, save] = useSaveState(setMentorRate);
  const failed = result && !result.ok ? result : null;
  const errorOn = (field: string) => (failed?.field === field ? failed.error : undefined);
  const refill = (field: string, fallback = "") => failed?.values?.[field] ?? fallback;

  return (
    // Keyed on the result, so a failed save remounts with what was typed and a
    // saved one comes back empty, ready for the next mentor.
    <form key={JSON.stringify(result)} action={action} className="space-y-4 px-4 py-3 sm:px-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Mentor" required error={errorOn("mentorId")} className="sm:col-span-3">
          <Select
            name="mentorId"
            ariaLabel="Mentor"
            options={mentors}
            placeholder="Choose a mentor"
            defaultValue={refill("mentorId")}
            invalid={Boolean(errorOn("mentorId"))}
          />
        </Field>
        <Field label="Dollars an hour" required error={errorOn("dollarsPerHour")} hint="0 pays nothing from that day.">
          <Input
            name="dollarsPerHour"
            inputMode="decimal"
            autoComplete="off"
            required
            placeholder="25.00"
            defaultValue={refill("dollarsPerHour")}
            aria-invalid={Boolean(errorOn("dollarsPerHour"))}
          />
        </Field>
        <Field
          label="Starts on"
          required
          error={errorOn("effectiveFrom")}
          hint="Same day again replaces a mistake."
          className="sm:col-span-2"
        >
          <DateField
            name="effectiveFrom"
            min={min}
            max={max}
            required
            defaultValue={refill("effectiveFrom", today)}
            invalid={Boolean(errorOn("effectiveFrom"))}
            label="Rate starts on"
          />
        </Field>
      </div>
      <div>
        <SubmitButton pendingText="Saving…">Set rate</SubmitButton>
        {/* Field errors print under their field; anything else, here. */}
        <SaveState state={failed?.field ? { kind: "idle" } : save} />
      </div>
    </form>
  );
}
