import { PageSkeleton } from "@/components/page-skeleton";

/** A person's page arrives as a person's page: avatar, name, figures, groups. */
export default function Loading() {
  return <PageSkeleton variant="detail" />;
}
