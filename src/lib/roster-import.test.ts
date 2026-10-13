import { describe, expect, it } from "vitest";

import { peopleFromCells, peopleFromText } from "@/lib/roster-import";

describe("peopleFromText", () => {
  it("reads a block copied out of a spreadsheet, with its header", () => {
    const text = [
      "First name\tLast name\tEmail\tFolder",
      "Malika\tRahimova\tMalika@Example.com\thttps://drive.google.com/x",
      "Azim\tEgamberdiev\tazim@example.com\t",
    ].join("\n");
    expect(peopleFromText(text)).toEqual([
      { email: "malika@example.com", first: "Malika", last: "Rahimova", folderUrl: "https://drive.google.com/x" },
      { email: "azim@example.com", first: "Azim", last: "Egamberdiev", folderUrl: "" },
    ]);
  });

  it("reads a CSV with a full-name column and quoted cells", () => {
    const text = 'Name,Email\n"Rahimova, Malika",m@x.uz\nAzim Egamberdiev,a@x.uz\n';
    expect(peopleFromText(text)).toEqual([
      { email: "m@x.uz", first: "Rahimova,", last: "Malika", folderUrl: "" },
      { email: "a@x.uz", first: "Azim", last: "Egamberdiev", folderUrl: "" },
    ]);
  });

  it("reads a semicolon CSV the way a European Excel saves it", () => {
    expect(peopleFromText("Email;First;Last\nm@x.uz;Malika;Rahimova")).toEqual([
      { email: "m@x.uz", first: "Malika", last: "Rahimova", folderUrl: "" },
    ]);
  });

  it("reads a plain list, one person per line, in any order of name and address", () => {
    const text = "Malika Rahimova m@x.uz\na@x.uz, Azim Egamberdiev\nsolo@x.uz";
    expect(peopleFromText(text)).toEqual([
      { email: "m@x.uz", first: "Malika", last: "Rahimova", folderUrl: "" },
      { email: "a@x.uz", first: "Azim", last: "Egamberdiev", folderUrl: "" },
      { email: "solo@x.uz", first: "", last: "", folderUrl: "" },
    ]);
  });

  it("reads the To: line of an email as one person per address", () => {
    const text = 'Malika Rahimova <m@x.uz>, "Azim E." <a@x.uz>; b@x.uz';
    expect(peopleFromText(text).map((p) => [p.email, p.first, p.last])).toEqual([
      ["m@x.uz", "Malika", "Rahimova"],
      ["a@x.uz", "Azim", "E."],
      ["b@x.uz", "", ""],
    ]);
  });

  it("drops blank lines, row numbers and repeats of the same address", () => {
    const text = "1\tMalika\tRahimova\tm@x.uz\n\n2\tMalika\tR\tM@X.UZ\n";
    expect(peopleFromText(text)).toEqual([
      { email: "m@x.uz", first: "Malika", last: "Rahimova", folderUrl: "" },
    ]);
  });

  it("keeps a named row with no address, for the form to ask about", () => {
    expect(peopleFromText("Email\tName\n\tMalika Rahimova")).toEqual([
      { email: "", first: "Malika", last: "Rahimova", folderUrl: "" },
    ]);
  });
});

describe("peopleFromCells", () => {
  it("reads an Excel sheet's cells, numbers and empty cells included", () => {
    const sheet = [
      ["№", "Familiya", "Ism", "Pochta"],
      [1, "Rahimova", "Malika", "m@x.uz"],
      [2, null, null, null],
    ];
    expect(peopleFromCells(sheet)).toEqual([
      { email: "m@x.uz", first: "Malika", last: "Rahimova", folderUrl: "" },
    ]);
  });
});
