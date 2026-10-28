"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { DictateButton } from "@/components/forms/dictate-button";
import { Button, buttonClasses } from "@/components/ui/button";
import { GrowingField } from "@/components/ui/field";
import { Section } from "@/components/ui/section";
import {
  saveInterviewAnswer,
  saveInterviewFeedback,
  submitInterviewFeedback,
} from "@/lib/actions/interviews";
import type { ActionState } from "@/lib/actions/shared";
import {
  FEEDBACK_DISCUSS,
  FEEDBACK_PROMPTS,
  INTERVIEW_INTRO,
  INTERVIEW_RUBRIC,
  INTERVIEW_TURNS,
} from "@/lib/interview-templates";
import {
  NOTES_MAX,
  answers as answersQuestions,
  givesFeedback,
  type InterviewPart,
} from "@/lib/peer-interviews";

/** What the question step says, by part: peers take turns, a mentor asks, a student answers. */
const QUESTION_CAPTION: Record<InterviewPart, string> = {
  peer: INTERVIEW_TURNS,
  interviewer: "Ask the question, then listen. Note what to say in your feedback.",
  interviewee: "Answer your mentor's question out loud.",
};

type Feedback = { summary: string; wentWell: string; toImprove: string };

/**
 * One screen at a time, in the order the session is run: introductions, the
 * rubric, each question, then feedback. Each side moves at their own pace;
 * the two coordinate by talking.
 *
 * With a mentor the sides differ (`part`): the mentor sees each question with
 * no answer box and ends on the feedback, the student answers and ends on the
 * last question.
 *
 * Everything typed is saved as the box loses focus and again on Next, so a
 * closed tab loses at most the box being typed in.
 */
