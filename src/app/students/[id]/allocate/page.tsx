import { notFound, redirect } from "next/navigation";

import { canAdministerStudent } from "@/lib/authz";
import { requireUser } from "@/lib/dal";
import { readParam, type SearchParams } from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Allocate time" };

/**
 * The old address of the grant form, kept for links already sent. The form
 * opens in place on the student's page now (DESIGN.md K3), so this sends the
 * reader there with it open — after the same gate, so a student the reader
 * may not grant to still reads as one who does not exist.
 */
export default async function AllocateStudentTimePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireUser();
  const { id } = await params;
  const from = readParam(await searchParams, "from");
  const profile = await prisma.studentProfile.findUnique({
    where: { id },
    include: {
      user: true,
      enrollments: {
        include: { program: true, cohort: true, level: true },
        orderBy: { program: { name: "asc" } },
      },
    },
  });
  // A form, not a record: a read-only grant (LEADER, SALES) has nothing to do
  // here, so the gate asks the write scope.
  if (!profile || !(await canAdministerStudent(me, profile))) notFound();

  redirect(`/students/${profile.id}?allocate=1${from ? `&from=${encodeURIComponent(from)}` : ""}`);
}
