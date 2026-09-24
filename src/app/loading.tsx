import { PageSkeleton } from "@/components/page-skeleton";

/**
 * Route fallback for the routes with no section boundary of their own —
 * the public-shell pages. Sections get theirs inside the chrome via the
 * `loading.tsx` in each section directory.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <PageSkeleton />
    </div>
  );
}
