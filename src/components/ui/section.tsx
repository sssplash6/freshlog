import Link from "next/link";
import type { ComponentProps } from "react";

import { ArrowLeftIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * Page and section chrome: one treatment each, no tones — and ONE SPACING
 * SCALE, which is what this file is the source of.
 *
 * Three steps, and there is no fourth:
 *
 *   space-y-4   between top-level blocks of a page. It was 4, 5, 6 and 8
 *               across seventeen pages, so no two pages had the same rhythm
 *               and every one of them scrolled further than it needed to.
 *   py-2.5      a section's HEADER band, and only that (`Section`, below)
 *   py-2        everything INSIDE a section — a body, a list row, a table
 *               cell. It was 2, 2.5, 3, 3.5, 4 and 5, chosen per call site.
 *
 * Horizontal is `px-4 sm:px-5` throughout and was already consistent.
 *
 * Nothing here is a matter of taste about air: the owner reads this product on
 * a phone, and every step this file gives back is a row that fits on the
 * screen instead of below it.
 *
 * What this replaces was a system where a region's colour said who owned its
 * data — amber for what mentors logged, violet for what admins planned, blue
 * for what was derived — carried over from the spreadsheet these pages
 * replaced. It was a defensible idea that did not survive contact with a real
 * screen: the student home stacked violet, amber, violet and blue panels under
 * an orange hero, and a mentor's identity chip could be the same amber as the
 * panel behind it. The eyebrow already says who owns the region in words, so
 * the tint was saying it a second time in a language with four words in it.
 *
 * Hierarchy now comes from weight, size and space, per DESIGN.md's own rule:
 * use a rule and whitespace before reaching for a container.
 */

/** Small-caps label above a title. One size, one colour, everywhere. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    // 11px, not the 10px this replaces in nine variants: 10px uppercase with
    // letter-spacing is sub-readable on a phone, which is where students are.
    <div
      className={cn(
        "text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-muted-fg",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * The page's title block. A back-link, an eyebrow, the h1, one line of subtitle
 * and an actions cluster — on the page ground, in no card.
 *
 * No wash, no 3px coloured rule, no oversized ghost monogram. The monogram in
 * particular was a 104px letterform behind the text on eight pages, which is
 * where a long subtitle went to become unreadable.
 */
export function PageTitle({
  backHref,
  backLabel,
  eyebrow,
  title,
  subtitle,
  actions,
  leading,
  className,
}: {
  backHref?: string;
  backLabel?: React.ReactNode;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Left of the title — a profile picture, so a person's page opens with them. */
  leading?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {backHref && (
        <Link
          href={backHref}
          /* The one back row every page shares: typing it `nav-back` is what
             makes PageTransition slide the returning page in from the left
             instead of pushing it in from the right.
             Hidden under `sm`, where PhoneChrome lifts it into the top bar —
             the place iOS puts a back button. `data-back-href` is how the bar
             finds it; there is no prop drilled through three layouts. */
          data-back-href={backHref}
          transitionTypes={["nav-back"]}
          className="group hidden items-center gap-1.5 text-sm font-medium text-muted-fg hover:text-ink sm:inline-flex"
        >
          <ArrowLeftIcon className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          {backLabel}
        </Link>
      )}
      {/* `lg:pr-14` keeps the bell's lane clear. The bell is fixed to the
          window's top right corner and this row is the only thing in the page
          that reaches that height, so without it a page action — "Log a
          session", "Add a student" — takes a 99+ badge through the middle of
          itself. Reserved on every page rather than on the ones that have an
          action today, because the collision arrives with the action. */}
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2 lg:pr-14">
        {/* The picture and the words it belongs to are ONE group, centred on
            each other. They used to be siblings of the whole row, which is
            end-aligned so the actions sit on the baseline — so a 64px avatar
            lined its bottom edge up with the subtitle and read as sitting
            below the name it labels. */}
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {leading && <div className="shrink-0">{leading}</div>}
          <div className="min-w-0 flex-1">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            {/* 24/26px, down from 28/32. The masthead is read once on arrival
                and the table under it is read for the rest of the visit: at
                twice the size of its own section headings it was the loudest
                thing on a page it says the least on. It still leads — 26 over
                the section's 17 and the row's 13 — by a step rather than by a
                shout.
                `data-large-title` lets PhoneChrome echo it into the top bar
                once it scrolls under — the iOS large-title collapse. */}
            <h1
              data-large-title
              className="mt-0.5 text-[1.75rem] font-bold leading-tight tracking-tight text-ink sm:text-[1.625rem]"
            >
              {title}
            </h1>
            {subtitle && <div className="mt-1 text-sm text-muted-fg">{subtitle}</div>}
          </div>
        </div>
        {actions && (
          /* Its own line on a phone: beside the title it squeezes the title
             column to a sliver, and a masthead that wraps mid-word is a web
             tell — on iOS the actions live under the large title. */
          <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A titled region. A hairline header on the page's own card, and nothing else.
 *
 * `count` is a slot rather than part of the title because a count belongs to
 * the thing being counted: eight call sites concatenated their own — "3 logged
 * · 1 scheduled · 2 of 8 tasks open" — and each invented its own grammar.
 */
export function Section({
  eyebrow,
  title,
  count,
  caption,
  action,
  children,
  className,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  count?: number;
  caption?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section
      className={cn("overflow-hidden rounded-2xl border border-line bg-surface shadow-sm", className)}
      {...props}
    >
      {/* items-baseline, not items-end: the title is 17px and the action beside
          it is 13-14px, so bottom-aligning the two boxes left their text sitting
          on two different lines. Baselines are what the eye reads as level. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 border-b border-line px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h2 className="mt-0.5 flex items-baseline gap-1.5 text-[1.0625rem] font-bold tracking-tight text-ink">
            {/* min-w-0 so the truncate actually truncates: on a flex child
                without it the text sets the width and the row grows instead. */}
            <span className="min-w-0 truncate">{title}</span>
            {count != null && (
              <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-fg">
                {count}
              </span>
            )}
          </h2>
        </div>
        {action ?? (caption ? <p className="text-xs text-muted-fg">{caption}</p> : null)}
      </div>
      {children}
    </section>
  );
}
