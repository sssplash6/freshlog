import { PersonChip } from "@/components/person-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { formatDate } from "@/lib/format";
import { templateById } from "@/lib/interview-templates";
import {
  PHASE_STATUS,
  formatSlotSpan,
  formatSlotWhen,
  interviewPhase,
} from "@/lib/peer-interviews";
import { status, type ViewerContext } from "@/lib/status";
import type { StudentInterview } from "@/lib/student-interviews";

type Feedback = NonNullable<StudentInterview["given"]>;

function FeedbackBlock({ title, feedback }: { title: string; feedback: Feedback }) {
  return (
    <div className="space-y-2 px-4 py-2 text-sm sm:px-5">
      <h4 className="font-semibold text-ink">{title}</h4>
      <dl className="space-y-2">
        <div><dt className="text-muted-fg">Summary</dt><dd className="whitespace-pre-wrap text-ink">{feedback.summary}</dd></div>
        <div><dt className="text-muted-fg">What went well</dt><dd className="whitespace-pre-wrap text-ink">{feedback.wentWell}</dd></div>
        <div><dt className="text-muted-fg">What to improve</dt><dd className="whitespace-pre-wrap text-ink">{feedback.toImprove}</dd></div>
      </dl>
    </div>
  );
}

/**
 * A student's practice interviews, for the mentors who have worked with them.
 *
 * One fold per interview, newest first: when it was, who with, and — opened —
 * what the student answered, what they noted, and the feedback each way. The
 * rows come from `interviewsOfStudent`, which has already left out the
 * partner's private side and every unsent draft.
 */
export function StudentInterviews({
  interviews,
  viewer,
}: {
  interviews: StudentInterview[];
  viewer: ViewerContext;
}) {
  return (
    <Section
      title="Practice interviews"
      count={interviews.length}
      caption="What they rehearsed with a classmate."
    >
      <ul className="divide-y divide-line">
        {interviews.map((i) => {
          const chip = status(PHASE_STATUS[interviewPhase(i, viewer.now)], viewer);
          const template = templateById(i.template);
          const hasDetail =
            i.answers.length > 0 || i.notes.trim() !== "" || i.given || i.received;
          return (
            <li key={i.id} className="space-y-1 py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 sm:px-5">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {template?.name ?? "Practice interview"}
                  </p>
                  <p className="text-xs text-muted-fg">
                    {formatSlotWhen(i.slot.startsAt)} · {formatSlotSpan(i.slot)}
                    {i.completedAt && <> · completed {formatDate(i.completedAt)}</>}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <PersonChip person={{ ...i.partner, email: "" }} size="sm" />
                  {chip && <StatusChip status={chip} />}
                </div>
              </div>
              {hasDetail ? (
                <div className="px-4 sm:px-5">
                  <Disclosure label="Answers, notes and feedback">
                    <div className="-mx-4 space-y-3 sm:-mx-5">
                      {i.answers.length > 0 && (
                        <dl className="divide-y divide-line">
                          {i.answers.map((a) => (
                            <div key={a.questionIndex} className="px-4 py-2 sm:px-5">
                              <dt className="text-sm font-semibold text-ink">{a.question}</dt>
                              <dd className="mt-1 whitespace-pre-wrap text-sm text-ink">
                                {a.text || "—"}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {i.notes.trim() !== "" && (
                        <div className="px-4 py-2 text-sm sm:px-5">
                          <h4 className="font-semibold text-ink">Their notes</h4>
                          <p className="mt-1 whitespace-pre-wrap text-ink">{i.notes}</p>
                        </div>
                      )}
                      {i.received && (
                        <FeedbackBlock
                          title={`Feedback from ${i.partner.name ?? "their partner"}`}
                          feedback={i.received}
                        />
                      )}
                      {i.given && (
                        <FeedbackBlock
                          title={`Feedback they gave ${i.partner.name ?? "their partner"}`}
                          feedback={i.given}
                        />
                      )}
                    </div>
                  </Disclosure>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
