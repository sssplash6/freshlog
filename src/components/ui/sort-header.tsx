"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/cn";

/**
 * A column heading that is actually a control.
 *
 * The header row read as sortable — labelled columns above forty rows — and
 * was inert, which is the worst of both: it teaches the reader that clicking
 * does nothing, and it leaves "who runs out of time first" answerable only by
 * reading every line.
 *
 * A link rather than a button, for the same reason the filters are links: the
 * order lives in the URL, so it survives a refresh, it can be sent to somebody,
 * and the server does the sorting with no client state to fall out of step.
 * `scroll={false}` because re-ordering a table you are reading is not going
 * somewhere — see `TabLinks`.
 *
 * The arrow only appears on the column actually in force. A row of six arrows
 * says nothing about which one is doing the work; the ghost on hover is what
 * tells the other five they can be clicked.
 *
 * WHICH WAY A FIRST CLICK GOES IS THE COLUMN'S OWN. A name opens A to Z, and a
 * quantity opens at the top: nobody clicks "Completed" to find the student who
 * has had the least teaching, and making them click twice for the question
 * they asked is the kind of default that gets blamed on the table.
 */
export function SortHeader({
  sortKey,
  align,
  defaultDir = "asc",
  children,
}: {
  sortKey: string;
  align?: "right";
  /** Where a first click lands. `desc` for a figure, `asc` for a name. */
  defaultDir?: "asc" | "desc";
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const active = params.get("sort") === sortKey;
  const descending = active && params.get("dir") === "desc";

  const next = new URLSearchParams(params);
  next.set("sort", sortKey);
  // A first click sorts the column's own way; clicking the column already in
  // force turns it round.
  next.set(
    "dir",
    active ? (descending ? "asc" : "desc") : defaultDir
  );
  // A new order makes the old page number meaningless: row 21 of the old
  // ordering is not row 21 of this one.
  next.delete("page");

  return (
    <Link
      href={`${pathname}?${next.toString()}`}
      scroll={false}
      className={cn(
        "group inline-flex items-center gap-1 transition-colors hover:text-ink",
        active && "text-ink",
        align === "right" && "flex-row-reverse"
      )}
    >
      {children}
      <span
        aria-hidden="true"
        className={cn(
          "text-[0.5625rem] leading-none transition-opacity",
           active ? "opacity-100" : "opacity-40"
        )}
      >
        {descending ? "▼" : "▲"}
      </span>
      <span className="sr-only">
        {active
          ? descending
            ? ", sorted Z to A. Sort A to Z"
            : ", sorted A to Z. Sort Z to A"
          : ", sort by this column"}
      </span>
    </Link>
  );
}

/**
 * The `<th>` of a sortable column. `aria-sort` is a columnheader property, so
 * it lives here rather than on the link inside `SortHeader` (where it was
 * invalid). Pass `sortKey` for a sortable column; without one this is a plain
 * `<th>`.
 */
export function SortTh({
  sortKey,
  ...props
}: ComponentProps<"th"> & { sortKey?: string }) {
  const params = useSearchParams();
  const active = sortKey != null && params.get("sort") === sortKey;
  const sort = sortKey == null
    ? undefined
    : active
      ? params.get("dir") === "desc"
        ? "descending"
        : "ascending"
      : "none";
  return <th aria-sort={sort} {...props} />;
}
