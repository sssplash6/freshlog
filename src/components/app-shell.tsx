import Link from "next/link";
import { Suspense } from "react";

import pkg from "../../package.json";
import { Avatar } from "@/components/avatar";
import { BrandWordmark } from "@/components/brand-wordmark";
import {
  CommandPalette,
  CommandPaletteButton,
} from "@/components/command-palette";
import {
  AlertIcon,
  ChevronDownIcon,
  CrownIcon,
  GearIcon,
  InboxIcon,
  LogOutIcon,
  SparklesIcon,
  UserIcon,
} from "@/components/icons";
import { NavCount, NavLinks } from "@/components/nav-links";
import {
  NotificationBell as NotificationMenu,
  type BellNotification,
} from "@/components/notification-bell";
import {
  ProfileShortcut,
  ProfileSwitch,
  ProfileSwitchMenu,
} from "@/components/profile-switch";
import { PublicShell } from "@/components/public-shell";
import { ProgramDot } from "@/components/program-chip";
import { ReportBugLink } from "@/components/report-bug-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { DensityToggle } from "@/components/density-toggle";
import { Sidebar } from "@/components/sidebar";
import { TabBar } from "@/components/tab-bar";
import { PageTransition } from "@/components/page-transition";
import { NativeGestures } from "@/components/native-gestures";
import { PhoneChrome } from "@/components/phone-chrome";
import { Popover } from "@/components/ui/popover";
import { signOut } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { attentionFor } from "@/lib/attention";
import { adminScope, scopeIsEmpty } from "@/lib/authz";
import { hasUnseenChangelog, readChangelog } from "@/lib/changelog";
import { canActAsMentor, ROLES, USER_STATUS } from "@/lib/constants";
import { navFor, type NavItem } from "@/lib/nav";
import { prisma } from "@/lib/prisma";
import { canSwitchProfile, profileOf, type Profile } from "@/lib/profile";
import { spaceOf, type Space } from "@/lib/space";
import { summarizeUnread, unreadLabel, type UnreadSummary } from "@/lib/unread";
import type { User } from "@/generated/prisma/client";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

/**
 * The bell, and everything behind it.
 *
 * It used to point at the reader's own home plus `#notifications`, because the
 * feed was rendered there. Both halves of it — the active issues, and what has
 * happened — live at `/notifications` now and nowhere else, so the bell points
 * at the page it is named after.
 *
 * 44px, up from 40. The smallest reliable touch target, and this is the only
 * control in the phone chrome that was under it.
 *
 * A plain glyph in a nav bar, the way iOS draws a bar button: no circle, no
 * ring, no tinted disc on hover — just the grey fill a pressed control shows.
 * The ring it wore made the bell the one bordered object in a borderless bar.
 *
 * The count is brand blue: unread notifications are not a problem, and red is
 * spent here on hours that are gone and balances that are negative. It appears
 * only below `lg` — at desktop widths the sidebar's Notifications row carries
 * the same number, and stating it twice on one screen is the "remaining is
 * never said twice" rule applied to the chrome.
 */
function NotificationBell({ unread }: { unread: UnreadSummary }) {
  const count = unread.total;
  return (
    <Link
      href="/notifications"
      aria-label={unreadLabel(unread)}
      /* shrink-0 is load-bearing, and was measured: as a flex item beside the
         wordmark and the account button, the 44px box shrank to 27px wide at
         390px — the target this commit widened, quietly given back. */
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink/80 transition-colors hover:bg-fill hover:text-ink active:bg-fill-strong"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-[1.375rem] w-[1.375rem]"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
        />
      </svg>
      {/* The rail's bell draws its count with `NavCount`, and so does this
          one: it was a hand-made 16px badge here and the 20px one there, so
          the same number changed size when the window crossed `lg`. */}
      {count > 0 && (
        <span className="absolute right-0 top-0.5">
          <NavCount count={count} />
        </span>
      )}
    </Link>
  );
}

/**
 * "What's new", in the corner beside the bell.
 *
 * It lived only in the account menu, one open-and-scan away, so a change that
 * shipped was found by whoever happened to look. The corner is where the page's
 * two "something for you" signals already sit; this is the quieter of the two —
 * a blue dot, never a count, because an update is not a task.
 *
 * The same `/changelog` row stays in the account menu, which is the only place
 * the phone chrome reaches it from.
 */
