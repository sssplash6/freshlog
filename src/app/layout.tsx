import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components/toaster";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The tab, the home screen and the browser chrome.
 *
 * `icons` is declared here rather than by dropping `icon.svg` into `app/`,
 * which is the other way Next.js will do this. The file convention scatters
 * the brand across two places — an `app/icon.svg` for the tab and a
 * `public/` copy for everything with no bundler (an email header, a PDF
 * guide) — and the pair drifted once already: the retired `app/icon.svg`
 * carried an orange capital F, which is neither the letter nor the colour the
 * wordmark uses. One set of files under `public/brand/`, named here, cannot
 * drift.
 *
 * Two icons because they are read by different things: `favicon.ico` is the
 * 32px raster every browser still asks for first, `icon.svg` is the one that
 * stays sharp on a retina tab and in a bookmark bar.
 */
export const metadata: Metadata = {
  title: "freshlog",
  description: "Track mentoring hours, sessions and meetings.",
  icons: {
    icon: [
      { url: "/brand/favicon.ico", sizes: "32x32" },
      { url: "/brand/icon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    apple: { url: "/brand/apple-touch-icon.png", sizes: "180x180" },
  },
};

/**
 * `theme-color` tints the phone's address bar, which sits directly above this
 * app's header — and that header is `bg-surface` under a `line` hairline. So
 * the bar is `surface` too, and the chrome reads as one continuous white
 * surface. Brand blue up there would be a wash, which is the thing §5.6 rule 7
 * took out of every page below it.
 *
 * On `viewport` and not on `metadata`: `metadata.themeColor` is deprecated as
 * of Next 14 and warns during the build.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#161d26" },
  ],
};

/**
 * Set the theme BEFORE the first paint.
 *
 * Inline and synchronous on purpose: anything deferred — a `useEffect`, a
 * module the bundler splits out — runs after the browser has already painted,
 * so a reader who chose dark gets a full white page first. That flash is the
 * whole reason this is a `<script>` in the document and not a component.
 *
 * A stored choice wins; with none, the operating system decides. Wrapped in
 * try/catch because reading `localStorage` throws outright in a browser set to
 * block site data, and a theme is not worth a blank page.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t!=="dark"&&t!=="light"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
