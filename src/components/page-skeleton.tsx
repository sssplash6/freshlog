/**
 * A page's shape while the real one loads: eyebrow, title, subtitle, cards.
 *
 * Two consumers, two different jobs. `app/loading.tsx` paints it full-screen
 * for the shell-less routes (login, onboarding), where it has to centre
 * itself. The per-section `loading.tsx` files render it INSIDE AppShell's
 * `<main>` — a cold navigation then swaps only the page, not the chrome:
 * the top bar and tab bar hold still while the skeleton slides in, which is
 * the difference between an app fetching a screen and a website repainting.
 *
 * The blocks are decoration and stay hidden from assistive tech — the live
 * status beside them says once, out loud, what the pulse says visually.
 */
export function PageSkeleton() {
  return (
    <>
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
    </>
  );
}
