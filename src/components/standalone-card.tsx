import { cn } from "@/lib/cn";

/**
 * The card a reader lands on with no app around it: sign-in, a 404, an error,
 * an unsubscribe. One wordmark, one padding and one shadow for all four, so
 * they read as one family.
 */
export function StandaloneCard({
  title,
  line,
  children,
  className,
}: {
  title: React.ReactNode;
  /** At most one short line under the title. */
  line?: React.ReactNode;
  /** The action, or the form. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full max-w-md rounded-2xl bg-surface p-6 text-center shadow-sm sm:p-8",
        className
      )}
    >
      <div className="text-title font-bold tracking-tight text-brand">freshlog</div>
      <h1 className="mt-4 text-figure-lg font-bold leading-tight tracking-[-0.01em] text-ink">
        {title}
      </h1>
      {line && <p className="mt-2 text-body text-muted-fg">{line}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
