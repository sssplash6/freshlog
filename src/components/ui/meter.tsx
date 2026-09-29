"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

/**
 * A thin progress meter whose fill grows in from zero once, on mount. Orange
 * is hours/progress; red marks an overdrawn balance. The grow is a one-time
 * explanatory beat that draws the eye to the proportion, not a celebration.
 * Reduced-motion collapses it to an instant set (globals kills the duration).
 */
const SIZE = { sm: "h-1", md: "h-1.5" } as const;

export function Meter({
  pct,
  tone = "accent",
  size = "md",
  className,
  ariaLabel,
  ariaValueNow,
  ariaValueMax,
}: {
  pct: number;
  tone?: "accent" | "danger";
  size?: keyof typeof SIZE;
  className?: string;
  ariaLabel?: string;
  ariaValueNow?: number;
  ariaValueMax?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const clamped = Math.max(0, Math.min(100, pct));

  return (
    <div
      className={cn(
        SIZE[size],
        "w-full overflow-hidden rounded-full bg-fill",
        className,
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={ariaValueMax}
      aria-valuenow={ariaValueNow}
      aria-label={ariaLabel}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]",
          tone === "danger" ? "bg-danger" : "bg-accent",
        )}
        style={{ width: mounted ? `${clamped}%` : "0%" }}
      />
    </div>
  );
}
