"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { DictateButton } from "@/components/forms/dictate-button";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, GrowingField } from "@/components/ui/field";
import { Section } from "@/components/ui/section";
import {
  saveInterviewAnswer,
  saveInterviewFeedback,
  submitInterviewFeedback,
} from "@/lib/actions/interviews";
import type { ActionState } from "@/lib/actions/shared";
import { INTERVIEW_RUBRIC } from "@/lib/interview-templates";
import { NOTES_MAX } from "@/lib/peer-interviews";

type Feedback = { summary: string; wentWell: string; toImprove: string };

/**
 * One screen at a time, in the order the session is run: the rubric, each
 * question, then feedback. Each student moves at their own pace; the two
 * coordinate by talking. No captions: the questions and the rubric are the
 * content, and each appears once.
 *
 * Everything typed is saved as the box loses focus and again on Next, so a
 * closed tab loses at most the box being typed in.
 */
export function InterviewGuide({
  interviewId,
  partner,
  meetingUrl,
  questions,
  answers: savedAnswers,
  feedback: savedFeedback,
  canDictate,
}: {
  interviewId: string;
  partner: string;
  meetingUrl: string | null;
  questions: readonly string[];
  answers: Record<number, string>;
  feedback: Feedback;
  canDictate: boolean;
}) {
  const router = useRouter();
  const steps = ["rubric", ...questions.map((_, i) => `q${i}`), "feedback"];
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
          [stepIndex]: "Didn't save. Check your connection.",
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
          router.push(`/student/interviews/${interviewId}`);
        } else {
          setSubmitError(result?.error ?? "Could not send. Try again.");
        }
      } catch {
        setSubmitError("Didn't save. Check your connection.");
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

      {current === "rubric" && (
        <Section title="Rubric">
          <Rubric />
        </Section>
      )}

      {qIndex !== null && (
        <Section title={`Question ${qIndex + 1}`}>
          <div className="space-y-3 px-4 py-2 sm:px-5">
            <p className="text-base font-semibold text-ink">{questions[qIndex]}</p>
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
              value={answers[qIndex] ?? ""}
              maxLength={NOTES_MAX}
              onChange={(e) => setAnswers((was) => ({ ...was, [qIndex]: e.target.value }))}
              onBlur={saveCurrent}
            />
          </div>
        </Section>
      )}

      {current === "feedback" && (
        <Section title="Feedback">
          <div className="space-y-4 px-4 py-2 sm:px-5">
            <Box label="Summary" value={feedback.summary} onChange={setBox("summary")} onBlur={saveCurrent} />
            <Box label="What went well" value={feedback.wentWell} onChange={setBox("wentWell")} onBlur={saveCurrent} />
            <Box label="What to improve" value={feedback.toImprove} onChange={setBox("toImprove")} onBlur={saveCurrent} />
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
              {submitPending ? "Sending…" : "Send feedback"}
            </Button>
          </div>
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
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <Field label={label}>
      <GrowingField
        value={value}
        maxLength={NOTES_MAX}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </Field>
  );
}
