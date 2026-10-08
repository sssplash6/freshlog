import Link from "next/link";

import { PersonChip } from "@/components/person-chip";
import { DateLeaf } from "@/components/session-row";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/cn";
import { formatDate, formatMinutes } from "@/lib/format";
import { templateName } from "@/lib/interview-templates";
import { PHASE_STATUS, type InterviewPhase } from "@/lib/peer-interviews";
import { status, type ViewerContext } from "@/lib/status";

/**
 * A practice interview in a student's meetings log, in the timeline row's
 * shape so the two read as one history. Its minutes are muted and never
 * bold — they were not drawn from any allocation — and the row says so,
 * because a figure in a ledger column is otherwise read as time spent.
 */
export function InterviewLogRow({
  interview,
  viewer,
  index,
}: {
  interview: {
    id: string;
    startsAt: Date;
    minutes: number;
    template: string;
    phase: InterviewPhase;
    partner: { id: string; name: string | null; email: string; avatarUpdatedAt?: Date | null };
  };
  viewer: ViewerContext;
  index?: number;
}) {
  const chip = status(PHASE_STATUS[interview.phase], viewer);
  const stagger =
    index == null ? undefined : { animationDelay: `${Math.min(index, 14) * 24}ms` };

  return (
    <li
      id={`interview-${interview.id}`}
      className={cn("group flex items-start gap-3 py-3", index != null && "deal-in")}
      style={stagger}
    >
      <DateLeaf date={interview.startsAt} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-x-2">
          <div className="flex min-w-0 flex-1 items-center gap-x-2.5 gap-y-1 text-xs max-sm:flex-wrap">
            <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-fg @4xl:hidden">
              {formatDate(interview.startsAt)}
            </span>
            <span className="flex min-w-0 max-w-44">
              <PersonChip person={interview.partner} size="sm" />
            </span>
            <Link
              href={`/student/interviews/${interview.id}`}
              transitionTypes={["nav-forward"]}
              title={templateName(interview.template)}
              className="min-w-0 flex-1 truncate font-medium text-ink hover:text-brand max-sm:basis-full"
            >
              Practice interview · {templateName(interview.template)}
            </Link>
          </div>
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-fg">
            {formatMinutes(interview.minutes)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-fg">
          {chip && <StatusChip status={chip} />}
          <span>Not counted toward your hours</span>
        </div>
      </div>
    </li>
  );
}