function WhatsNewLink({ unseen }: { unseen: boolean }) {
  return (
    <Link
      href="/changelog"
      transitionTypes={["nav-forward"]}
      className="relative flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-fg transition hover:bg-fill hover:text-ink"
    >
      <SparklesIcon className="h-4 w-4" />
      {"What's new"}
      {unseen && (
        <>
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-brand"
          />
          <span className="sr-only">(unread updates)</span>
        </>
      )}
    </Link>
  );
}

/** One row of the account menu, and the icon column every row shares. */
const MENU_ROW =
  "flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-body text-ink transition-colors hover:bg-fill";
const MENU_ICON = "h-4 w-4 shrink-0 text-muted-fg";

/**
 * Identity and the things that are about you rather than about the school.
 *
 * A real `Popover`, not the hand-styled `<details>` this replaces: that one
 * never closed on Escape, never closed when you clicked the page behind it, and
 * left focus on an unmounted node — see the note at the top of `ui/popover.tsx`,
 * which was written about these two menus.
 *
 * §4.1 puts Settings, Platform and Help in here. Help is not a route yet, and
 * a menu item that 404s is worse than one that is missing. Platform shows only
 * for the people it opens for — the page itself 404s for everyone else, which
 * is the right answer twice.
 */
function AccountMenu({
  user,
  lens,
  mentorProfile,
  whatsNew,
  named = true,
}: {
  user: User;
  /**
   * Print the name beside the avatar from `lg` up. The staff rail has the
   * width for it; the student's top bar does not — a 2xl bar holding the
   * wordmark, four links and a full name ran out of room at any name longer
   * than about fifteen letters, and the wordmark was squeezed under "Home".
   * The menu's own header names them either way.
   */
  named?: boolean;
  /** The lens to show as active, or null for somebody who has only one. */
  lens: Profile | null;
  /** Where a mentor edits their own name, picture and booking link, until /settings. */
  mentorProfile: boolean;
  /** The changelog has an entry this person has not opened. */
  whatsNew: boolean;
}) {
  const label = user.name ?? user.email;
  // A student's menu is about them, not about running the product: no bug
  // queue (a staff tool), and no second "What's new" mark on the avatar
  // beside the bell's count — one notification mark in a top bar, not two.
  const student = user.role === ROLES.STUDENT;

  return (
    <Popover
      label={whatsNew ? "Account (new updates)" : "Account"}
      origin="end"
      width="sm"
      // The brand focus ring every other control wears (DESIGN.md: brand is
      // for focus) — the trigger fell back to the browser's near-black one.
      triggerClassName="group flex h-11 w-full cursor-pointer items-center gap-2 rounded-lg pl-1 pr-2 transition-colors hover:bg-fill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      trigger={
        <>
          <span className="relative shrink-0">
            {/* The same circle you are everywhere else — two initials in your
                identity colour, or your picture. It was a brand-blue disc with
                ONE letter, so the chrome said "A" while Settings, the rosters
                and every session row said "AT" in green: two faces for one
                person, on the same screen. */}
            <Avatar person={user} className="h-8 w-8 shrink-0 text-xs" />
            {/* Blue, not red: red is spent on hours that are gone. The bell
                owns the corner's count; this is only "something to read".
                Staff below `lg` only — from `lg` the corner pill carries the
                same dot beside its own words, and a student's bar already has
                the bell's badge one icon over. */}
            {whatsNew && !student && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-surface lg:hidden"
              />
            )}
          </span>
          {named && (
            <>
              <span className="hidden min-w-0 flex-1 truncate text-left text-body font-medium text-ink lg:inline">
                {label}
              </span>
              <ChevronDownIcon className="hidden h-4 w-4 shrink-0 text-muted-fg transition-transform group-data-[open]:rotate-180 lg:block" />
            </>
          )}
        </>
      }
    >
      <div className="border-b border-line px-3 py-2.5">
        <p className="min-w-0 truncate text-body font-semibold text-ink">
          {user.name ?? user.email}
        </p>
        {user.name && (
          <p className="min-w-0 truncate text-xs text-muted-fg">{user.email}</p>
        )}
      </div>

      {/* The switch lives here and not in the tab bar's More sheet, though §4.2
          lists it there too: the mentor lens has no More sheet, so a dual-role
          admin who switched to it on a phone would have no way back. ⌥M is not
          the answer on a device with no ⌥. */}
      {/* Below `lg` only: from `lg` the rail carries the same switch, and
          the menu was a second copy of it one click away. */}
      {lens && (
        <div className="mt-1 lg:hidden">
          <ProfileSwitchMenu active={lens} />
        </div>
      )}

      {/* Every row has an icon in one 16px column, so the labels share one
          left edge. Only Sign out had one, which made it the row that looked
          different rather than the row that IS different — the rule above it
          does that job. */}
      <Link href="/settings" transitionTypes={["nav-forward"]} className={cn(MENU_ROW, "mt-1")}>
        <GearIcon className={MENU_ICON} />
        Settings
      </Link>

      {/* Staff below `lg` only: from `lg` the corner pill beside the bell is
          the way in. A student has no corner pill, so it stays for them. */}
      <Link
        href="/changelog"
        transitionTypes={["nav-forward"]}
        className={cn(MENU_ROW, !student && "lg:hidden")}
      >
        <SparklesIcon className={MENU_ICON} />
        <span className="flex-1">{"What's new"}</span>
        {whatsNew && (
          <span
            role="img"
            aria-label="Unread updates"
            className="h-2 w-2 rounded-full bg-brand"
          />
        )}
      </Link>

      {/* What the public page says about a mentor — not their settings,
          which is what "My profile" beside "Settings" read as. */}
      {mentorProfile && (
        <Link href={`/mentors/${user.id}`} transitionTypes={["nav-forward"]} className={MENU_ROW}>
          <UserIcon className={MENU_ICON} />
          Your mentor page
        </Link>
      )}

      {user.platformAdmin && (
        <Link href="/settings/platform" transitionTypes={["nav-forward"]} className={MENU_ROW}>
          <CrownIcon className={MENU_ICON} />
          Platform
        </Link>
      )}

      <ReportBugLink className={MENU_ROW}>
        <AlertIcon className={MENU_ICON} />
        Report a bug
      </ReportBugLink>

      {!student && (
        <Link href="/bugs" transitionTypes={["nav-forward"]} className={MENU_ROW}>
          <InboxIcon className={MENU_ICON} />
          Bug reports
        </Link>
      )}

      {/* Under the destinations and above Sign out: it is the one row here
          that changes nothing about where you are. */}
      <div className="mt-1 border-t border-line pt-1">
        <ThemeToggle />
        <DensityToggle />
      </div>

      <form action={signOutAction} className="mt-1 border-t border-line pt-1">
        <button type="submit" className={cn(MENU_ROW, "w-full cursor-pointer text-left")}>
          <LogOutIcon className={MENU_ICON} />
          Sign out
        </button>
      </form>
    </Popover>
  );
}

