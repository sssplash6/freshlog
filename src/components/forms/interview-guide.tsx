"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
import { NOTES_MAX } from "@/lib/peer-interviews";

type Feedback = { summary: string; wentWell: string; toImprove: string };

/**
 * One screen at a time, in the order the session is run: introductions, the
 * rubric, each question, then feedback. Each student moves at their own pace;
 * the two coordinate by talking.
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
  const steps = ["intro", "rubric", ...questions.map((_, i) => `q${i}`), "feedback"];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>(savedAnswers);
  const [feedback, setFeedback] = useState<Feedback>(savedFeedback);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const current = steps[step];
  const qIndex = current.startsWith("q") ? Number(current.slice(1)) : null;

  function send(action: (p: ActionState, f: FormData) => Promise<ActionState>, fields: Record<string, string>) {
    const data = new FormData();
    data.append("interviewId", interviewId);
    for (const [k, v] of Object.entries(fields)) data.append(k, v);
    return action(null, data);
  }

  function saveCurrent() {
    startTransition(async () => {
      const result =
        qIndex !== null
          ? await send(saveInterviewAnswer, { questionIndex: String(qIndex), text: answers[qIndex] ?? "" })
          : current === "feedback"
            ? await send(saveInterviewFeedback, feedback)
            : null;
      setMessage(result && !result.ok ? result.error : null);
    });
  }

  function go(to: number) {
    saveCurrent();
    setStep(to);
  }

  function submit() {
    startTransition(async () => {
      const result = await send(submitInterviewFeedback, feedback);
      if (result?.ok) {
        router.push(`/student/interviews/${interviewId}`);
      } else {
        setMessage(result?.error ?? "Could not send. Try again.");
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
        <Section title={`3. Interview practice · question ${qIndex + 1} of ${questions.length}`} caption={INTERVIEW_TURNS}>
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
                      return { ...was, [qIndex]: before ? `${before} ${text}` : text };
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

      {message && <p className="text-sm text-danger-ink" role="alert">{message}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" disabled={step === 0 || pending} onClick={() => go(step - 1)}>
          Back
        </Button>
        {current === "feedback" ? (
          <Button disabled={pending} onClick={submit}>
            {pending ? "Sending…" : `Send feedback to ${partner}`}
          </Button>
        ) : (
          <Button disabled={pending} onClick={() => go(step + 1)}>
            Next
          </Button>
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
