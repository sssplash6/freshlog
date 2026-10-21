"use client";

import { openScreenReport } from "@/components/screen-report/screen-report-host";
import { usePopoverClose } from "@/components/ui/popover";

/**
 * "Report a bug" in the account menu: closes the menu, then captures the page
 * it was pressed on and opens the drawing overlay over it. The menu must be
 * gone first or it would be in the picture — the host waits for the paint.
 *
 * It used to navigate to /bugs/new?from=<path>. That form is still there,
 * from the Report a bug button on /bugs, for a report with no picture of
 * this page.
 */
export function ReportBugButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const close = usePopoverClose();
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        close?.();
        openScreenReport();
      }}
    >
      {children}
    </button>
  );
}