/**
 * The institute's name, for the reader whose whole work is in it.
 *
 * The program's own dot and the name it goes by in its own chrome, and no
 * other colour: DESIGN.md gives a program a dot and a label and nothing that
 * washes, and an institute is a program everywhere the ledger is concerned.
 * It sits beside the wordmark rather than replacing it — this is still
 * freshlog, and the wordmark is still the way home.
 */
function InstituteMark({
  space,
}: {
  space: Extract<Space, { kind: "institute" }>;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-body font-semibold text-ink">
      <ProgramDot program={{ id: space.programId, name: space.name, colorIndex: space.colorIndex }} />
      <span className="min-w-0 truncate">{space.name}</span>
    </span>
  );
}

/**
 * The first Tab stop on every signed-in page.
 *
 * Without it a keyboard reader crosses the wordmark, the whole rail and the
 * account menu before reaching the page they came for — on every page, since
 * the chrome is the same everywhere. Hidden until focused, then brand-filled
 * over everything (`z-50`), because a skip link you cannot see when you land
 * on it is one nobody learns is there. `#main` is `tabIndex={-1}` so focus
 * actually moves, and the next Tab continues from inside the page.
 */
function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-on-brand focus:shadow-lg focus:outline-none focus:ring-4 focus:ring-brand/30"
    >
      Skip to content
    </a>
  );
}

/**
 * Wordmark · bell · account. The whole of the chrome that is not navigation.
 *
 * Sticky, because the bell is in it. Below `lg` this bar is the ONLY way to
 * reach notifications — the rail that carries them at desktop widths is not
 * there, and the bottom tab bar does not hold them — so a static bar meant the
 * one control that changes on its own scrolled off the top of a long agenda
 * and stayed gone until you went back up.
 *
 * `z-30` is this app's layer for chrome pinned to the viewport: the rail and
 * the bottom tab bar are already there, and this is the third side of the same
 * frame. Above it sits only `z-50`, which is what opens ON TOP of chrome —
 * popovers, the account menu, a select's list.
 */