export function InterviewGuide({
  interviewId,
  base,
  part,
  partner,
  meetingUrl,
  questions,
  answers: savedAnswers,
  feedback: savedFeedback,
  canDictate,
}: {
  interviewId: string;
  /** This side's interview pages, where the guide hands back. */
  base: string;
  part: InterviewPart;
  partner: string;
  meetingUrl: string | null;
  questions: readonly string[];
  answers: Record<number, string>;
  feedback: Feedback;
  canDictate: boolean;
}) {
  const router = useRouter();
  const steps = [
    "intro",
    "rubric",
    ...questions.map((_, i) => `q${i}`),
    ...(givesFeedback(part) ? ["feedback"] : []),
  ];
  const answering = answersQuestions(part);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>(savedAnswers);
  const [feedback, setFeedback] = useState<Feedback>(savedFeedback);
  // Keyed by STEP INDEX, not by the current step, so an error survives
  // navigating away from the step that failed to save (see the persistent
  // notice below) instead of being wiped by the next step's own outcome.
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The background autosave (blur, and the one Next/Back fires before it
  // navigates) must never disable Back/Next/Submit — a click that lands while
  // a box is still focused blurs the box first, which would otherwise disable
  // the very button being clicked before the click is processed. Submit gets
  // its own pending flag so IT can still disable itself against a double
  // send.
  const [, startSave] = useTransition();
  const [submitPending, startSubmit] = useTransition();
  // What was last sent for a given step, so a save the blur already fired
  // isn't repeated the instant Next/Back fires the same save again.
  const savedRef = useRef<Record<string, string>>({});

  const current = steps[step];
  const qIndex = current.startsWith("q") ? Number(current.slice(1)) : null;

  function send(action: (p: ActionState, f: FormData) => Promise<ActionState>, fields: Record<string, string>) {
    const data = new FormData();
    data.append("interviewId", interviewId);
    for (const [k, v] of Object.entries(fields)) data.append(k, v);
    return action(null, data);
  }

  function clearStepError(stepIndex: number) {
    setErrors((was) => {
      if (!(stepIndex in was)) return was;
      const next = { ...was };
      delete next[stepIndex];
      return next;
    });
  }

  function saveCurrent() {
    if (qIndex === null && current !== "feedback") return;
    if (qIndex !== null && !answering) return;
    const key = current;
    const stepIndex = step;
    const value = qIndex !== null ? (answers[qIndex] ?? "") : JSON.stringify(feedback);
    // Already sent this exact value (the blur that just fired, or a previous
    // Next/Back at this step) — skip the repeat request.
    if (savedRef.current[key] === value) return;
    savedRef.current[key] = value;

    startSave(async () => {
      try {
        const result =
          qIndex !== null
            ? await send(saveInterviewAnswer, { questionIndex: String(qIndex), text: value })
            : await send(saveInterviewFeedback, feedback);
        if (result && !result.ok) {
          delete savedRef.current[key];
          setErrors((was) => ({ ...was, [stepIndex]: result.error }));
        } else {
          clearStepError(stepIndex);
        }
      } catch {
        // A thrown action (a dropped connection) must not unmount the guide —
        // it is recorded as this step's error instead of reaching the error
        // boundary.
        delete savedRef.current[key];
        setErrors((was) => ({
          ...was,
          [stepIndex]: "That didn't save. Check your connection and try again.",
        }));
      }
    });
  }

  function go(to: number) {
    saveCurrent();
    setStep(to);
  }

  /** What a step with an unsaved error is called, for the "go back" notice. */
  function stepLabel(i: number): string {
    const id = steps[i];
    if (id === "feedback") return "Feedback";
    if (id?.startsWith("q")) return `Question ${Number(id.slice(1)) + 1}`;
    return "This step";
  }

  function submit() {
    setSubmitError(null);
    startSubmit(async () => {
      try {
        const result = await send(submitInterviewFeedback, feedback);
        if (result?.ok) {
          router.push(`${base}/${interviewId}`);
        } else {
          setSubmitError(result?.error ?? "Could not send. Try again.");
        }
      } catch {
        setSubmitError("That didn't save. Check your connection and try again.");
      }
    });
  }

  const setBox = (key: keyof Feedback) => (value: string) =>
    setFeedback((was) => ({ ...was, [key]: value }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-fg">
          Step {step + 1} of {steps.length} · with {partner}
        </p>
        {meetingUrl && (
          <a href={meetingUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary", "sm")}>
            Join meeting
          </a>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full bg-brand transition-all" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
      </div>

      {current === "intro" && (
        <Section title="1. Introductions">
          <p className="px-4 py-2 text-sm text-ink sm:px-5">{INTERVIEW_INTRO}</p>
        </Section>
      )}

      {current === "rubric" && (
        <Section title="2. Review the feedback rubric" caption="Familiarize yourselves with the four evaluation criteria before starting the interview.">
          <Rubric />
        </Section>
      )}

      {qIndex !== null && (
        <Section title={`3. Interview practice · question ${qIndex + 1} of ${questions.length}`} caption={QUESTION_CAPTION[part]}>
          <div className="space-y-3 px-4 py-2 sm:px-5">
            <p className="text-base font-semibold text-ink">{questions[qIndex]}</p>
            {answering && (
              <>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-fg">Your answer</span>
                  {canDictate && (
                    <DictateButton
                      interviewId={interviewId}
                      purpose="answer"
                      onText={(text) =>
                        setAnswers((was) => {
                          const before = (was[qIndex] ?? "").trim();
                          const combined = before ? `${before} ${text}` : text;
                          // maxLength on the field only stops typing past it — a
                          // dictated chunk appended in one go bypasses it.
                          return { ...was, [qIndex]: combined.slice(0, NOTES_MAX) };
                        })
                      }
                    />
                  )}
                </div>
                <GrowingField
                  aria-label="Your answer"
                  placeholder="Press Speak and answer out loud, or type"
                  value={answers[qIndex] ?? ""}
                  maxLength={NOTES_MAX}
                  onChange={(e) => setAnswers((was) => ({ ...was, [qIndex]: e.target.value }))}
                  onBlur={saveCurrent}
                />
              </>
            )}
          </div>
        </Section>
      )}

      {current === "feedback" && (
        <Section title="4. Partner feedback" caption={FEEDBACK_DISCUSS}>
          <div className="space-y-4 px-4 py-2 sm:px-5">
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-fg">The four criteria</summary>
              <Rubric />
            </details>
            <Box label="Summary" prompt={FEEDBACK_PROMPTS.summary} value={feedback.summary} onChange={setBox("summary")} onBlur={saveCurrent} />
            <Box label="What went well" prompt={FEEDBACK_PROMPTS.wentWell} value={feedback.wentWell} onChange={setBox("wentWell")} onBlur={saveCurrent} />
            <Box label="What to improve" prompt={FEEDBACK_PROMPTS.toImprove} value={feedback.toImprove} onChange={setBox("toImprove")} onBlur={saveCurrent} />
          </div>
        </Section>
      )}

      {Object.keys(errors)
        .map(Number)
        .filter((i) => i !== step)
        .map((i) => (
          <p key={i} className="text-sm text-danger-ink" role="alert">
            {stepLabel(i)} didn&rsquo;t save. Go back to it.
          </p>
        ))}
      {errors[step] && (
        <p className="text-sm text-danger-ink" role="alert">
          {errors[step]}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" disabled={step === 0} onClick={() => go(step - 1)}>
          Back
        </Button>
        {current === "feedback" ? (
          <div className="flex flex-col items-end gap-1.5">
            {submitError && (
              <p className="text-sm text-danger-ink" role="alert">
                {submitError}
              </p>
            )}
            <Button disabled={submitPending} onClick={submit}>
              {submitPending ? "Sending…" : `Send feedback to ${partner}`}
            </Button>
          </div>
        ) : step === steps.length - 1 ? (
          // The student a mentor interviews ends here: the feedback is the
          // mentor's to write.
          <Button
            onClick={() => {
              saveCurrent();
              router.push(`${base}/${interviewId}`);
            }}
          >
            Finish
          </Button>
        ) : (
          <Button onClick={() => go(step + 1)}>Next</Button>
        )}
      </div>
    </div>
  );
}

function Rubric() {
  return (
    <div className="grid gap-3 px-4 py-2 sm:grid-cols-2 sm:px-5">
      {INTERVIEW_RUBRIC.map((c) => (
        <div key={c.name}>
          <p className="text-sm font-semibold text-ink">{c.name}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-fg">
            {c.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Box({
  label,
  prompt,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  prompt: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-ink">{label}</p>
      <p className="text-xs text-muted-fg">{prompt}</p>
      <GrowingField
        aria-label={label}
        value={value}
        maxLength={NOTES_MAX}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
}
