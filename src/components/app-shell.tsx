import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { ChevronDownIcon, LogOutIcon } from "@/components/icons";
import { NavLinks } from "@/components/nav-links";
import {
  ProfileShortcut,
  ProfileSwitch,
  ProfileSwitchMenu,
} from "@/components/profile-switch";
import { PublicShell } from "@/components/public-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sidebar } from "@/components/sidebar";
import { TabBar } from "@/components/tab-bar";
import { Popover } from "@/components/ui/popover";
import { signOut } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { adminScope, scopeIsEmpty } from "@/lib/authz";
import { canActAsMentor, ROLES, USER_STATUS } from "@/lib/constants";
import { navFor, notificationsItem, type NavItem } from "@/lib/nav";
import { prisma } from "@/lib/prisma";
import { canSwitchProfile, homeFor, profileOf, type Profile } from "@/lib/profile";
import type { User } from "@/generated/prisma/client";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

/**
 * 44px, up from 40. The smallest reliable touch target, and this is the only
 * control in the phone chrome that was under it.
 *
 * The count is brand blue: unread notifications are not a problem, and red is
 * spent here on hours that are gone and balances that are negative. It appears
 * only below `lg` — at desktop widths the sidebar's Notifications row carries
 * the same number, and stating it twice on one screen is the "remaining is
 * never said twice" rule applied to the chrome.
 */
