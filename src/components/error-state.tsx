"use client";

import Link from "next/link";
import { useEffect } from "react";

import { StandaloneCard } from "@/components/standalone-card";
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
  /** Where "Home" goes — the role's own home, where there is one. */
  home?: string;
}) {
  useEffect(() => {
    // The server log has the real error; this is what the browser can see of it.
    console.error(error);
  }, [error]);

  return (
    <StandaloneCard title={title} line="Nothing was lost." className="rise-in mx-auto">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={retry}>Try again</Button>
        <Link
          href={home}
          transitionTypes={["nav-back"]}
          className={buttonClasses("ghost")}
        >
          Home
        </Link>
      </div>
      {error.digest && (
        <p className="mt-5 text-xs text-muted-fg">
          Error code{" "}
          <code className="rounded-md bg-fill px-1.5 py-0.5 font-mono text-caption text-ink">
            {error.digest}
          </code>
        </p>
      )}
    </StandaloneCard>
  );
}
