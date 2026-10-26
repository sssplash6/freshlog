import { InterviewPerson } from "@/components/interviews/interview-person";
import { requireInterviewViewer } from "@/lib/interview-viewer";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Interview partner" };

export default async function StudentInterviewPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireInterviewViewer("student");
  const { id } = await params;
  return <InterviewPerson viewer={viewer} id={id} />;
}
