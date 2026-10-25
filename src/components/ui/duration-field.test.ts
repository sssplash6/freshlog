import { describe, expect, it } from "vitest";

import { joinMinutes, splitMinutes } from "@/components/ui/duration-field";

describe("splitMinutes", () => {
  it("splits a total into hours and minutes", () => {
    expect(splitMinutes("90")).toEqual({ hours: "1", minutes: "30" });
    expect(splitMinutes(120)).toEqual({ hours: "2", minutes: "0" });
  });

  it("leaves Hours empty under an hour", () => {
    expect(splitMinutes("45")).toEqual({ hours: "", minutes: "45" });
  });

  it("shows nothing for no total or one it cannot read", () => {
    expect(splitMinutes("")).toEqual({ hours: "", minutes: "" });
    expect(splitMinutes(undefined)).toEqual({ hours: "", minutes: "" });
    expect(splitMinutes("1.5")).toEqual({ hours: "", minutes: "" });
  });
});

describe("joinMinutes", () => {
  it("adds hours and minutes into one total", () => {
    expect(joinMinutes({ hours: "1", minutes: "30" })).toBe("90");
    expect(joinMinutes({ hours: "2", minutes: "" })).toBe("120");
  });

  it("takes minutes alone as they were typed", () => {
    expect(joinMinutes({ hours: "", minutes: "90" })).toBe("90");
  });

  it("is empty while both boxes are", () => {
    expect(joinMinutes({ hours: "", minutes: "" })).toBe("");
  });
});
