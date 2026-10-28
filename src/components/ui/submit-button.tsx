"use client";

import { useFormStatus } from "react-dom";

import {
  buttonClasses,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/ui/button";
import { cn } from "@/lib/cn";

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("animate-spin", className)}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Submit button that reads its form's pending state via useFormStatus, so any
 * server-action form gets a spinner + disabled state for free. Must live
 * inside the <form> it submits.
 */
export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  disabled = false,
  pending: pendingProp,
}: {
  children: React.ReactNode;
  pendingText?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Off before there is anything the submit could succeed with. */
  disabled?: boolean;
  /** For a form submitted by its own handler, which `useFormStatus` cannot see. */
  pending?: boolean;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={buttonClasses(variant, size, className)}
    >
      {pending && <Spinner className="h-4 w-4" />}
      {pending ? (pendingText ?? children) : children}
    </button>
  );
}
