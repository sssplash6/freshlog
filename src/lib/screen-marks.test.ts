import { describe, expect, it } from "vitest";

import {
  boxFrom,
  captureScale,
  drawMarks,
  penWidth,
  toImagePoint,
  type Mark,
} from "@/lib/screen-marks";

describe("toImagePoint", () => {
  it("maps a pointer on a half-size canvas to full-size pixels", () =>
    expect(
      toImagePoint(160, 90, { left: 10, top: 40, width: 400, height: 250 }, { width: 800, height: 500 })
    ).toEqual({ x: 300, y: 100 }));

  it("clamps a pointer dragged off the canvas to its edge", () =>
    expect(
      toImagePoint(-50, 999, { left: 0, top: 0, width: 400, height: 250 }, { width: 800, height: 500 })
    ).toEqual({ x: 0, y: 500 }));
});

describe("boxFrom", () => {
  it("makes a box from any two corners", () =>
    expect(boxFrom({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ kind: "hide", x: 10, y: 20, w: 40, h: 60 }));
});

describe("captureScale", () => {
  it("keeps the device ratio while the canvas fits", () => expect(captureScale(1440, 900, 2)).toBe(2));

  it("caps a 4K screen at 2x under the canvas limit", () => {
    const s = captureScale(3840, 2160, 2);
    expect(s).toBeLessThan(2);
    expect(3840 * 2160 * s * s).toBeLessThanOrEqual(16_000_000);
  });
});

describe("penWidth", () => {
  it("is 3px on screen however small the picture is shown", () => {
    // A 390px phone at 3x, shown 217px wide in the overlay.
    expect(penWidth(1170, 217)).toBe(16);
    // A 1024px window at 2x, shown 593px wide.
    expect(penWidth(2048, 593)).toBe(10);
  });

  it("is never thinner than 3 image pixels", () => expect(penWidth(600, 900)).toBe(3));

  it("falls back to 3 when the canvas has not been laid out", () => expect(penWidth(1170, 0)).toBe(3));
});

describe("drawMarks", () => {
  /** A context that writes down what was drawn, and with which colour and alpha. */
  function recorder() {
    const calls: string[] = [];
    const ctx = {
      strokeStyle: "" as unknown,
      fillStyle: "" as unknown,
      lineWidth: 0,
      lineCap: "butt" as CanvasLineCap,
      lineJoin: "miter" as CanvasLineJoin,
      globalAlpha: 0.5,
      beginPath: () => calls.push("beginPath"),
      moveTo: (x: number, y: number) => calls.push(`moveTo(${x},${y})`),
      lineTo: (x: number, y: number) => calls.push(`lineTo(${x},${y})`),
      stroke: () => calls.push(`stroke(${String(ctx.strokeStyle)},w${ctx.lineWidth},${ctx.lineCap})`),
      fillRect: (x: number, y: number, w: number, h: number) =>
        calls.push(`fillRect(${x},${y},${w},${h},${String(ctx.fillStyle)},a${ctx.globalAlpha})`),
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
    };
    return { ctx, calls };
  }

  it("fills a hide box opaquely, in the order the marks were made", () => {
    const { ctx, calls } = recorder();
    const marks: Mark[] = [
      { kind: "pen", points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
      { kind: "hide", x: 10, y: 20, w: 40, h: 60 },
    ];

    drawMarks(ctx, marks, { pen: "pen-colour", hide: "hide-colour" }, 3);

    const drawn = calls.filter((c) => /^(moveTo|lineTo|stroke|fillRect)/.test(c));
    expect(drawn).toEqual([
      "moveTo(1,2)",
      "lineTo(3,4)",
      "stroke(pen-colour,w3,round)",
      "fillRect(10,20,40,60,hide-colour,a1)",
    ]);
  });

  it("draws a single-point pen mark as a dot, not nothing", () => {
    const { ctx, calls } = recorder();
    drawMarks(ctx, [{ kind: "pen", points: [{ x: 5, y: 5 }] }], { pen: "p", hide: "h" }, 3);
    expect(calls.filter((c) => c.startsWith("stroke"))).toHaveLength(1);
    expect(calls.some((c) => c.startsWith("lineTo(5,5)"))).toBe(true);
  });
});
