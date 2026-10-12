/**
 * Shared 24-viewBox stroke icons; size with h-/w- classes.
 *
 * ONE LINE WEIGHT AT EVERY SIZE. A 2-unit stroke in a 24-unit box scales with
 * the icon, so the same set rendered at 0.83px (a 10px glyph) up to 1.67px (a
 * 20px nav icon) — six weights side by side in one sidebar (October 2026).
 * `data-icon` opts every shape into `vector-effect: non-scaling-stroke`
 * (globals.css), so `strokeWidth` is in screen pixels: 1.5px, whatever the
 * icon's size.
 */

function Svg({
  children,
  className,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  "data-chev"?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon=""
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4 12h16" />
      <path d="m13 5 7 7-7 7" />
    </Svg>
  );
}

/**
 * The bell. Drawn here rather than inline in the chrome, because the same
 * glyph now labels the section on every home — the bell in the top bar and
 * the bell on the heading are the same thing, and a reader who taps one and
 * lands on the other must recognise it.
 */
export function BellIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
    </Svg>
  );
}

/** Two sparks — "something new", for the changelog link in the top corner. */
export function SparklesIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M9.5 4.5 11 9l4.5 1.5L11 12l-1.5 4.5L8 12 3.5 10.5 8 9l1.5-4.5Z" />
      <path d="m17.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
    </Svg>
  );
}

export function CrownIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m3 7 4 4 5-7 5 7 4-4-2 12H5L3 7Z" />
      <path d="M5 19h14" />
    </Svg>
  );
}

export function SunIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </Svg>
  );
}

export function MoonIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </Svg>
  );
}

export function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M20 12H4" />
      <path d="m11 19-7-7 7-7" />
    </Svg>
  );
}

export function ArrowUpRightIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </Svg>
  );
}

export function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  );
}

/** The row-edge "this drills in" mark — the iOS cell chevron, not an arrow. */
export function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <Svg className={className} data-chev>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  );
}

/** A state that wants attention, or a problem. Same glyph, tone tells them apart. */
export function AlertIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </Svg>
  );
}

/** Something worth knowing that blocks nothing. */
export function InfoIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </Svg>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

export function PencilIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}

export function MoreVerticalIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </Svg>
  );
}

/** The tab bar's overflow slot — the fifth destination and beyond. */
export function MoreHorizontalIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </Svg>
  );
}

export function LogOutIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Svg>
  );
}

/** Paper-plane / send glyph — used for the Telegram handle button. */
export function SendIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4Z" />
    </Svg>
  );
}

/** Tabbed folder glyph — the student-folder link button. */
export function FolderIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.7.9l.8 1.1H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Svg>
  );
}

/** Filled star (rating control), unlike the stroke icons above. */
export function StarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 2.5c.3 0 .58.17.71.45l2.6 5.27 5.82.85c.65.09.9.89.44 1.34l-4.21 4.1 1 5.8a.79.79 0 0 1-1.15.83L12 18.4l-5.2 2.74a.79.79 0 0 1-1.15-.83l.99-5.8-4.21-4.1a.79.79 0 0 1 .44-1.34l5.82-.85 2.6-5.27a.79.79 0 0 1 .71-.45Z" />
    </svg>
  );
}

export function SearchIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

/** Calendar page — a meeting that hasn't happened yet. */
export function CalendarIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
    </Svg>
  );
}

/** Rising bars — hours over time. */
export function ChartIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4 20h16" />
      <path d="M7 16v-4M12 16V8M17 16V5" />
    </Svg>
  );
}

/** Chain link — where a meeting happens. */
export function LinkIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.2-1.2" />
    </Svg>
  );
}

/*
 * The nav's own set. Minimal on purpose: these sit at 16px beside a word that
 * already says what the place is, so their whole job is to give the eye a
 * shape to aim at down a column of labels — not to carry the meaning alone.
 */

/** Whatever is waiting for you. */
export function InboxIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M3 13h4l2 3h6l2-3h4" />
      <path d="M5 5h14l2 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z" />
    </Svg>
  );
}

/** A roster — more than one person. */
export function UsersIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16.5 5.5a3.2 3.2 0 0 1 0 5.4M17 14.5a6 6 0 0 1 4 5.5" />
    </Svg>
  );
}

/** One person, doing the work. */
export function UserIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Svg>
  );
}

/** A program: things stacked into one thing. */
export function LayersIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m12 3 8 4.5-8 4.5-8-4.5z" />
      <path d="m4 12.5 8 4.5 8-4.5" />
      <path d="m4 17 8 4.5 8-4.5" />
    </Svg>
  );
}

/** Everything about the reader themself. */
export function GearIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </Svg>
  );
}

/** A student's own front page. */
export function HomeIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.8V20h12V9.8" />
    </Svg>
  );
}

/** The rail, open or shut. */
export function PanelIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16" />
    </Svg>
  );
}

/** Add one of whatever the surface is a list of. */
export function PlusIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  );
}

/** Dismiss. Never "delete" — the only thing it removes is a row from a list. */
export function XIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

/** A flag on a pole: report something. */
export function FlagIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </Svg>
  );
}
