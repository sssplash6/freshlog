"use client";

import { useRef, useState } from "react";

import { CheckIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * A value that copies itself when clicked — an email address, mostly. It reads
 * as the text it is, not as a button, and says "Copied" in place for a moment
 * so the click is not a leap of faith.
 */
export function CopyText({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  return (
    <button
      type="button"
      title={`Copy ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // Clipboard denied — the value is still on screen to select by hand.
          return;
        }
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1400);
      }}
      className={cn(
        "inline cursor-copy rounded-sm text-left underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand",
        className
      )}
    >
      {value}
      <span aria-live="polite" className={cn("ml-1.5 font-semibold text-brand", !copied && "sr-only")}>
        {copied && (
          <>
            <CheckIcon className="mr-0.5 inline h-3.5 w-3.5 align-[-2px]" />
            Copied
          </>
        )}
      </span>
    </button>
  );
}
