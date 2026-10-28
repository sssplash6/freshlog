import { InterviewsHome } from "@/components/interviews/interviews-home";
import { requireInterviewViewer } from "@/lib/interview-viewer";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Interviews" };

export default async function MentorInterviewsHomePage() {
  const viewer = await requireInterviewViewer("mentor");
  return <InterviewsHome viewer={viewer} />;
}
