import { describe, expect, it } from "vitest";

import { agendaMentorOptions } from "@/lib/screens/student-record";

describe("agendaMentorOptions", () => {
  const akmal = { id: "m1", name: "Akmal Karimov", email: "akmal@test.invalid" };
  const list = [{ value: "m2", label: "Umid Rashidov" }];

  it("puts the item's own mentor first when the reader's list lacks them", () => {
    expect(agendaMentorOptions(list, akmal)).toEqual([
      { value: "m1", label: "Akmal Karimov" },
      { value: "m2", label: "Umid Rashidov" },
    ]);
  });

  it("names them for a mentor editing their own item, whose list is empty", () => {
    expect(agendaMentorOptions([], { ...akmal, name: null })).toEqual([
      { value: "m1", label: "akmal@test.invalid" },
    ]);
  });

  it("leaves a list that already holds them, and an item with no mentor, as it is", () => {
    const both = [{ value: "m1", label: "Akmal Karimov" }, ...list];
    expect(agendaMentorOptions(both, akmal)).toEqual(both);
    expect(agendaMentorOptions(list, null)).toEqual(list);
  });
});