function TopBar({
  account,
  unread,
  links,
  search,
  width,
  className,
  place,
}: {
  account: React.ReactNode;
  /** The institute's mark, beside the wordmark — institute frame only. */
  place?: React.ReactNode;
  unread: UnreadSummary;
  links?: React.ReactNode;
  /** The palette's opener, for a reader who has the palette. */
  search?: React.ReactNode;
  width: string;
  className?: string;
}) {
  return (
    <header
      className={cn(
        // Translucent and blurred, like a real nav bar: a solid slab is the
        // web header's tell, and content sliding under frosted glass is the
        // iOS one. `vt-topbar` keeps it still while pages push past it.
        // pt-[env(safe-area-inset-top)]: in standalone the clock and battery
        // sit ON the bar — the padding gives them a strip of frosted glass to
        // sit on, which is exactly what an iOS nav bar does (resolves to 0 in
        // a browser tab, where there is no inset). No callout: a long press
        // on the wordmark or bell must not raise the link-preview sheet.
        // The hairline is absent until the page scrolls under the bar —
        // iOS keeps a large-title bar edgeless until content is beneath it.
        // PhoneChrome toggles `data-scrolled` past 6px.
        "vt-topbar sticky top-0 z-30 select-none border-b border-transparent bg-surface/80 backdrop-blur-xl backdrop-saturate-150 pt-[env(safe-area-inset-top)] [-webkit-touch-callout:none] transition-[border-color] duration-200 data-[scrolled]:border-line",
        className
      )}
    >
      <div
        className={cn(
          // The max() pair is landscape insurance: on a notched phone held
          // sideways the safe area is on a SIDE, and a bare px-4 would let the
          // wordmark sit under the notch. env() resolves to 0 where there is
          // no inset, so this is px-4 everywhere else.
          // `relative` anchors the centered page title PhoneChrome drops in.
          "relative mx-auto flex min-h-14 items-center gap-4 px-4",
          "pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]",
          width
        )}
      >
        <PhoneChrome
          brand={
            place ? (
              <span className="flex min-w-0 items-center gap-3">
                <BrandWordmark version={pkg.version} />
                {place}
              </span>
            ) : (
              <BrandWordmark version={pkg.version} />
            )
          }
        />
        {links}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {search}
          <NotificationBell unread={unread} />
          {account}
        </div>
      </div>
    </header>
  );
}

/**
 * Staff: a labelled rail at ≥ lg, a bottom bar below it.
 *
 * The rail is `fixed`, so the page is padded past it rather than laid out
 * beside it — which is what keeps a long table scrolling under its own rules
 * instead of inside a flex child.
 */
