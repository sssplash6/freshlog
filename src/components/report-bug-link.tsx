"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * "Report a bug", carrying the page it was pressed on. The server decides
 * whether the path is one of ours (`sanitizePagePath`); this only supplies it.
 * From inside /bugs the page would just be the bug pages, so it sends nothing.
 */
export function ReportBugLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const href = pathname.startsWith("/bugs")
    ? "/bugs/new"
    : `/bugs/new?from=${encodeURIComponent(pathname)}`;
  return (
    <Link href={href} transitionTypes={["nav-forward"]} className={className}>
      {children}
    </Link>
  );
}
