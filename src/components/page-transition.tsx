import { ViewTransition } from "react";

/**
 * Pages push and pop instead of cutting.
 *
 * A hard swap is the one thing every website does and no native app does:
 * on iOS a drill-in slides the new page in from the right over the old, and
 * coming back slides it off to the right again. With
 * `experimental.viewTransition` on, route navigations are React transitions,
 * so this boundary animates whenever its content swaps — `enter`/`exit` when
 * the section (and the shell around it) changes, `update` when only the page
 * inside a shared layout does.
 *
 * The direction comes from the link that was tapped: links that drill in
 * carry `transitionTypes={["nav-forward"]}` (rows, chips, `ArrowLink`,
 * `LinkButton`) and `PageTitle`'s back row carries `["nav-back"]`. Untyped
 * navigations — tab switches, filters, pagination, search — get `vt-fade`,
 * a fast crossfade: a directional slide on a tab tap would lie about where
 * you went.
 *
 * The animation classes live in globals.css, and the chrome (top bar, tab
 * bar, rail) is named there too so it holds still while the page moves.
 * `share="none"`: nothing on these pages morphs into anything else.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    // One name across every shell, so a cross-section navigation — where the
    // old shell's boundary exits and the new shell's enters — pairs the two
    // captures into a single group and the leaving page can fly over the
    // arriving one instead of hoping the paint order agrees.
    <ViewTransition
      name="page"
      enter={{
        "nav-forward": "vt-fwd",
        "nav-back": "vt-back",
        default: "vt-fade",
      }}
      exit={{
        "nav-forward": "vt-fwd",
        "nav-back": "vt-back",
        default: "vt-fade",
      }}
      update={{
        "nav-forward": "vt-fwd",
        "nav-back": "vt-back",
        // In-place updates — a search keystroke's router.replace, a page or
        // filter param, a suspense reveal — swap without ceremony. A fade
        // here would shimmer on every pause in the search box.
        default: "none",
      }}
      share="none"
    >
      {children}
    </ViewTransition>
  );
}
