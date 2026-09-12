"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * What a route shows when its render threw. The framework's own error page says
 * only that something went wrong; the point of this one is that the reader is
 * not stuck — they can retry the segment (most failures here are a database read
 * that can simply be tried again), or step back to a page that works.
 *
 * `digest` is printed deliberately: production errors reach the client stripped
 * of their message, and that hash is the only thing that ties what a person saw
 * to the line in the server log.
 */
export function ErrorState({
  error,
  retry,
  title = "This page didn’t load",
  home = "/",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  /** Where "back to safety" goes — the role's own home, where there is one. */
  home?: string;
}) {
  useEffect(() => {
    // The server log has the real error; this is what the browser can see of it.
    console.error(error);
  }, [error]);

  return (
    <div className="rise-in mx-auto max-w-lg py-10 text-center">
      <p className="text-[0.625rem] font-bold uppercase tracking-[0.08em] text-muted-fg">
        Something broke
      </p>
      <h1 className="mt-1.5 text-2xl font-bold text-ink">{title}</h1>
      <p className="mt-2 text-[0.9375rem] text-muted-fg">
        Nothing you did caused this, and nothing was lost. Most of the time it is
        a hiccup reading the data — try again first.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={retry}>Try again</Button>
        <Link
          href={home}
          className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-muted-fg transition-colors hover:bg-canvas hover:text-ink"
        >
          Back to safety
        </Link>
      </div>
      {error.digest && (
        <p className="mt-5 text-xs text-muted-fg">
          If it keeps happening, quote this code:{" "}
          <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink">
            {error.digest}
          </code>
        </p>
      )}
    </div>
  );
}
