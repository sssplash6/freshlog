import { describe, expect, it } from "vitest";

import {
  PROGRAM_SLOTS,
  nextColorIndex,
  programColorVar,
  programSlot,
  programTone,
} from "@/lib/program-tone";

describe("nextColorIndex", () => {
  it("gives the first program the first slot", () => {
    expect(nextColorIndex([])).toBe(0);
  });

  it("takes the first slot nobody holds, not the next after the highest", () => {
    // Global took 0, the Master's took 1, a program on 2 was archived.
    expect(nextColorIndex([0, 1, 3])).toBe(2);
  });

  it("gives five programs five different colours", () => {
    const held: number[] = [];
    for (let i = 0; i < 5; i++) held.push(nextColorIndex(held));
    expect(new Set(held).size).toBe(5);
  });

  it("once all eight are held, reuses the least-held slot", () => {
    const held = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2];
    expect(nextColorIndex(held)).toBe(3);
  });

  it("folds out-of-range stored values into a slot rather than miscounting", () => {
    expect(nextColorIndex([8, 1])).toBe(2);
  });
});

describe("programTone", () => {
  it("is the stored slot, whatever the id", () => {
    const a = programTone({ id: "a", colorIndex: 3 });
    const b = programTone({ id: "zzz", colorIndex: 3 });
    expect(a).toEqual(b);
    expect(a.badge).toBe("bg-prog-green-dot");
  });

  it("gives every slot its own hue", () => {
    const badges = Array.from({ length: PROGRAM_SLOTS }, (_, i) =>
      programTone({ id: "p", colorIndex: i }).badge
    );
    expect(new Set(badges).size).toBe(PROGRAM_SLOTS);
  });

  it("never crashes on a hand-edited slot", () => {
    expect(programSlot({ id: "p", colorIndex: -1 })).toBe(PROGRAM_SLOTS - 1);
    expect(programSlot({ id: "p", colorIndex: 11 })).toBe(3);
    expect(programSlot({ id: "p", colorIndex: Number.NaN })).toBe(0);
  });

  it("names the same colour for SVG as the dot class", () => {
    expect(programColorVar({ id: "p", colorIndex: 4 })).toBe("var(--color-prog-magenta-dot)");
  });
});