function NotificationBell({ count, href }: { count: number; href: string }) {
  return (
    <Link
      href={href}
      aria-label={`Notifications (${count} unread)`}
      /* shrink-0 is load-bearing, and was measured: as a flex item beside the
         wordmark and the account button, the 44px box shrank to 27px wide at
         390px — the target this commit widened, quietly given back. */
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-fg transition hover:bg-brand-soft hover:text-brand hover:ring-2 hover:ring-brand/15"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
        />
      </svg>
      {count > 0 && (
        <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-on-brand">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

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
}: {
  user: User;
  /** The lens to show as active, or null for somebody who has only one. */
  lens: Profile | null;
  /** Where a mentor edits their own name, picture and booking link, until /settings. */
  mentorProfile: boolean;
}) {
  const label = user.name ?? user.email;
  const initial = (user.name?.trim() || user.email).charAt(0).toUpperCase();

  return (
    <Popover
      label="Account"
      origin="end"
      width="sm"
      triggerClassName="group flex h-11 w-full cursor-pointer items-center gap-2 rounded-lg pl-1 pr-2 transition-colors hover:bg-canvas"
      trigger={
        <>
          {user.avatarUpdatedAt ? (
            <Avatar person={user} className="h-8 w-8 shrink-0" />
          ) : (
            // The brand-soft initial rather than the identity tone used for a
            // person in a list: this is your OWN chrome, not somebody you are
            // being asked to tell apart from somebody else.
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand"
            >
              {initial}
            </span>
          )}
          <span className="hidden min-w-0 flex-1 truncate text-left text-sm font-medium text-ink lg:inline">
            {label}
          </span>
          <ChevronDownIcon className="hidden h-4 w-4 shrink-0 text-muted-fg transition-transform group-data-[open]:rotate-180 lg:block" />
        </>
      }
    >
      <div className="border-b border-line px-3 py-2.5">
        <p className="min-w-0 truncate text-sm font-medium text-ink">
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
      {lens && (
        <div className="mt-1">
          <ProfileSwitchMenu active={lens} />
        </div>
      )}

      <Link
        href="/settings"
        className="mt-1 flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-fg transition-colors hover:bg-canvas hover:text-ink"
      >
        Settings
      </Link>

      {user.platformAdmin && (
        <Link
          href="/settings/platform"
          className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-fg transition-colors hover:bg-canvas hover:text-ink"
        >
          Platform
        </Link>
      )}

      {mentorProfile && (
        <Link
          href={`/mentors/${user.id}`}
          className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-fg transition-colors hover:bg-canvas hover:text-ink"
        >
          My profile
        </Link>
      )}

      {/* Under the destinations and above Sign out: it is the one row here
          that changes nothing about where you are. */}
      <div className="mt-1 border-t border-line pt-1">
        <ThemeToggle />
      </div>

      <form action={signOutAction} className="mt-1 border-t border-line pt-1">
        <button
          type="submit"
          className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-muted-fg transition-colors hover:bg-danger-soft hover:text-danger-ink"
        >
          <LogOutIcon className="h-4 w-4" />
          Sign out
        </button>
      </form>
    </Popover>
  );
}

/** Wordmark · bell · account. The whole of the chrome that is not navigation. */
function TopBar({
  account,
  unread,
  notificationsHref,
  links,
  width,
}: {
  account: React.ReactNode;
  unread: number;
  /** Where the bell goes — the reader's home, where the feed now lives. */
  notificationsHref: string;
  links?: React.ReactNode;
  width: string;
}) {
  return (
    <header className="border-b border-line bg-surface">
      <div className={cn("mx-auto flex min-h-16 items-center gap-4 px-4", width)}>
        <Link
          href="/"
          className="shrink-0 text-base font-bold tracking-tight text-brand"
        >
          freshlog
        </Link>
        {links}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <NotificationBell count={unread} href={notificationsHref} />
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
  unread,
  notificationsHref,
  items,
  lens,
  search,
  children,
}: {
  user: User;
  unread: number;
  notificationsHref: string;
  items: NavItem[];
  /** The lens, for the two people in one — null for everybody with one lens. */
  lens: Profile | null;
  search?: { mentors: boolean };
  children: React.ReactNode;
}) {
  const account = (
    <AccountMenu
      user={user}
      lens={lens}
      mentorProfile={canActAsMentor(user)}
    />
  );

  return (
    <div className="flex min-h-full flex-1 flex-col lg:pl-[220px]">
      {/* Once for the whole shell: the switch is in the DOM twice (one of them
          hidden by a breakpoint), so a listener on either would fire twice. */}
      {lens && <ProfileShortcut />}

      <Sidebar
        items={items}
        // The gear carries its word: an icon alone is the thing §4.1 rules out,
        // and this is the row a reader reaches for least often and needs to
        // recognise fastest.
        utility={[
          notificationsItem(unread, notificationsHref),
          { href: "/settings", label: "Settings" },
        ]}
        switcher={lens ? <ProfileSwitch active={lens} /> : undefined}
        search={search}
        account={account}
      />

      <div className="lg:hidden">
        {/* The same measure as the page below it, so the wordmark lines up
            with the h1 rather than floating in from a narrower centre. */}
        <TopBar
          account={account}
          unread={unread}
          notificationsHref={notificationsHref}
          width="max-w-6xl"
        />
      </div>

      {/* pb-24 clears the bottom bar; nothing sits under it at lg, where the
          bar is gone. */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 lg:pb-10 lg:pt-8">
        {children}
      </main>

      <TabBar items={items} className="lg:hidden" />
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
  notificationsHref,
  items,
  children,
}: {
  user: User;
  unread: number;
  notificationsHref: string;
  items: NavItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBar
        width="max-w-2xl"
        unread={unread}
        notificationsHref={notificationsHref}
        links={
          <nav
            aria-label="Primary"
            className="hidden flex-1 items-center gap-6 md:flex"
          >
            <NavLinks items={items} />
          </nav>
        }
        account={
          <AccountMenu user={user} lens={null} mentorProfile={false} />
        }
      />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-6 md:pb-10">
        {children}
      </main>

      <TabBar items={items} className="md:hidden" />
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

  const [profile, unread] = await Promise.all([
    profileOf(user),
    prisma.notification.count({ where: { userId: user.id, read: false } }),
  ]);
  const items = await navFor(user, profile);
  // The bell goes to the reader's own home, where the feed now lives under
  // "Notifications" — the same section that used to be called "Needs you". Two
  // things named notifications, one of them a page nobody had a reason to
  // visit, was the confusion the rename was asked for in the first place.
  const notificationsHref = `${homeFor(user, profile)}#notifications`;

  if (user.role === ROLES.STUDENT) {
    return (
      <StudentShell
        user={user}
        unread={unread}
        notificationsHref={notificationsHref}
        items={items}
      >
        {children}
      </StudentShell>
    );
  }

  // The search goes where the lists are. A person with no grants has no list to
  // search, and only a full admin has a Mentors list to send the second submit
  // to — both read off the items `navFor` just derived rather than off a role.
  const scope = await adminScope(user);
  const search = scopeIsEmpty(scope)
    ? undefined
    : { mentors: items.some((i) => i.href === "/mentors") };

  return (
    <StaffShell
      user={user}
      unread={unread}
      notificationsHref={notificationsHref}
      items={items}
      lens={canSwitchProfile(user) ? profile : null}
      search={search}
    >
      {children}
    </StaffShell>
  );
}
