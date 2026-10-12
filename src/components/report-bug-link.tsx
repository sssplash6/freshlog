"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A bug link carrying the page it was pressed on. The server decides whether
 * the path is one of ours (`sanitizePagePath`); this only supplies it. From
 * inside /bugs the page would just be the bug pages, so it sends nothing.
 *
 * `to="/bugs"` is the shell's one bug link: the list, whose Report button
 * passes `from` on to the form.
 */
export function ReportBugLink({
  to = "/bugs/new",
  className,
  children,
}: {
  to?: "/bugs" | "/bugs/new";
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const href = pathname.startsWith("/bugs")
    ? to
    : `${to}?from=${encodeURIComponent(pathname)}`;
  return (
    <Link href={href} transitionTypes={["nav-forward"]} className={className}>
      {children}
    </Link>
  );
}
