"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { ChevronLeftIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * The phone's nav bar, in the three pieces iOS splits it into.
 *
 * A page's own header row is a scrollable thing — it leaves with the content.
 * An app's nav bar is fixed chrome, and on iOS it does three jobs this reads
 * off the page instead of being told: the back chevron with the previous
 * screen's name, the screen's title centered once the big one scrolls under,
 * and a hairline that only appears once there is content beneath the bar.
 *
 * Everything it needs is already in the document: `PageTitle` marks its h1
 * `data-large-title` and its back link `data-back-href`, so this component
 * watches `<main>` for them rather than threading props through the layouts.
 * Both render only below `sm` — on a tablet or a desktop the body row and the
 * wordmark keep doing these jobs.
 *
 * The pieces swap instantly on navigation rather than crossfading: the bar is
 * a frozen view-transition capture, which cannot animate its contents anyway,
 * and iOS's own bar crossfade is subtle enough that a cut on commit reads the
 * same.
 */
export function PhoneChrome({ brand }: { brand: React.ReactNode }) {
  const pathname = usePathname();
  const [title, setTitle] = useState("");
  const [back, setBack] = useState<{ href: string; label: string } | null>(
    null,
  );
  const [collapsed, setCollapsed] = useState(false);

  // A navigation drops every mark the last page left — reset during render
  // rather than in an effect, so the bar never paints one frame of the
  // previous page's title (the same reason SearchField syncs in render).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setCollapsed(false);
    setTitle("");
    setBack(null);
  }

  useEffect(() => {
    let titleEl: HTMLElement | null = null;
    let raf = 0;

    const measure = () => {
      const bar = document.querySelector(".vt-topbar");
      if (bar) {
        bar.toggleAttribute("data-scrolled", window.scrollY > 6);
        if (titleEl) {
          // Collapsed once the large title's bottom edge slides under the bar.
          setCollapsed(
            titleEl.getBoundingClientRect().bottom <=
              bar.getBoundingClientRect().bottom + 2,
          );
        }
      }
    };

    const scan = () => {
      titleEl = document.querySelector<HTMLElement>("[data-large-title]");
      setTitle(titleEl?.textContent?.trim() ?? "");
      const backEl = document.querySelector("[data-back-href]");
      if (backEl instanceof HTMLAnchorElement) {
        const href = backEl.getAttribute("href") ?? "";
        let label = backEl.textContent?.trim() || "";
        // "Back" names nothing. iOS's chevron reads the screen it returns to —
        // the nav's own label for that route is already in the document (the
        // top bar's links stay mounted, just hidden, below `md`). Longest
        // prefix wins, so `/students/abc` reads "Students".
        if (!label || label === "Back") {
          let bestHref = 0;
          let bestLabel = "";
          for (const a of document.querySelectorAll<HTMLAnchorElement>(
            "nav a[href^='/']",
          )) {
            const navHref = a.getAttribute("href") ?? "";
            if (
              navHref.length > bestHref &&
              (href === navHref || href.startsWith(`${navHref}/`))
            ) {
              bestHref = navHref.length;
              bestLabel = a.textContent?.trim() ?? "";
            }
          }
          label = bestLabel || "Back";
        }
        setBack({ href, label });
      } else {
        setBack(null);
      }
      measure();
    };

    // Page content streams in after the shell, so the marks it carries are
    // found by watching, not by timing — and the first look waits a frame,
    // because on a fresh load even <main> may not exist yet.
    const mo = new MutationObserver(scan);
    mo.observe(document.querySelector("main") ?? document.body, {
      childList: true,
      subtree: true,
    });
    const firstScan = requestAnimationFrame(scan);

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      mo.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(firstScan);
      document.querySelector(".vt-topbar")?.removeAttribute("data-scrolled");
    };
  }, [pathname]);

  return (
    <>
      {/* Both render whenever a back link exists — CSS decides which is seen:
          the chevron on a phone, the wordmark from `sm` up. */}
      {/* min-w-0, not shrink-0: an institute's name rides beside the
          wordmark here and is what gives way on a narrow phone. The wordmark
          keeps its own shrink-0. */}
      <div className={cn("flex min-w-0 items-center", back && "max-sm:hidden")}>
        {brand}
      </div>
      {back && (
        // `‹ Back` — where iOS puts it. A 44px-tall hit area: the glyphs are
        // 24px, the padding around them is the rest of the target.
        <Link
          href={back.href}
          transitionTypes={["nav-back"]}
          aria-label={collapsed ? `Back to ${back.label}` : undefined}
          className="-ml-1 inline-flex min-h-11 min-w-0 shrink items-center pr-2 text-[0.9375rem] font-medium text-brand sm:hidden"
        >
          <ChevronLeftIcon className="-mr-0.5 h-6 w-6 shrink-0" />
          {/* Once the title shows, the label steps aside to the chevron, the
              way iOS shortens a long back title: the two sat in the same few
              dozen pixels and drew over each other. */}
          <span className={cn("max-w-28 truncate", collapsed && "hidden")}>
            {back.label}
          </span>
        </Link>
      )}
      {/* In the row, not absolutely centred over it: it takes whatever the
          back link and the buttons leave, so it can truncate but never
          overlap them. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none min-w-0 flex-1 text-center text-[0.9375rem] font-semibold text-ink transition-[opacity,transform] duration-200 sm:hidden",
          collapsed ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
        )}
      >
        <span className="block min-w-0 truncate">{title}</span>
      </span>
    </>
  );
}
