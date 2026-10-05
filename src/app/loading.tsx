import { PageSkeleton } from "@/components/page-skeleton";

/**
 * Route fallback for the routes with no section boundary of their own —
 * the public-shell pages. Sections get theirs inside the chrome via the
 * `loading.tsx` in each section directory.
 */
export default function Loading() {
  return (
    // The shell's own measure (max-w-6xl), so the content does not change
    // width when the real page replaces this one.
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <PageSkeleton />
    </div>
  );
}
