"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/field";

/** How long the typing has to stop before the list re-reads itself. */
const SETTLE_MS = 125;

/**
 * The search box, filtering as it is typed.
 *
 * It used to take a word and wait: the list stayed wrong until somebody found
 * the button, and on a phone that button is behind the keyboard. Now an eighth
 * of a second's pause writes `?q=` and the server re-renders the list
 * underneath — the same URL the button wrote, so a search is still a link a
 * person can send, the back button still steps through the searches, and
 * nothing is filtered in the browser over rows it already has.
 *
 * THE BOX OWNS ITS TEXT, and that is the whole reason this is a client
 * component. Everything else in the filter bar is uncontrolled and remounted
 * when the URL disagrees with it — which is how "Reset" used to clear the
 * query string and leave the word sitting in the field. A box that rewrites
 * the URL as you type cannot be remounted on every keystroke without losing
 * the cursor, so it keeps the value in state and follows the URL when the URL
 * moves on its own: Reset, a preset chip, the back button.
 *
 * `router.replace`, never `push`: eight keystrokes are one search, not eight
 * history entries to walk back through.
 */
export function SearchField({
  basePath,
  name = "q",
  label,
  placeholder,
}: {
  /** The list's own path — every search lands back on page one of it. */
  basePath: string;
  name?: string;
  /** Read to a screen reader; the placeholder says it to everyone else. */
  label: string;
  placeholder: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const fromUrl = params.get(name) ?? "";

  const [value, setValue] = useState(fromUrl);
  // Follow the URL when it moves without us. Compared during render rather
  // than in an effect: an effect would paint the stale word once before
  // clearing it, and `setState` in an effect body is the cascade the React
  // lint rule warns about.
  const [seen, setSeen] = useState(fromUrl);
  if (fromUrl !== seen) {
    setSeen(fromUrl);
    setValue(fromUrl);
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const search = (next: string) => {
    const query = new URLSearchParams(params);
    if (next) query.set(name, next);
    else query.delete(name);
    // A new search is a new list, so page four of the old one is meaningless.
    query.delete("page");
    const suffix = query.toString();
    router.replace(`${basePath}${suffix ? `?${suffix}` : ""}`, {
      scroll: false,
    });
  };

  return (
    <label className="min-w-0 flex-1">
      {/*
        The caption is for a screen reader only. "Find a student" above a box
        already placeholdered "Name or email" is the same sentence twice and a
        line of height on the one row that is never folded away; the magnifier
        beside it and the placeholder say what the box is, and the label still
        names it to anyone listening.
      */}
      <span className="sr-only">{label}</span>
      <Input
        type="search"
        name={name}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => search(next), SETTLE_MS);
        }}
        // Enter submits the form around it, which is the same URL without the
        // wait — and the path that still works with no JavaScript at all.
        onKeyDown={(e) => {
          if (e.key === "Enter" && timer.current) clearTimeout(timer.current);
        }}
      />
    </label>
  );
}
