"use client";

import { useActionState, useOptimistic } from "react";

import { setEssayStage } from "@/lib/actions/applications";
import {
  ESSAY_STAGE_LABEL,
  ESSAY_STAGES,
  isEssayStage,
  stageStep,
  type EssayStage,
} from "@/lib/applications";
import { cn } from "@/lib/cn";

/** Each stage's fill. Spelled out so Tailwind sees every class. */
const STAGE_FILL: Record<EssayStage, string> = {
  BRAINSTORMING: "bg-stage-brainstorming",
  WRITING: "bg-stage-writing",
  FINALIZING: "bg-stage-finalizing",
  DONE: "bg-stage-done",
};

/**
 * An essay's stage as a bar of four segments, filled up to the stage it has
 * reached in that stage's colour, with the stage named beside it — colour is
 * the glance, the word is the fact.
 *
 * For a reader who may change it, each segment is the button that moves the
 * essay to that stage: the bar is read and set in the same place, the way a
 * mentor thinks of it ("it's at Finalizing now"). The change shows at once and
 * the server catches up; a refusal puts the bar back and says why.
 */
export function EssayStageBar({
  stage,
  label,
  editable = false,
  studentProfileId,
  target,
  showSteps = false,
}: {
  stage: string | null;
  /** What the essay is, for screen readers: "Motivational essay", "Princeton". */
  label: string;
  editable?: boolean;
  studentProfileId?: string;
  /** "essay", or the id of the student's university row. */
  target?: string;
  /** Name every stage under its segment, on screens wide enough for four. */
  showSteps?: boolean;
}) {
  const [result, dispatch] = useActionState(setEssayStage, null);
  const [shown, setShown] = useOptimistic(stage);
  const current = isEssayStage(shown) ? shown : null;
  const step = stageStep(current);
  const fill = current ? STAGE_FILL[current] : "";

  const segments = ESSAY_STAGES.map((s, i) => {
    const filled = i < step;
    const bar = (
      <span
        aria-hidden
        className={cn(
          "block h-2 w-full rounded-full transition-colors",
          filled ? fill : "bg-fill-strong"
        )}
      />
    );
    if (!editable) return <span key={s} className="min-w-0 flex-1">{bar}</span>;
    return (
      <button
        key={s}
        type="submit"
        name="stage"
        value={s}
        aria-pressed={current === s}
        aria-label={`${label}: ${ESSAY_STAGE_LABEL[s]}`}
        title={ESSAY_STAGE_LABEL[s]}
        // A 44px target on a phone around an 8px bar: the bar is what is seen,
        // the band around it is what the thumb hits.
        className="group min-w-0 flex-1 cursor-pointer rounded-md py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:py-1.5"
      >
        <span className="block transition-transform group-hover:scale-y-150">{bar}</span>
        {showSteps && (
          <span
            className={cn(
              "mt-1.5 hidden truncate text-caption sm:block",
              current === s ? "font-semibold text-ink" : "text-muted-fg"
            )}
          >
            {ESSAY_STAGE_LABEL[s]}
          </span>
        )}
      </button>
    );
  });

  const word = (
    <span className={cn("shrink-0 text-sm tabular-nums", current ? "text-ink" : "text-muted-fg")}>
      {current ? ESSAY_STAGE_LABEL[current] : "Not started"}
    </span>
  );

  if (!editable) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 gap-1" role="img" aria-label={`${label}: ${current ? ESSAY_STAGE_LABEL[current] : "not started"}`}>
          {segments}
        </div>
        {word}
      </div>
    );
  }

  return (
    <form
      action={(formData) => {
        const next = formData.get("stage");
        if (isEssayStage(next)) setShown(next);
        dispatch(formData);
      }}
    >
      <input type="hidden" name="studentProfileId" value={studentProfileId} />
      <input type="hidden" name="target" value={target} />
      <fieldset className="flex items-start gap-3">
        <legend className="sr-only">{label}</legend>
        <div className="flex min-w-0 flex-1 gap-1">{segments}</div>
        {/* Where every step is named under its segment, the bold one already
            says which; the word beside the bar is for the phone. */}
        <span className={cn("py-1 sm:py-0.5", showSteps && "sm:hidden")}>{word}</span>
      </fieldset>
      {result && !result.ok && (
        <p role="alert" className="mt-1 text-xs text-danger-ink">
          {result.error}
        </p>
      )}
    </form>
  );
}
