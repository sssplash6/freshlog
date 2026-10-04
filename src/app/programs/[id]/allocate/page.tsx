import { AssignTaskForm } from "@/components/forms/assign-task-form";
import { ParamSelect } from "@/components/param-select";
import { Section } from "@/components/ui/section";
import { staffLevel } from "@/lib/authz";
import { requireProgramScope } from "@/lib/dal";
import { readParam, type SearchParams } from "@/lib/filters";
import { formatBalance, formatDuration, formatMinutes } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { pastHours } from "@/lib/hours";
import { studentLedger } from "@/lib/queries";

import { programOf, programPairings, programStudents, studentsOf } from "../../reads";

/**
 * Grant somebody time, from the program rather than from their file.
 *
 * `/students/[id]/allocate` has always done this and still does — it is where
 * an admin already looking at one person goes. What it could not do is be the
 * first step: granting time is how a student BEGINS in a program, and reaching
 * it meant opening the roster, finding a name, opening their page and then the
 * form. So the same form lives here with the student as its first question,
 * and the program it is granted in is not a question at all.
 *
 * One parameter: `?student=`, because every field under it — which mentor,
 * which open tasks, what was paid — is a fact about that person that has to be
 * read before it can be drawn.
 */
export default async function AllocateInProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const me = await requireProgramScope(id);
  const query = await searchParams;

  const [program, roster, pairings] = await Promise.all([
    programOf(id),
    programStudents(id),
    programPairings(id),
  ]);

  // Their figures INSIDE this program: a student who also studies elsewhere
  // brings none of that program's hours to a picker about this one.
  const students = studentsOf(roster, id);
  const wanted = readParam(query, "student");
  const chosen = students.find((s) => s.id === wanted);

  // The program's own mentors. Granting time to somebody who does not work
  // here is not a thing this page can offer; `setMentorAllocation` refuses it
  // anyway, and an option that is always refused is not an option.
  const mentors = [...new Map(pairings.map((p) => [p.mentorId, p.mentor])).values()]
    .map((m) => ({ value: m.id, label: m.name ?? m.email }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const ledger = chosen ? await studentLedger(chosen.id, [id]) : null;
  // "Hour bank" leads the Agenda list only for an admin of a program that has
  // one — the only people who may change it.
  const bankOn = program.hourBank && (await staffLevel(me, id)) === "ADMIN";
  const banked = chosen
    ? (await prisma.hourAllocation.count({
        where: { studentId: chosen.id, programId: id, isBank: true },
      })) > 0
    : false;
  const past = chosen && bankOn && !banked ? await pastHours(prisma, chosen.id, id) : null;
  const openTasksByMentor: Record<string, { purpose: string; hint?: string }[]> = {};
  for (const task of ledger?.assignments ?? []) {
    if (task.progress === "DONE") continue;
    (openTasksByMentor[`${task.programId}:${task.mentorId ?? ""}`] ??= []).push({
      purpose: task.purpose,
      hint:
        task.minuteLimit != null
          ? `${formatMinutes(task.loggedMinutes)}/${formatMinutes(task.minuteLimit)}`
          : undefined,
    });
  }

  return (
    // No title of its own: the program's own header is directly above this,
    // and a second one under it would name the same program twice before
    // saying anything. The section carries the verb.
    <Section title="Allocate time" caption={`In ${program.name}`}>
      <div className="px-4 py-2 sm:px-5">
        {/* The same grid the form below uses, so the name sits in the column
            the mentor beneath it does rather than across the whole card. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ParamSelect
            param="student"
            value={chosen?.id ?? ""}
            label="Who is this for?"
            placeholder="Search the roster…"
            recentKey="allocate-student"
            options={students.map((s) => ({
              value: s.id,
              label: s.user.name ?? s.user.email,
              // What they hold here already: the figure an admin is about to
              // change, and the one they check before typing.
              hint:
                s.remainingMinutes < 0
                  ? formatBalance(s.remainingMinutes)
                  : `${formatDuration(s.remainingMinutes)} remaining`,
            }))}
          />
        </div>

        {chosen && (
          <div className="mt-4 border-t border-line pt-4">
            <AssignTaskForm
              // Remounted per student: the form holds its mentor and its
              // amounts in state, and the last student's answers are not a
              // draft of this one's.
              key={chosen.id}
              studentProfileId={chosen.id}
              // One, so it is posted rather than asked — this page IS the
              // program.
              programs={[{ value: id, label: program.name }]}
              mentors={mentors}
              openTasksByMentor={openTasksByMentor}
              paymentPrograms={program.tracksPayment && !program.hourBank ? [id] : []}
              bankPrograms={bankOn ? [id] : []}
              bankedPrograms={banked ? [id] : []}
              pastByProgram={past ? { [id]: past } : {}}
            />
          </div>
        )}
      </div>
    </Section>
  );
}
