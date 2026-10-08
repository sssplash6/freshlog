"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

import { Tr } from "@/components/ui/table";
import { cn } from "@/lib/cn";

/**
 * A table row that opens `href` from anywhere on it.
 *
 * It was a link in the last cell stretched over the row with `::after
 * { position: absolute; inset: 0 }` and `position: relative` on the `<tr>`.
 * Safari does not make a table row the containing block for that overlay, so
 * every row's overlay covered the whole table and the last one, painted on
 * top, took every click: a mentor clicking any student opened the bottom one.
 *
 * The row still holds a real link (the name, the chevron) for the keyboard,
 * screen readers and "open in new tab"; this only answers the clicks that
 * land between them.
 */
export function LinkRow({
  href,
  transitionTypes,
  className,
  onClick,
  ...props
}: ComponentProps<"tr"> & { href: string; transitionTypes?: string[] }) {
  const router = useRouter();

  function open(event: MouseEvent<HTMLTableRowElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    // A link, button or field inside the row answers its own click.
    if ((event.target as Element).closest("a, button, input, select, textarea, label")) return;
    // Dragging across a name to copy it is not a request to leave the page.
    if (window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      window.open(href, "_blank", "noopener");
      return;
    }
    router.push(href, { transitionTypes });
  }

  return <Tr {...props} onClick={open} className={cn("cursor-pointer", className)} />;
}
