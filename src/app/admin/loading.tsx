import { PageSkeleton } from "@/components/page-skeleton";

/**
 * This section's fallback — rendered INSIDE the shell's <main>, not over the
 * whole window. On a cold navigation the top bar and tab bar hold still and
 * only the page swaps, which is the difference between an app fetching a
 * screen and a site repainting. The app-root loading.tsx is kept for the
 * routes that have no shell at all.
 */
export default function Loading() {
  return <PageSkeleton variant="home" />;
}
