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

/**
 * HOW WIDE A PAGE IS, by what kind of page it is — two answers, no third.
 *
 *   full     (no class) a page of tables, rosters, boards and dashboards. It
 *            takes the shell's whole measure (`max-w-6xl`), because its
 *            columns are what it is for.
 *   reading  `READING_WIDTH` — a page of one column read top to bottom: a
 *            form, a settings list, a feed, a document. 48rem, left-aligned
 *            on the title's edge, because a sentence or a field 1100px wide
 *            is one the eye loses.
 *
 * Pages used to pick per page — 2xl centred, 3xl, 4xl, 5xl — so walking from
 * Settings to Platform to Log a session moved the right edge three times.
 */
export const READING_WIDTH = "max-w-3xl";

/**
 * A quiet line of context above a title. One size, one colour, everywhere.
 *
 * Sentence case, not tracked small caps. The caps version was on every page
 * heading and every section, and a label shouting in capitals above every
 * block is the look of a template rather than of a calm product — iOS writes
 * these the way it writes everything else, and so does this.
 */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("text-xs font-medium text-muted-fg", className)}>
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
    <div
      className={cn(
        // A back link has to clear the title block under it: at 8px the eyebrow
        // sat hard against it, two lines of the same small grey.
        backHref ? "space-y-3" : "space-y-2",
        // The shell's corner icons sit on this row; the lane is theirs.
        "lg:pr-[var(--corner-lane,0px)]",
        className
      )}
    >
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
          className="group hidden items-center gap-1.5 rounded-md text-sm font-medium text-muted-fg hover:text-ink sm:inline-flex"
        >
          <ArrowLeftIcon className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          {backLabel}
        </Link>
      )}
      {/* The picture and the words it belongs to are ONE group, centred on
          each other. They used to be siblings of a row end-aligned so the
          actions sat on the baseline — so a 64px avatar lined its bottom edge
          up with the subtitle and read as sitting below the name it labels.
          Stacked on a phone: beside a 64px picture a 32px name had ~230px,
          and "Konstantinopolskaya-Whitfield" broke mid-word across three
          lines. Above it, the name gets the full width — the iOS contact
          card's order. */}
      <div className="flex min-w-0 gap-4 max-sm:flex-col max-sm:items-start max-sm:gap-3 sm:items-center">
        {leading && <div className="shrink-0">{leading}</div>}
        <div className="flex min-w-0 flex-1 flex-col max-sm:w-full">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          {/* THE ACTIONS RIDE THE TITLE'S LINE, centred on the h1 itself.
              They used to be a sibling of the whole block, bottom-aligned to
              it — so "Log a session" sat 8px lower on a page with a subtitle
              than on one without, and jumped as you moved between tabs
              (October 2026). On a phone the row dissolves (`contents`) and
              the actions drop to their own line under the subtitle, where iOS
              puts them: beside the title they squeezed it to a sliver. */}
          <div className="flex min-w-0 items-center justify-between gap-x-5 max-sm:contents">
            {/* The `display` step, 32px (28 on a phone). A comment here used
                to say 24/26 while the class said 28/32 — the note had been
                left behind by a later change (fixed October 2026). The size
                and its tracking now come from the type scale's tokens.
                `data-large-title` lets PhoneChrome echo it into the top bar
                once it scrolls under — the iOS large-title collapse. */}
            <h1
              data-large-title
              // iOS's large title: 32px bold with the tightening SF applies at
              // display sizes. The one loud thing on the page, by design —
              // everything under it is quiet so it can be.
              // `wrap-anywhere`: a title is often a person, and a person with
              // no name yet is an email address — one unbreakable word that,
              // at 32px, pushed the whole page sideways on a phone.
              // 28px under `sm`: at 32 a 20-letter word is wider than a 390px
              // phone's column, and a name broken mid-word reads as a typo.
              className="mt-0.5 min-w-0 text-figure-lg font-bold text-ink wrap-anywhere sm:text-display"
            >
              {title}
            </h1>
            {actions && (
              // gap 12px on a phone: at 8px a 44px button sat against the
              // descenders of the title above it.
              <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:order-last max-sm:mt-3 max-sm:w-full">
                {actions}
              </div>
            )}
          </div>
          {subtitle && <div className="mt-1.5 text-sm text-muted-fg wrap-anywhere">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * A titled region, iOS grouped-list style: the heading sits ON THE PAGE above
 * the card, and the card holds only content.
 *
 * It used to be a card with its own header band — title, a hairline, then the
 * body — so every page was a stack of boxes each wearing a lid, and the eye
 * read the lids before the content. Lifting the heading out onto the canvas
 * does what the iOS Settings and Health apps do: one quiet title per group,
 * then a single white surface with no border, lifted by the grey around it.
 *
 * `count` is a slot rather than part of the title because a count belongs to
 * the thing being counted: eight call sites concatenated their own — "3 logged
 * · 1 scheduled · 2 of 8 tasks open" — and each invented its own grammar.
 *
 * `className` lands on the CARD, which is what every caller that passes one
 * means (a grid span, a height).
 */
export function Section({
  eyebrow,
  title,
  count,
  caption,
  action,
  bare = false,
  children,
  className,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  count?: number;
  caption?: React.ReactNode;
  action?: React.ReactNode;
  /**
   * The heading without the card, for a group whose children are cards of
   * their own — a grid of them inside one more surface would be a box in a box.
   */
  bare?: boolean;
}) {
  return (
    <section className="min-w-0" {...props}>
      {/* items-baseline: the title is 17px and a caption or action beside it
          13px, so the two share a baseline rather than centring on each other. */}
      {/* No side padding: the heading starts on the page title's edge. It had
          `px-1`, which set every section heading 4px right of the h1 above
          it — close enough to look like a mistake rather than a choice. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-2.5 pt-2">
        <div className="min-w-0">
          <h2 className="flex items-baseline gap-2 text-title font-semibold text-ink">
            {/* min-w-0 so the truncate actually truncates: on a flex child
                without it the text sets the width and the row grows instead. */}
            <span className="min-w-0 truncate">{title}</span>
            {count != null && (
              // Muted and regular weight, so the count reads as a count of the
              // title rather than the last word of it ("Your students 13"). A
              // capsule did the same job with a second shape on every heading.
              <span className="shrink-0 font-normal tabular-nums text-muted-fg">
                {count}
              </span>
            )}
          </h2>
          {eyebrow && <Eyebrow className="mt-0.5">{eyebrow}</Eyebrow>}
        </div>
        {/* An action carries its own 44px touch target (`ArrowLink` is
            min-h-11), taller than the 30px title it sits beside; with
            `items-end` that pushed the title down 14px and made every section
            that had one start lower than the ones that did not. The negative
            margin gives the target back to the row without shrinking it. */}
        {action ? (
          <div className="-my-2 min-w-0">{action}</div>
        ) : caption ? (
          <p className="text-xs text-muted-fg">{caption}</p>
        ) : null}
      </div>
      {/* The same edge a framed `Table` has, so a table reads the same
          whether it sits in a section or on the page. */}
      <div className={cn(!bare && "overflow-clip rounded-xl bg-surface shadow-sm", className)}>
        {children}
      </div>
    </section>
  );
}
