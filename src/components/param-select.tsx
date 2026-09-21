"use client";

import { useRouter } from "next/navigation";

import { Select, type SelectOption } from "@/components/select";

/**
 * A select whose answer is a URL.
 *
 * For the question a page cannot answer any other way: pick a student and
 * everything under it — their programs, their mentors, their open tasks, what
 * they hold — has to be fetched before the next field can be drawn. A control
 * that changed only a label would be offering one person's name over another
 * person's figures.
 *
 * `replace`, not `push`: choosing again is correcting the same answer, not a
 * step forward, and a back button that walks through five names nobody meant
 * to visit is worse than one that leaves the page.
 */
export function ParamSelect({
  param,
  value = "",
  options,
  label,
  placeholder,
  recentKey,
  /** Params that were answers about the old value and cannot outlive it. */
  clears = [],
}: {
  param: string;
  value?: string;
  options: SelectOption[];
  label: string;
  placeholder?: string;
  recentKey?: string;
  clears?: readonly string[];
}) {
  const router = useRouter();
  return (
    <div className="block min-w-0 text-sm">
      <span className="mb-0.5 block text-muted-fg">{label}</span>
      <Select
        name={param}
        ariaLabel={label}
        defaultValue={value}
        placeholder={placeholder}
        // Always: the lists this is used for are people, and a name is what
        // the reader arrives already knowing.
        searchable
        recentKey={recentKey}
        options={options}
        onChange={(next) => {
          const url = new URL(window.location.href);
          if (next) url.searchParams.set(param, next);
          else url.searchParams.delete(param);
          for (const stale of clears) url.searchParams.delete(stale);
          router.replace(`${url.pathname}${url.search}`);
        }}
      />
    </div>
  );
}
