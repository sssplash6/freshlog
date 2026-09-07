/**
 * Route fallback: a quiet stack of pulsing blocks roughly matching a page's
 * shape (eyebrow, title, subtitle, then cards). Calm grey, no spinners.
 *
 * The blocks are decoration and stay hidden from assistive tech — but "hidden"
 * was all a screen reader got: silence, with no way to tell a slow page from a
 * finished empty one. The live status says once, out loud, what the pulse says
 * visually.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <p role="status" aria-live="polite" className="sr-only">
        Loading…
      </p>
      <div className="animate-pulse" aria-hidden="true">
        <div className="h-3 w-28 rounded bg-line" />
        <div className="mt-2 h-7 w-56 rounded bg-line" />
        <div className="mt-2 h-4 w-72 rounded bg-line/70" />
        <div className="mt-8 flex flex-col gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-xl border border-line bg-surface shadow-sm p-5">
              <div className="h-4 w-2/3 rounded bg-line" />
              <div className="mt-3 h-3 w-1/3 rounded bg-line/70" />
              <div className="mt-4 h-2.5 w-full rounded-full bg-line" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
