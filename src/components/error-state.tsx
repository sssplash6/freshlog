"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button, buttonClasses } from "@/components/ui/button";

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
    // One centred card, like every other page a reader lands on with nothing
    // else around it — sign in, a 404, an unsubscribe.
    <div className="rise-in mx-auto w-full max-w-md rounded-2xl bg-surface px-6 py-8 text-center shadow-sm">
      <p className="text-[0.8125rem] font-medium text-muted-fg">
        Something broke
      </p>
      <h1 className="mt-1 text-[1.5rem] font-bold leading-tight tracking-[-0.01em] text-ink">
        {title}
      </h1>
      <p className="mt-2 text-[0.9375rem] text-muted-fg">
        Nothing you did caused this, and nothing was lost. Most of the time it is
        a hiccup reading the data — try again first.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={retry}>Try again</Button>
        <Link
          href={home}
          transitionTypes={["nav-back"]}
          className={buttonClasses("ghost")}
        >
          Back to safety
        </Link>
      </div>
      {error.digest && (
        <p className="mt-5 text-[0.8125rem] text-muted-fg">
          If it keeps happening, quote this code:{" "}
          <code className="rounded bg-fill px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink">
            {error.digest}
          </code>
        </p>
      )}
    </div>
  );
}