function StaffShell({
  user,
  profile,
  unread,
  items,
  lens,
  search,
  recent,
  now,
  whatsNew,
  place,
  children,
}: {
  user: User;
  /** The lens in force, which decides whose active issues the bell counts. */
  profile: Profile;
  unread: UnreadSummary;
  items: NavItem[];
  /** The institute's mark, when this reader is in one. */
  place?: React.ReactNode;
  /** Something in the changelog this person has not opened. */
  whatsNew: boolean;
  /** The lens, for the two people in one — null for everybody with one lens. */
  lens: Profile | null;
  search?: { mentors: boolean };
  /** The last few notices, for the bell's own panel. */
  recent: BellNotification[];
  /** One instant for every "3h ago" the panel prints. */
  now: Date;
  children: React.ReactNode;
}) {
  const account = (
    <AccountMenu
      user={user}
      lens={lens}
      mentorProfile={canActAsMentor(user)}
      whatsNew={whatsNew}
    />
  );

  return (
    <div className="flex min-h-full flex-1 flex-col lg:pl-[13.75rem] rail-collapsed:lg:pl-16">
      <SkipLink />

      {/* Once for the whole shell: ⌘K opens it from anywhere, and the rail's
          field and the top bar's button fire its event. Only for a reader
          with something to search — the same condition the rail's field has. */}
      {search && (
        <CommandPalette
          places={[...items, { href: "/settings", label: "Settings" }]}
          mentors={search.mentors}
        />
      )}

      {/* Once for the whole shell: the switch is in the DOM twice (one of them
          hidden by a breakpoint), so a listener on either would fire twice. */}
      {lens && <ProfileShortcut />}

      <Sidebar
        items={items}
        // Settings alone. Notifications left the rail for the bell in the
        // corner: it was the one row in a column of PLACES that changes on its
        // own, which made what has happened look like somewhere to go.
        utility={[{ href: "/settings", label: "Settings" }]}
        switcher={lens ? <ProfileSwitch active={lens} /> : undefined}
        search={search}
        account={account}
        place={place}
      />

      {/* The same measure as the page below it, so the wordmark lines up with
          the h1 rather than floating in from a narrower centre.

          `lg:hidden` is on the bar itself and not on a wrapper: sticky is
          confined to its parent's box, and a div that is exactly as tall as
          the bar inside it leaves nothing to stick to — the bar would scroll
          away exactly as it did before. */}
      <TopBar
        account={account}
        unread={unread}
        search={
          search ? (
            <CommandPaletteButton
              label={search.mentors ? "Find a student, mentor or page" : "Find a student or page"}
            />
          ) : undefined
        }
        width="max-w-6xl"
        className="lg:hidden"
        place={place}
      />

      {/* pb-24 clears the bottom bar (56px + the home-indicator inset);
          nothing sits under it at lg, where the bar is gone. */}
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl focus:outline-none flex-1 px-4 pb-24 pt-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] lg:pb-10 lg:pt-4"
      >
        {/* THE TOP RIGHT CORNER — "What's new" and the bell, at `lg` (below
            it they live in the top bar).

            A row of the page, not a control pinned over it. It was `fixed` to
            the window's corner, and everything that scrolled — a table's
            figures, a row's pencil — passed underneath it; at the top it sat
            on the title row's own buttons ("Log a session"), because the lane
            `PageTitle` reserved for a lone bell was narrower than the pill
            once "What's new" joined it. In the flow it takes its own line,
            nothing can be under it, and it scrolls away with the page the way
            a page's header does. The bell's menu is portaled, so it still
            opens over the page. */}
        <div className="mb-2 hidden justify-end lg:flex">
          <div className="flex items-center gap-1 rounded-full bg-surface p-0.5 shadow-sm">
            <WhatsNewLink unseen={whatsNew} />
            {/* The page must not wait on a count: the bell renders at once
                with no issues row and fills in when the queue has been read
                (see IssueBell). */}
            <Suspense fallback={<NotificationMenu unread={unread} recent={recent} now={now} />}>
              <IssueBell user={user} profile={profile} unread={unread} recent={recent} now={now} />
            </Suspense>
          </div>
        </div>
        <PageTransition>{children}</PageTransition>
      </main>

      <TabBar items={items} className="lg:hidden" />
      <NativeGestures />
    </div>
  );
}

/**
 * Students: no sidebar at any width.
 *
 * A student must never feel "accidentally let into an internal admin tool"
 * (PRODUCT.md), and a 220px rail of school-wide lists is exactly what that
 * feels like. Four items fit a top bar on a laptop and a bottom bar on a phone,
 * and the page is `max-w-2xl` because a student's pages are one column of their
 * own things — a 6xl measure would set a paragraph 1100px wide.
 */
function StudentShell({
  user,
  unread,
  items,
  whatsNew,
  place,
  children,
}: {
  user: User;
  unread: UnreadSummary;
  items: NavItem[];
  whatsNew: boolean;
  place?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SkipLink />
      <TopBar
        width="max-w-2xl"
        unread={unread}
        place={place}
        links={
          <nav
            aria-label="Primary"
            className="hidden flex-1 items-center gap-1 md:flex"
          >
            <NavLinks items={items} />
          </nav>
        }
        account={
          <AccountMenu
            user={user}
            lens={null}
            mentorProfile={false}
            whatsNew={whatsNew}
            named={false}
          />
        }
      />

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-2xl focus:outline-none flex-1 px-4 pb-24 pt-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:pb-10"
      >
        <PageTransition>{children}</PageTransition>
      </main>

      <TabBar items={items} className="md:hidden" />
      <NativeGestures />
    </div>
  );
}

/**
 * Is this person still being let in?
 *
 * PENDING and UNASSIGNED say so outright. The two onboarding routes do not have
 * a flag of their own, so the test is the same predicate the gates that send
 * people there already use — `requireMentor` (a mentor with no name) and
 * `student/page.tsx` (no profile, no name, or no Telegram username). Those two
 * and this one have to agree: a reader the gate redirects to onboarding and the
 * shell dresses in a full nav is the exact case §4.2 is about.
 */
