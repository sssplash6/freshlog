"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { cn } from "@/lib/cn";

/**
 * The wordmark, and its two secrets.
 *
 * Hover it and a sheen sweeps the letters once — light passing over, not a
 * colour change. Hold it for half a second and it copies the version: the
 * detail every bug report should open with and nobody can ever find. The
 * long-press does not navigate — a discovered secret is not a trap.
 */
export function BrandWordmark({
  version,
  className,
}: {
  version: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const holdTimer = useRef(0);
  const held = useRef(false);

  return (
    <span className={cn("relative shrink-0", className)}>
      <Link
        href="/"
        className="brand-sheen block shrink-0 text-base max-sm:-mx-2 max-sm:px-2 max-sm:py-3 font-bold tracking-tight text-brand"
        onPointerDown={() => {
          held.current = false;
          holdTimer.current = window.setTimeout(async () => {
            held.current = true;
            try {
              await navigator.clipboard.writeText(`freshlog v${version}`);
            } catch {
              // Clipboard denied — the pill still says the version, which was
              // the information anyway.
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }, 550);
        }}
        onPointerUp={() => window.clearTimeout(holdTimer.current)}
        onPointerLeave={() => window.clearTimeout(holdTimer.current)}
        onClick={(e) => {
          if (held.current) {
            e.preventDefault();
            held.current = false;
          }
        }}
      >
        freshlog
      </Link>
      {copied && (
        <span
          role="status"
          className="rise-in absolute left-0 top-full z-50 mt-1 whitespace-nowrap rounded-md bg-surface px-2 py-0.5 text-[0.6875rem] font-medium text-muted-fg shadow-sm"
        >
          v{version} · copied
        </span>
      )}
    </span>
  );
}
