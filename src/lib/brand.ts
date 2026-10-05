/**
 * The palette, once, as values.
 *
 * `globals.css` is the app's source of truth for colour and every component
 * reads it through a Tailwind token. Two consumers cannot: an email client
 * never sees our stylesheet, so `email/layout.ts` must inline real hex, and
 * `docs/guides/generate-guides.cjs` renders PDFs outside the bundle. Both had
 * hand-copied their own hexes, and the guides had drifted to a different ink
 * (#1f2937) and line (#e5e7eb) than the app's.
 *
 * So the hex lives here, and `globals.css` and this file are the two halves of
 * one palette that must be edited together. Keeping them in step by hand is
 * the cost of Tailwind 4's CSS-first tokens; a generated stylesheet would
 * remove it and is not worth the build step for eleven values.
 *
 * Only colours with more than one consumer belong here. A token used solely by
 * components stays in `globals.css`.
 */
export const BRAND = {
  /** Structural chrome, links, primary action. */
  brand: "#124b84",
  brandDark: "#0e3c6a",
  brandSoft: "#e7eef5",

  /** Hours and progress. Fills and large readouts only — never body text. */
  accent: "#f18d05",

  /** Text: primary, then secondary. */
  ink: "#1c1c1e",
  muted: "#63636a",

  /** Borders and the two grounds. */
  line: "#e5e5ea",
  canvas: "#f2f2f7",
  surface: "#ffffff",

  /**
   * Attention — something needs doing, nothing is lost yet. A dark amber for
   * TEXT, deliberately not the bright accent: #f18d05 on white is 2.46:1 and
   * fails at body size, and outside the app there is no 42px stat to carry it.
   */
  warnInk: "#8a5a08",

  /** A problem — hours lost, balance negative. */
  dangerInk: "#b42318",

  /**
   * Identity, three muted hues. Assigned per person, never per program: a
   * program is a place, not a face. Each reads apart from brand blue, accent
   * orange and danger red, and `ink` on `soft` clears 6:1 in all three.
   */
  tones: [
    { name: "teal", soft: "#dcefe6", ink: "#175f4a", dot: "#2a7a5f" },
    { name: "plum", soft: "#f1e6ef", ink: "#6f2d68", dot: "#8f4b88" },
    { name: "moss", soft: "#e8eedb", ink: "#485c1c", dot: "#55701f" },
  ],
} as const;

export type ToneName = (typeof BRAND.tones)[number]["name"];
