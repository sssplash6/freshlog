import type { NextConfig } from "next";

/**
 * One old address and the role-neutral one that replaces it.
 *
 * `why` is the reason the pair exists at all, and it is required: a redirect
 * whose reason nobody can state is a redirect nobody dares delete, which is how
 * a temporary map becomes a second sitemap.
 */
type Move = { from: string; to: string; why: string };

/**
 * Old routes, kept alive while links to them are still in the wild.
 *
 * The reorganisation gives every entity one role-neutral address —
 * /admin/students/[id] and /mentor/students/[id] become /students/[id], the
 * /leader and /sales trees fold into /programs/[id] — and there are two kinds
 * of link that cannot be edited to match: bookmarks in ten people's browsers,
 * and the `href` already stored on hundreds of `Notification` rows.
 *
 * Stored hrefs are NEVER rewritten. A notification is a record of what was said
 * at the time, and a migration that edits its link edits history; /n/[id]
 * resolves an old row to wherever its subject lives now (`neutralHref` in
 * src/lib/notify.ts) instead. This map covers the bookmarks.
 *
 * A ROW MAY ONLY BE ADDED BY THE COMMIT THAT BUILDS ITS DESTINATION, and that
 * commit must also delete any seed page standing at the destination. Both
 * halves matter:
 *
 *   - /students/[id] and /programs/[id] exist today as SEEDS that redirect the
 *     other way, to whichever role-scoped page the reader is entitled to, so
 *     that src/lib/status.ts can link at one address without knowing who is
 *     reading. Adding `/admin/students/:id → /students/:id` while that seed
 *     stands makes the pair bounce between each other forever — and every
 *     attention row on all three homes already points at the neutral address,
 *     so it would be every home, not an edge case.
 *   - The rest of the destinations below are not routes yet. A 308 to a 404 is
 *     worse than the old page still answering.
 *
 * The list is kept here, unlisted, so the commit that moves each route can see
 * what it owes. Waiting on the commit that builds the destination:
 *
 *
 * `:id` matches ONE segment, so `/admin/programs/:id` will not swallow
 * `/admin/programs/x/settings` — each nested route needs its own row.
 *
 * A row's destination must be a LIVE address, never another row's source. Two
 * rows here pointed at /admin/students after that address had itself become a
 * redirect, which costs every follower a second round trip and breaks the day
 * the first row is deleted.
 *
 * The whole map is deleted one released version after the last row lands; the
 * deletion is a listed commit, not a someday.
 */
const MOVED: Move[] = [
  {
    from: "/admin/mentors",
    to: "/mentors",
    why: "A mentor is an entity, not an admin section.",
  },
  {
    from: "/admin/mentors/:id",
    to: "/mentors/:id",
    why: "The three views of one mentor, at the address the rest of the app links to.",
  },
  {
    from: "/admin/programs/:id",
    to: "/programs/:id",
    why: "A program is an entity, not an admin section. Its seed page went in the same change.",
  },
  {
    from: "/admin/programs/:id/students",
    to: "/programs/:id/students",
    why: "Same move; :id matches one segment, so each nested route needs its own row.",
  },
  {
    from: "/admin/programs/:id/settings",
    to: "/programs/:id/settings",
    why: "Same move — the gear the owner asked for.",
  },
  {
    from: "/mentor/onboarding",
    to: "/onboarding",
    why: "One door for every first sign-in; the branch comes from the reader's record, not the URL.",
  },
  {
    from: "/student/onboarding",
    to: "/onboarding",
    why: "Same door, which also gained the approval step that used to wall off /student.",
  },
  {
    from: "/admin/feedback",
    to: "/feedback",
    why: "One feedback page for everyone; the staff half narrows to the reader's grants.",
  },
  {
    from: "/mentor/feedback",
    to: "/feedback",
    why: "The mentor's own ratings, at the same address, and still anonymous.",
  },
  {
    from: "/mentor/sessions",
    to: "/sessions",
    why: "One mentor's log lived at an address that says 'one mentor' about a page the whole school reads.",
  },
  {
    from: "/admin/students/:id",
    to: "/students/:id",
    why: "One student, one address. The two pages disagreed about the same ledger.",
  },
  {
    from: "/mentor/students/:id",
    to: "/students/:id",
    why: "The mentor's half of that same page; the workspace renders the union of the viewer's rights.",
  },
  {
    from: "/admin/students",
    to: "/students",
    why: "The roster, at one address: an admin's list of everybody and a mentor's list of their own were one query written twice.",
  },
  // The two scoped roles had their own copies of three lists. What made them
  // separate trees was that scope lived in `User.programId` — one program, set
  // by a seed — so a leader could not be given a second one and an admin could
  // not be given only one. Scope is a grant now, the admin pages narrow to it,
  // and the copies had nothing left to be.
  {
    from: "/leader",
    to: "/admin",
    why: "DEPT_LEADER's dashboard; the inbox narrows to their grants.",
  },
  {
    from: "/leader/students",
    to: "/students",
    why: "DEPT_LEADER's roster; the students list narrows to their grants.",
  },
  {
    from: "/leader/feedback",
    to: "/feedback",
    why: "DEPT_LEADER's ratings; the feedback page narrows to their grants.",
  },
  { from: "/sales", to: "/admin", why: "SALES' dashboard, same as above." },
  {
    from: "/sales/students",
    to: "/students",
    why: "SALES' roster, same as above.",
  },
];

const nextConfig: NextConfig = {
  // A stray lockfile exists in the home directory; pin the workspace root.
  turbopack: { root: __dirname },

  experimental: {
    /*
     * Route navigations become React transitions, which is what lets
     * `PageTransition` slide pages in and out instead of cutting — the one
     * gesture every native app has and every web page lacks.
     */
    viewTransition: true,
    /*
     * Let the client router reuse a page it fetched up to 30s ago. The
     * default is 0, so every navigation — including a back-swipe to a list
     * the reader just left — waits on a server round trip, and the pop
     * transition cannot start until the response lands. A native app shows
     * the cached screen instantly; a pull-to-refresh is the reader's way to
     * ask for newer. Half a minute is short enough that a stale balance
     * corrects itself on the next nav, and `router.refresh()` (pull to
     * refresh, toast actions) always bypasses the cache.
     */
    staleTimes: { dynamic: 30 },
    /**
     * Every hostname this app is reachable on.
     *
     * A server action is a POST, and Next refuses one whose `Origin` does not
     * match the `Host` it arrived at — a CSRF check, and a silent one: the
     * action never runs and the form renders nothing, which the mentor reads
     * as the button not working.
     *
     * Three hostnames serve this app. `freshlog.net` redirects to `www` with a
     * 307, which preserves the method AND the original `Origin`, so a POST
     * that starts at the apex arrives at `www` carrying an `Origin` that no
     * longer matches — exactly the mismatch above. The `.onrender.com` address
     * still answers as well, and people do have it bookmarked.
     *
     * Listing them is not a widening of trust: they are the same deployment,
     * and the check exists to reject OTHER sites posting here.
     */
    serverActions: {
      allowedOrigins: [
        "www.freshlog.net",
        "freshlog.net",
        "freshform-srma.onrender.com",
      ],
    },
  },

  async redirects() {
    // 308, not 307: these addresses are gone for good, and a browser that
    // caches the move stops asking. That is also why a row cannot land early —
    // a mistake here is cached in ten people's browsers, not just served once.
    return MOVED.map(({ from, to }) => ({
      source: from,
      destination: to,
      permanent: true,
    }));
  },
};

export default nextConfig;