async function settlingIn(user: User): Promise<boolean> {
  if (
    user.status === USER_STATUS.PENDING ||
    user.status === USER_STATUS.UNASSIGNED
  ) {
    return true;
  }
  if (user.role === ROLES.STUDENT) {
    if (!user.name?.trim()) return true;
    const profile = await prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { telegramUsername: true },
    });
    return !profile?.telegramUsername;
  }
  return canActAsMentor(user) && !user.name?.trim();
}

/**
 * The chrome every signed-in page renders inside.
 *
 * It takes no `mode`. The lens is the cookie's answer and nothing else's: three
 * layouts used to pass the role of the route TREE they sat in, and two more
 * fell back to `user.role`, so a dual-role admin reading their notifications
 * was shown the admin nav whichever lens they were actually working in. Where
 * the URL and the lens disagree, the chrome should say which lens you are in —
 * that is the only thing it knows that the URL does not.
 */
export async function AppShell({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  if (await settlingIn(user)) {
    return <PublicShell user={user}>{children}</PublicShell>;
  }

  // Six rows and a count, in one round trip each. The panel is a glance, so
  // `take: 6` is the whole of it — `/notifications` is where the feed lives.
  const [profile, unreadRows, recent, changelog] = await Promise.all([
    profileOf(user),
    prisma.notification.groupBy({
      by: ["category"],
      where: { userId: user.id, read: false },
      _count: true,
    }),
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        type: true,
        message: true,
        read: true,
        createdAt: true,
      },
    }),
    readChangelog(),
  ]);
  const unread = summarizeUnread(
    unreadRows.map((r) => ({ category: r.category, count: r._count }))
  );
  const whatsNew = hasUnseenChangelog(changelog, user);
  // One instant for every "3h ago" the bell prints, computed here rather than
  // inside the render, for the reason `ViewerContext.now` exists.
  const now = new Date();
  // The frame: the school, or the one institute this person's whole work is
  // in. It dresses the chrome and picks the sidebar's items; it never decides
  // what they may open (lib/space.ts).
  const space = await spaceOf(user, profile);
  const items = await navFor(user, profile, space);
  const place =
    space.kind === "institute" ? <InstituteMark space={space} /> : undefined;

  if (user.role === ROLES.STUDENT) {
    return (
      <StudentShell
        user={user}
        unread={unread}
        items={items}
        whatsNew={whatsNew}
        place={place}
      >
        {children}
      </StudentShell>
    );
  }

  // The search goes where the lists are — the same two readers `/students`
  // lets in: somebody with a grant, and somebody who mentors, whose roster is
  // everyone they may log hours with. A person with neither has no list to
  // search. Only a full admin has a Mentors item, and that is read off the
  // items `navFor` just derived rather than off a role.
  const scope = await adminScope(user);
  const search =
    scopeIsEmpty(scope) && !canActAsMentor(user)
      ? undefined
      : { mentors: items.some((i) => i.href === "/mentors") };

  return (
    <StaffShell
      user={user}
      unread={unread}
      recent={recent}
      now={now}
      items={items}
      whatsNew={whatsNew}
      place={place}
      profile={profile}
      lens={(await canSwitchProfile(user)) ? profile : null}
      search={search}
    >
      {children}
    </StaffShell>
  );
}

/**
 * The bell, told how many active issues `/notifications` lists for this
 * reader — the same rows, counted the same way (everything but the
 * "all clear" line). Before October 2026 the bell said "none unread" while
 * Home said "6 items need your attention", and the reader believed the bell.
 *
 * Streamed behind a Suspense boundary so it never holds the page up.
 * `attentionFor` is request-cached, so the Homes and /notifications, which
 * read the same queue, share this one read.
 */

async function IssueBell({
  user,
  profile,
  unread,
  recent,
  now,
}: {
  user: User;
  profile: Profile;
  unread: UnreadSummary;
  recent: BellNotification[];
  now: Date;
}) {
  const { statuses } = await attentionFor(user, profile);
  const issues = statuses.filter((s) => s.type !== "ALL_CLEAR").length;
  return <NotificationMenu unread={unread} recent={recent} now={now} issues={issues} />;
}
