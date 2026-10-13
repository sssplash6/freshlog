/**
 * People out of a list somebody already has: a column copied from a
 * spreadsheet, a CSV, the To: line of an email, or the first sheet of an
 * Excel file. Pure and client-safe, so the add forms can fill their rows
 * before anything is sent, and the admin reads every row before it is added.
 *
 * It only ever fills rows. Whether an address is valid, already registered or
 * already in the program is still the action's to say, so a list that
 * guessed wrong costs a correction, never an account.
 */

export type ImportedPerson = {
  email: string;
  first: string;
  last: string;
  folderUrl: string;
};

/** An address inside other text: "Malika <malika@x.uz>", "mailto:a@b.co". */
const EMAIL_IN = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[^\s<>,;:"'()[\]]+/;
const URL_LIKE = /^(https?:\/\/|www\.|drive\.google\.|docs\.google\.)/i;

/** Which column a header names. Uzbek and Russian too: the lists are local. */
const HEADER: { key: keyof ImportedPerson | "name"; re: RegExp }[] = [
  { key: "email", re: /e-?mail|pochta|почта/i },
  { key: "first", re: /first|given|^ism$|^имя$/i },
  { key: "last", re: /last|surname|family|familiya|фамилия/i },
  { key: "folderUrl", re: /folder|link|drive|url|papka|папка|ссылка/i },
  { key: "name", re: /name|ism|f\.?\s?i\.?\s?o|фио|имя/i },
];

/**
 * Text into rows of cells. A tab means it came from a spreadsheet, and only a
 * tab separates; otherwise a comma or a semicolon, whichever the text uses
 * more, with quotes kept together as a CSV writes them.
 */
export function splitRows(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.some((l) => l.includes("\t"))) {
    return lines.map((l) => l.split("\t"));
  }
  const commas = (text.match(/,/g) ?? []).length;
  const semis = (text.match(/;/g) ?? []).length;
  const sep = semis > commas ? ";" : ",";
  return csv(text.replace(/\r\n?/g, "\n"), sep);
}

function csv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

const clean = (cell: unknown): string =>
  cell == null || typeof cell === "boolean" || cell instanceof Date
    ? ""
    : String(cell).replace(/\s+/g, " ").trim();

/** "Malika Rahimova" → Malika / Rahimova; one word stays a first name. */
function splitName(full: string): { first: string; last: string } {
  const words = full.split(" ").filter(Boolean);
  return { first: words[0] ?? "", last: words.slice(1).join(" ") };
}

/** The name around an address in one cell: `"Malika R" <m@x.uz>` → Malika R. */
function nameBeside(cell: string, email: string): string {
  return cell
    .replace(email, "")
    .replace(/mailto:/gi, "")
    .replace(/[<>"()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A row number or a tick, not a name: "1", "12.", "✓". */
const NOT_A_NAME = /^[\d.#№\s✓✔x-]*$/i;

/** Every address in a cell, so "a@x.uz; b@x.uz" can be split where it stands. */
const EMAILS_IN = new RegExp(EMAIL_IN.source, "g");

function fromHeaderless(input: string[]): ImportedPerson[] {
  // A cell holding two addresses was a list in a separator this text did not
  // split on — "a@x.uz; b@x.uz" in a comma list — so it is split on both.
  const row = input.flatMap((c) =>
    (c.match(EMAILS_IN)?.length ?? 0) > 1 ? c.split(/[;,]/).map((x) => x.trim()) : [c]
  );
  const withEmail = row.filter((c) => EMAIL_IN.test(c));
  // One line, several addresses — the To: line of an email, or a column
  // pasted as one comma-separated line. Each address is a person, named by
  // whatever stands beside it in its own cell.
  if (withEmail.length > 1) {
    return withEmail.map((cell) => {
      const email = cell.match(EMAIL_IN)![0];
      return { email, ...splitName(nameBeside(cell, email)), folderUrl: "" };
    });
  }
  let email = "";
  let folderUrl = "";
  const names: string[] = [];
  for (const cell of row) {
    const found = cell.match(EMAIL_IN);
    if (found && !email && !URL_LIKE.test(cell)) {
      email = found[0];
      const rest = nameBeside(cell, email);
      if (rest) names.push(rest);
    } else if (URL_LIKE.test(cell) && !folderUrl) {
      folderUrl = cell;
    } else if (cell && !NOT_A_NAME.test(cell)) {
      names.push(cell);
    }
  }
  // Two cells are a first and a last name, in that order; one is split at its
  // first space. A surname-first list comes out backwards — the rows are
  // there to be read before they are added.
  const { first, last } =
    names.length >= 2
      ? { first: names[0], last: names.slice(1).join(" ") }
      : splitName(names[0] ?? "");
  return [{ email, first, last, folderUrl }];
}

/**
 * Rows of cells into people. A first row with no address in it and a word
 * like "Email" or "Name" is a header, and the columns are read by it;
 * otherwise each row is read by what its cells look like.
 */
export function peopleFromCells(input: readonly (readonly unknown[])[]): ImportedPerson[] {
  const rows = input
    .map((r) => r.map(clean))
    .filter((r) => r.some((c) => c !== ""));
  if (rows.length === 0) return [];

  const head = rows[0];
  const columns = new Map<keyof ImportedPerson | "name", number>();
  if (!head.some((c) => EMAIL_IN.test(c))) {
    head.forEach((cell, i) => {
      const hit = HEADER.find((h) => h.re.test(cell) && !columns.has(h.key));
      if (hit) columns.set(hit.key, i);
    });
  }
  const byHeader = columns.has("email") || columns.has("name") || columns.has("first");
  const body = byHeader ? rows.slice(1) : rows;

  const people = body.flatMap((row): ImportedPerson[] => {
    if (!byHeader) return fromHeaderless(row);
    const at = (k: keyof ImportedPerson | "name") => {
      const i = columns.get(k);
      return i === undefined ? "" : (row[i] ?? "");
    };
    const rawEmail = at("email");
    const email = rawEmail.match(EMAIL_IN)?.[0] ?? (columns.has("email") ? rawEmail : "");
    const split = splitName(at("name"));
    return [
      {
        email,
        first: at("first") || split.first,
        last: at("last") || split.last,
        folderUrl: at("folderUrl"),
      },
    ];
  });

  // The same address twice is one person; the first row that names them wins.
  const seen = new Set<string>();
  return people
    .map((p) => ({ ...p, email: p.email.toLowerCase() }))
    .filter((p) => {
      if (!p.email && !p.first && !p.last) return false;
      if (!p.email) return true;
      if (seen.has(p.email)) return false;
      seen.add(p.email);
      return true;
    });
}

/** Pasted text, or a CSV or text file's contents, into people. */
export function peopleFromText(text: string): ImportedPerson[] {
  return peopleFromCells(splitRows(text));
}
