import { PersonCell, PersonChip } from "@/components/person-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { FILL_CELL, Table, Td, Tr } from "@/components/ui/table";
import { adminScope, scopeProgramFilter } from "@/lib/authz";
import { requireAdminAccess } from "@/lib/dal";
import { readParam, type SearchParams } from "@/lib/filters";
import { formatDate, formatDuration } from "@/lib/format";
import {
  interviewsForStaff,
  prepByStudent,
  type PrepInterview,
} from "@/lib/interview-prep";
import { templateName } from "@/lib/interview-templates";
import { PHASE_STATUS, formatSlotWhen } from "@/lib/peer-interviews";
import { status, type ViewerContext } from "@/lib/status";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Interview prep" };

/**
 * Students' practice interviews, for the people who run their programs: who is
 * meeting whom, and how much time each student has actually put in.
 *
 * Who and when only. The answers, notes and feedback stay with the two students
 * and the mentors who work with them — `interviewsForStaff` never selects them.
 */
export default async function InterviewsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAdminAccess();
  const scope = await adminScope(user);
  const params = await searchParams;
  const page = parsePage(readParam(params, "page"));
  const now = new Date();
  const viewer: ViewerContext = { audience: "staff", userId: user.id, now };

  const interviews = await interviewsForStaff(scopeProgramFilter(scope), now);
  // Soonest first: the next meeting is the one somebody might need to chase.
  const upcoming = interviews.filter((i) => i.phase === "booked").reverse();
  const past = interviews.filter((i) => i.phase !== "booked");
  const students = prepByStudent(interviews);
  const held = past.filter((i) => i.phase === "completed");
  const heldMinutes = held.reduce((sum, i) => sum + i.minutes, 0);
  const pastPage = past.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <PageTitle
        title="Interview prep"
        subtitle={
          held.length > 0
            ? `${held.length} held · ${formatDuration(heldMinutes)} practised`
            : undefined
        }
      />

      {interviews.length === 0 ? (
        <EmptyState title="No practice interviews yet">
          Students book them with classmates under Interviews.
        </EmptyState>
      ) : (
        <>
          <Section title="Coming up" count={upcoming.length}>
            {upcoming.length === 0 ? (
              <EmptyState title="Nothing booked" />
            ) : (
              <MeetingsTable rows={upcoming} viewer={viewer} />
            )}
          </Section>

          <Section title="By student" count={students.length}>
            <Table
              label="Practice by student"
              columns={[
                { label: "Student" },
                { label: "Held", align: "right" },
                { label: "Time practised", align: "right", emphasis: "key" },
                { label: "Booked", align: "right" },
                { label: "No-shows", align: "right" },
                { label: "Last" },
              ]}
            >
              {students.map((s) => (
                <Tr key={s.person.profileId}>
                  <Td className={FILL_CELL}>
                    <PersonCell
                      person={s.person}
                      href={`/students/${s.person.profileId}`}
                      secondary={false}
                    />
                  </Td>
                  <Td label="Held" align="right">
                    {s.held}
                  </Td>
                  <Td label="Time practised" align="right" tone="key">
                    {s.minutesHeld > 0 ? formatDuration(s.minutesHeld) : "—"}
                  </Td>
                  <Td label="Booked" align="right" tone="muted">
                    {s.upcoming}
                  </Td>
                  <Td label="No-shows" align="right" tone="muted">
                    {s.missed}
                  </Td>
                  <Td label="Last" tone="muted" className="sm:whitespace-nowrap">
                    {s.lastAt ? formatDate(s.lastAt) : "—"}
                  </Td>
                </Tr>
              ))}
            </Table>
          </Section>

          <Section title="History" count={past.length}>
            {past.length === 0 ? (
              <EmptyState title="None held yet" />
            ) : (
              <div className="space-y-3">
                <MeetingsTable rows={pastPage} viewer={viewer} withStatus />
                {past.length > PAGE_SIZE && (
                  <Pagination
                    basePath="/interviews"
                    params={params}
                    page={page}
                    total={past.length}
                    unit="interviews"
                    className="px-1"
                  />
                )}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

/** Who met whom, when, for how long — and, once the time has passed, whether it happened. */
function MeetingsTable({
  rows,
  viewer,
  withStatus = false,
}: {
  rows: PrepInterview[];
  viewer: ViewerContext;
  withStatus?: boolean;
}) {
  return (
    <Table
      label="Practice interviews"
      columns={[
        { label: "When" },
        { label: "Students" },
        { label: "Interview" },
        { label: "Length", align: "right" },
        ...(withStatus ? [{ label: "Status" }] : []),
      ]}
    >
      {rows.map((iv) => {
        const chip = withStatus ? status(PHASE_STATUS[iv.phase], viewer) : null;
        const absent = iv.absent ? iv[iv.absent] : null;
        return (
          <Tr key={iv.id}>
            <Td label="When" tone="muted" className="sm:whitespace-nowrap">
              {formatSlotWhen(iv.startsAt)}
            </Td>
            <Td label="Students" className={FILL_CELL}>
              <span className="flex flex-wrap items-center gap-1.5">
                {[iv.host, iv.guest].map((p) => (
                  <span key={p.profileId} className="flex min-w-0 max-w-48">
                    <PersonChip
                      person={p}
                      size="sm"
                      href={p.ours ? `/students/${p.profileId}` : undefined}
                    />
                  </span>
                ))}
              </span>
            </Td>
            <Td label="Interview" className="sm:whitespace-nowrap">
              {templateName(iv.template)}
            </Td>
            <Td label="Length" align="right" tone="muted">
              {formatDuration(iv.minutes)}
            </Td>
            {withStatus && (
              <Td label="Status" className="sm:whitespace-nowrap">
                <span className="flex items-center gap-x-2 gap-y-1 max-sm:flex-wrap">
                  {chip && <StatusChip status={chip} />}
                  {absent && (
                    <span className="text-xs text-muted-fg">
                      {`${absent.name ?? "A student"} didn’t join`}
                    </span>
                  )}
                </span>
              </Td>
            )}
          </Tr>
        );
      })}
    </Table>
  );
}
