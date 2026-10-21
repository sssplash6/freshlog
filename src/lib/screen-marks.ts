/**
 * The marks a person draws on a captured screen, and the arithmetic that
 * keeps them where they were drawn.
 *
 * Everything is in IMAGE pixels, never CSS pixels: the canvas holds the
 * capture at the device's ratio and is shrunk to fit the overlay, so a finger
 * at (160, 90) on a phone is somewhere else entirely in the picture. Marks are
 * stored in the picture's own coordinates and burned into it on Send — a Hide
 * box included, so the pixels under it never leave the device.
 *
 * No DOM at import time: the pure parts are tested in node.
 */

export type Point = { x: number; y: number };

export type Mark =
  | { kind: "pen"; points: Point[] }
  | { kind: "hide"; x: number; y: number; w: number; h: number };

/** A Hide box smaller than this either way is a slip of the finger, not a box. */
export const MIN_HIDE = 4;

/**
 * Past roughly 16.7 million pixels iOS Safari hands back a blank canvas, with
 * no error. A 4K screen at 2× is 33 million.
 */
export const MAX_CANVAS_PIXELS = 16_000_000;

/** Where a pointer is, in the picture, clamped to its edges. */
export function toImagePoint(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  image: { width: number; height: number }
): Point {
  const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));
  return {
    x: clamp(((clientX - box.left) * image.width) / box.width, image.width),
    y: clamp(((clientY - box.top) * image.height) / box.height, image.height),
  };
}

/** A Hide box from wherever the drag started and wherever it is now. */
export function boxFrom(a: Point, b: Point): Extract<Mark, { kind: "hide" }> {
  return {
    kind: "hide",
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** How thick a pen line looks on screen while it is drawn, in CSS pixels. */
const PEN_ON_SCREEN = 3;

/**
 * A pen line in image pixels that reads as 3px on screen, wherever the
 * picture is shown. Sized off the image alone it was 4px on a phone's 3×
 * capture — under one CSS pixel once the overlay shrinks it to fit, too thin
 * for the person drawing to see. Before layout (`shownWidth` 0), 3.
 */
export function penWidth(imageWidth: number, shownWidth: number): number {
  if (!(shownWidth > 0)) return PEN_ON_SCREEN;
  return Math.max(PEN_ON_SCREEN, Math.round((imageWidth / shownWidth) * PEN_ON_SCREEN));
}

/**
 * The device's pixel ratio, unless the capture would be too big a canvas for
 * the device to draw. Floored to two places so rounding can never land just
 * over the limit.
 */
export function captureScale(width: number, height: number, dpr: number): number {
  const fits = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  return Math.min(dpr, Math.floor(fits * 100) / 100);
}

type MarkCanvas = Pick<
  CanvasRenderingContext2D,
  "beginPath" | "moveTo" | "lineTo" | "stroke" | "fillRect" | "save" | "restore"
> & {
  strokeStyle: unknown;
  fillStyle: unknown;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
};

/**
 * Draw the marks over whatever is already on the canvas, in the order they
 * were made. A Hide box is a solid fill at full opacity — anything less would
 * leave the hidden text readable in the sent picture.
 */
export function drawMarks(
  ctx: MarkCanvas,
  marks: Mark[],
  colors: { pen: string; hide: string },
  lineWidth: number
): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const mark of marks) {
    if (mark.kind === "hide") {
      ctx.fillStyle = colors.hide;
      ctx.fillRect(mark.x, mark.y, mark.w, mark.h);
      continue;
    }
    const [first, ...rest] = mark.points;
    if (!first) continue;
    ctx.strokeStyle = colors.pen;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    // A tap is one point: a zero-length line with round caps is a dot.
    for (const p of rest.length ? rest : [first]) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  ctx.restore();
}
