import { RequiredMark } from "@/components/ui/required-mark";
import { cn } from "@/lib/cn";

/**
 * `Field`'s look for the controls a `<label>` must not wrap: `Select` and
 * `DateField` open on a button, and a label around one toggles it on every
 * click inside the field.
 */
export function Labelled({
  label,
  required,
  className,
  children,
}: {
  label: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <span className="block text-sm font-medium text-ink">
        {label}
        {required && <RequiredMark />}
      </span>
      {children}
    </div>
  );
}
