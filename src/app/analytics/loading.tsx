import { PageSkeleton } from "@/components/page-skeleton";

/** Analytics arrives as a stat card and a chart, which is what it is. */
export default function Loading() {
  return <PageSkeleton variant="dashboard" />;
}
