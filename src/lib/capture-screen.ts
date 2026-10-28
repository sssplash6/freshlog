import { captureScale } from "@/lib/screen-marks";

/** Long enough for a heavy roster on a slow phone; past it, the fallback. */
export const CAPTURE_TIMEOUT_MS = 10_000;

/**
 * What is on screen right now, as a canvas at the device's pixel ratio (or
 * less, when that would be too big a canvas to draw).
 *
 * `modern-screenshot` redraws the page through SVG `foreignObject`, so the
 * browser itself resolves the theme's `oklch()` colours and the self-hosted
 * fonts. It is imported here, on the press, so no page carries it until
 * somebody reports something.
 *
 * The body is rendered at the window's size and moved up by however far the
 * window is scrolled, so the picture is the visible part of the page, not its
 * top. Anything carrying `data-capture-skip` — the overlay, the toasts — is
 * left out. Browser only.
 */
export async function captureViewport(): Promise<HTMLCanvasElement> {
  // Read before anything is awaited: the window as it was when pressed.
  const width = window.innerWidth;
  const height = window.innerHeight;
  const { scrollX, scrollY } = window;
  // The import is inside the race. On a slow phone the library's chunk is the
  // part most likely to stall, and the fallback must not wait on it either.
  const capture = (async () => {
    const { domToCanvas } = await import("modern-screenshot");
    return domToCanvas(document.body, {
      width,
      height,
      scale: captureScale(width, height, window.devicePixelRatio || 1),
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      filter: (node) => !(node instanceof Element && node.hasAttribute("data-capture-skip")),
      // `margin: 0` although the body already has it: the copy is laid out with
      // the browser's default 8px body margin otherwise, and the whole picture
      // sat 8px to the right of the page (seen in WebKit at phone size).
      style: { margin: "0", position: "relative", top: `${-scrollY}px`, left: `${-scrollX}px` },
      features: { restoreScrollPosition: true },
      timeout: CAPTURE_TIMEOUT_MS,
    });
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The page took too long to capture.")), CAPTURE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([capture, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
