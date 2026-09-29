"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { CheckIcon } from "@/components/icons";
import { setProfile } from "@/lib/actions/profile";
import type { Profile } from "@/lib/profile";

const ITEMS = [
  { value: "admin", label: "Admin" },
  { value: "mentor", label: "Mentor" },
] as const satisfies readonly { value: Profile; label: string }[];

/**
 * Alt+M, and ⌥M on a Mac — "M for mode". Chosen because it is free in every
 * major browser on both platforms: ⌘L/Ctrl+L, the obvious pick, is the address
 * bar and is reserved, so a page cannot have it.
 *
 * Rendered as a tooltip rather than visible text: the header already carries a
 * brand, a switch, a bell and a menu at 320px.
 */
function useShortcutLabel(): string {
  // The platform is an external, never-changing fact, and the server can't see
  // it — so the server renders the plain form and the client swaps in ⌥ during
  // hydration. useSyncExternalStore is what gives those two different answers
  // without it counting as a hydration mismatch.
  return useSyncExternalStore(
    subscribeToNothing,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌥M" : "Alt+M"),
    () => "Alt+M"
  );
}

/** A store that never emits: the keyboard's labels don't change mid-session. */
function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * The keyboard half of the switch: Alt+M / ⌥M anywhere in the app. Renders
 * nothing, and the shell mounts exactly one of it — both switches are in the
 * DOM at once (one hidden by a breakpoint), so hanging the listener off either
 * would fire it twice.
 *
 * It presses the switch rather than navigating. That is the whole change: the
 * lens is a cookie, so there is one thing to do and no map of which page in one
 * role's tree corresponds to which page in the other's. The map used to decide
 * where ⌥M landed, and where it had no entry — most pages — the answer was a
 * home screen, which is the wrong answer to "show me this in the other lens".
 */
export function ProfileShortcut() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Alt alone: ⌥⌘M and ⌥⇧M belong to other things, here and in the OS.
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      // ⌥M types "µ" on a Mac, so the key that arrives isn't "m" — the physical
      // key is what identifies the chord.
      if (e.code !== "KeyM") return;
      // Never while someone is writing a note or a student's name — and never
      // steal the µ they meant to type.
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT")
      ) {
        return;
      }
      // The one button in the switch is the profile you are NOT in; the one
      // you are in is a label, not a control.
      const other = document.querySelector<HTMLButtonElement>(
        "[data-profile-switch] button[type=submit]"
      );
      if (!other?.form) return;
      e.preventDefault();
      // requestSubmit, not click(). A synthetic click reaches the server and
      // flips the cookie, but does not drive React's action re-render the way a
      // trusted click does — so the lens changed and the rail did not repaint
      // until a reload. Measured in a browser, not reasoned about.
      other.form.requestSubmit(other);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}

/**
 * Two segments on a grey track, the active one a white thumb — the app's
 * segmented control (`ui/segmented`), drawn by hand only because one half is a
 * submit and the other is a label. Dual-role admins only.
 *
 * A form, not a pair of links: switching writes a cookie and revalidates, so
 * the page you are on repaints in the other lens at the same URL. `path` rides
 * along because the two homes are still separate trees — see `setProfile`.
 */
export function ProfileSwitch({ active }: { active: Profile }) {
  const pathname = usePathname();
  const shortcut = useShortcutLabel();
  return (
    <form
      action={setProfile}
      data-profile-switch
      role="group"
      aria-label="Switch profile"
      aria-keyshortcuts="Alt+M"
      // Full width with two equal segments, the way iOS lays a segmented
      // control across a sidebar. The w-fit version left a stretch child
      // filling the rail as an empty trough; equal flex-1 halves fill it with
      // the control itself instead.
      className="flex w-full items-center gap-0.5 rounded-lg bg-fill p-0.5"
    >
      <input type="hidden" name="path" value={pathname} />
      {ITEMS.map((it) =>
        it.value === active ? (
          <span
            key={it.value}
            aria-current="true"
            className="flex min-h-8 flex-1 items-center justify-center rounded-md bg-surface px-2.5 text-[0.8125rem] font-semibold text-ink shadow-sm"
          >
            {it.label}
          </span>
        ) : (
          <button
            key={it.value}
            type="submit"
            name="profile"
            value={it.value}
            title={`Switch profile (${shortcut})`}
            className="flex min-h-8 flex-1 cursor-pointer items-center justify-center rounded-md px-2.5 text-[0.8125rem] font-medium text-muted-fg transition-colors hover:text-ink"
          >
            {it.label}
          </button>
        )
      )}
    </form>
  );
}

/**
 * The same switch as a pair of menu rows. On a 320px header there is no room
 * for branding, a two-segment switch, a bell and a menu button at once — and
 * the switch is the one of the four that can live inside the menu without being
 * any harder to find.
 */
export function ProfileSwitchMenu({ active }: { active: Profile }) {
  const pathname = usePathname();
  const shortcut = useShortcutLabel();
  return (
    <form
      action={setProfile}
      data-profile-switch
      className="border-b border-line pb-1"
      role="group"
      aria-label="Switch profile"
      aria-keyshortcuts="Alt+M"
    >
      <input type="hidden" name="path" value={pathname} />
      <p className="flex items-baseline justify-between gap-2 px-3 pb-0.5 pt-1 text-[0.8125rem] text-muted-fg">
        Profile
        <span className="font-medium">
          {shortcut}
        </span>
      </p>
      {ITEMS.map((it) =>
        it.value === active ? (
          <span
            key={it.value}
            aria-current="true"
            className="flex min-h-11 items-center justify-between rounded-lg px-3 text-[0.9375rem] text-ink"
          >
            {it.label}
            <CheckIcon className="h-4 w-4 text-brand" />
          </span>
        ) : (
          <button
            key={it.value}
            type="submit"
            name="profile"
            value={it.value}
            className="flex min-h-11 w-full cursor-pointer items-center rounded-lg px-3 text-left text-[0.9375rem] text-ink transition-colors hover:bg-fill"
          >
            {it.label}
          </button>
        )
      )}
    </form>
  );
}
