import { Figure } from "@/components/ui/figure";
import { CreateProgramForm } from "@/components/forms/program-forms";
import { ProgramChip } from "@/components/program-chip";
import { PageTitle, Section } from "@/components/ui/section";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import { adminScope, scopeProgramFilter } from "@/lib/authz";
import { requireStaff } from "@/lib/dal";
import { formatRough } from "@/lib/format";
import { programTotals } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { studentsWithHours } from "@/lib/queries";

/**
 * The admin's landing page: how big are my programs, and how much time is
 * still in them.
 *
 * It used to open with "Needs you" — twenty derived rows about students,
 * mentors, tasks and meetings — and then a week's diary, and then this table.
 * Both of those are behind the bell now (`lib/attention.ts`, `/notifications`),
 * which is the one place in the app that answers "what is waiting on me". What
 * is left here is the thing no feed can say: the shape of the school this
 * person administers.
 *
 * Every figure comes from `programTotals` over the unsliced roster, per
 * program, so a student in two programs is counted once in each with that
 * program's own hours.
 */

/** "1 program", "3 programs" — the one place this page pluralises. */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export default async function AdminInboxPage() {
  const user = await requireStaff();

  // The reader's grants are applied ONCE here and every read below carries
  // them. `undefined` is a platform admin and means no filter at all — not
  // "every id I happen to have fetched", which would go stale the moment a
  // program is created.
  const programIds = scopeProgramFilter(await adminScope(user));
  const inScope = programIds ? { in: [...programIds] } : undefined;

  // One instant for the whole render, so no two figures can disagree about
  // what today is or what has expired.
  const now = new Date();

  const [programs, students, pairings] = await Promise.all([
    prisma.program.findMany({
      where: inScope ? { id: inScope } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    studentsWithHours(
      inScope ? { enrollments: { some: { programId: inScope } } } : {},
      { now, programIds }
    ),
    prisma.mentorAssignment.findMany({
      where: inScope ? { programId: inScope } : {},
      select: { mentorId: true, programId: true },
    }),
  ]);

  const overall = programTotals(students);
  const rows = programs.map((p) => {
    // That program's figures for each student in it — never the student's
    // combined row, which would put another program's hours in this total and
    // count a two-program student twice.
    const enrolled = students.flatMap((s) => {
      const figures = s.byProgram.get(p.id);
      return figures ? [figures] : [];
    });
    const totals = programTotals(enrolled);
    return {
      ...p,
      students: totals.students,
      mentors: new Set(
        pairings.filter((a) => a.programId === p.id).map((a) => a.mentorId)
      ).size,
      remaining: totals.remaining,
    };
  });

  const columns: Column[] = [
    { label: "Program" },
    { label: "Students", align: "right" },
    { label: "Mentors", align: "right" },
    { label: "Remaining", align: "right" },
  ];

  return (
    <div className="space-y-4">
      <PageTitle
        title="Inbox"
        subtitle={
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span>
              {count(programs.length, "program")} ·{" "}
              {count(overall.students, "student")} ·
            </span>
            <Figure
              size="inline"
              value={formatRough(overall.remaining)}
              tone={overall.remaining < 0 ? "danger" : "hours"}
            />
            <span>remaining</span>
          </span>
        }
      />

      {user.platformAdmin && <CreateProgramForm />}

      {/* One program is the whole scope, and a table of one row that repeats
          the line under the title is furniture. */}
      {programs.length > 1 && (
        <Section title="Programs">
          <Table columns={columns} framed={false}>
            {rows.map((p) => (
              <Tr key={p.id}>
                <Td label="Program">
                  {/* The name is the way in — the same rule as `/programs`,
                      which this table is the short version of. */}
                  <ProgramChip
                    program={p}
                    href={`/programs/${p.id}`}
                    className="min-h-11 font-medium sm:min-h-0"
                  />
                </Td>
                <Td label="Students" align="right" className="tabular-nums">
                  {p.students}
                </Td>
                <Td label="Mentors" align="right" className="tabular-nums">
                  {p.mentors}
                </Td>
                <Td label="Remaining" align="right">
                  <Figure
                    size="inline"
                    value={formatRough(p.remaining)}
                    tone={p.remaining < 0 ? "danger" : "hours"}
                    className="sm:text-right"
                  />
                </Td>
              </Tr>
            ))}
          </Table>
        </Section>
      )}
    </div>
  );
}
