"use client";

import { useEffect } from "react";

/**
 * Lands on `id` when the page was opened at `#id`.
 *
 * A page that streams in puts its content in place after the browser has
 * looked for the anchor, so a link opened in a new tab, or pasted, stayed at
 * the top of the page. A link followed inside the app is scrolled by the
 * router; this lands it on the same element, and respects its `scroll-mt`.
 */
export function ScrollToAnchor({ id }: { id: string }) {
  useEffect(() => {
    if (window.location.hash === `#${id}`) {
      document.getElementById(id)?.scrollIntoView();
    }
  }, [id]);
  return null;
}
