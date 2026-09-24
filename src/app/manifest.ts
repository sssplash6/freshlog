import type { MetadataRoute } from "next";

/**
 * The installable face of the app — what a home screen icon opens.
 *
 * `standalone` is the whole point: without it, "Add to Home Screen" is a
 * bookmark that opens a browser tab, chrome and all. With it the app gets its
 * own window, its own task-switcher card and no address bar — the difference
 * between a website on the phone and an app on the phone.
 *
 * Icons are PNGs rendered from public/brand/icon.svg by
 * scripts/generate-brand-assets.mjs — the `any` pair keeps its rounded
 * corners, the `maskable` pair is full-bleed blue so Android's crop can take
 * any shape without cutting the mark.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "freshlog",
    short_name: "freshlog",
    description: "Track mentoring hours, sessions and meetings.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/brand/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/brand/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
