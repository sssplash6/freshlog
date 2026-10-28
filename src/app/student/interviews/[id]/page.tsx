import { InterviewDetail } from "@/components/interviews/interview-detail";
import { requireInterviewViewer } from "@/lib/interview-viewer";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Interview" };

export default async function StudentInterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireInterviewViewer("student");
  const { id } = await params;
  return <InterviewDetail viewer={viewer} id={id} />;
}
