import { InterviewLive } from "@/components/interviews/interview-live";
import { requireInterviewViewer } from "@/lib/interview-viewer";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Live interview" };

export default async function StudentInterviewLivePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireInterviewViewer("student");
  const { id } = await params;
  return <InterviewLive viewer={viewer} id={id} />;
}
