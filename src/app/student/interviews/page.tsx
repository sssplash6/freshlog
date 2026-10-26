import { InterviewsHome } from "@/components/interviews/interviews-home";
import { requireInterviewViewer } from "@/lib/interview-viewer";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Interviews" };

export default async function StudentInterviewsHomePage() {
  const viewer = await requireInterviewViewer("student");
  return <InterviewsHome viewer={viewer} />;
}
