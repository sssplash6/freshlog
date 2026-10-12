#!/usr/bin/env node
/**
 * Fail on the habits DESIGN.md §1–§2 forbid: explaining a feature in a
 * sentence, and letting a field or a button run the width of the page.
 *
 * The October 2026 audit counted 307 explanatory sentences and 111 controls
 * wider than their content (docs/design/audit-2026-10.md). Both came back one
 * plausible line at a time, so this reads the JSX itself — with the TypeScript
 * parser, not a regex — and refuses:
 *
 *   prose      any string a user can see that runs past six words — a JSX
 *              text run, a string or template literal, a string prop (C1, C3)
 *   label      a `label` prop or a button's text past three words (C3)
 *   placeholder  a placeholder that instructs instead of showing an example (C5)
 *   prop       `hint`, `description`, `explain` — slots that exist to hold a
 *              sentence — and text inside `EmptyState` (C2, C4)
 *   width      `w-full` on a control or button with no `sm:` width after it,
 *              and `inputClasses` / `fieldChrome` outside the primitives (W1, W4)
 *
 * A line that C1 allows — a validation error, a consequence that cannot be
 * undone, a privacy promise — carries `design-allow: <reason>` in a comment on
 * the line above or the same line. Every allow is printed, so they stay
 * visible in review.
 *
 *   node scripts/check-design.mjs [--warn] [--allows] [files…]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN = ["src/app", "src/components"].map((d) => join(ROOT, d));
const WARN = process.argv.includes("--warn");
const SHOW_ALLOWS = process.argv.includes("--allows");
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((f) => resolve(f));

const MAX_WORDS = 6;
const MAX_LABEL_WORDS = 3;

/** The primitives may hold the field chrome; nothing else should. */
const PRIMITIVE = /src\/components\/(ui\/|select\.tsx)/;

/** Attributes whose strings are never read on screen. */
const SILENT_ATTR = new Set([
  "className", "class", "href", "src", "id", "key", "name", "type", "role", "value", "defaultValue",
  "autoComplete", "inputMode", "pattern", "transitionTypes", "style", "target", "rel", "method",
  "action", "htmlFor", "form", "accept", "lang", "dir", "variant", "size", "tone", "severity",
  "measure", "width", "trigger", "align", "side", "aria-label", "aria-labelledby", "aria-describedby",
  "aria-controls", "aria-live", "aria-hidden", "alt", "sizes", "media", "content", "property",
  "pendingText", "data-testid", "unit", "noun", "basePath", "param", "icon",
  "d", "points", "viewBox", "transform", "fill", "stroke", "strokeWidth", "x", "y", "cx", "cy", "r",
  "dateTime", "colSpan", "rowSpan", "scope", "headers", "download", "encType", "capture",
]);
/** Calls whose string arguments are never read on screen. */
const SILENT_CALL = /^(cn|clsx|buttonClasses|console\.\w+|redirect|notFound|require|import|fetch|revalidatePath|revalidateTag|encodeURIComponent|new URL|URLSearchParams|searchParams\.get|params\.get|JSON\.\w+|Error|.*\.(startsWith|endsWith|includes|split|replace|replaceAll|match|test|join|toLocaleString|toLocaleDateString|toLocaleTimeString|padStart|getElementById|querySelector|querySelectorAll|addEventListener|removeEventListener|setAttribute|getAttribute|setItem|getItem|removeItem|prefetch|push|replace))$/;
const PROSE_PROPS = new Set(["hint", "description", "explain"]);
const CONTROLS = new Set([
  "Input", "NameInput", "EmailInput", "Textarea", "GrowingField", "Select", "DateField",
  "input", "textarea", "select",
]);
const BUTTONS = new Set(["Button", "SubmitButton", "LinkButton", "button"]);
const INSTRUCTION = /^(optional|enter|type|write|press|please|tell|describe|explain|keep|add|name the|what|how|anything)\b/i;

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "generated" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/** Words a reader reads: alphabetic tokens, with an expression counting as one. */
function words(text) {
  const tokens = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const prose = tokens.filter((t) => /^[(“"‘']?[A-Za-z][A-Za-z'’]*[)”"’.,;:!?…]*$/.test(t) || t === "{}");
  return { count: prose.length, ratio: tokens.length ? prose.length / tokens.length : 0 };
}
const isProse = (text, max = MAX_WORDS) => {
  const w = words(text);
  return w.count > max && w.ratio >= 0.7;
};

function templateText(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  let s = node.head.text;
  for (const span of node.templateSpans) s += " {} " + span.literal.text;
  return s;
}

function calleeName(call) {
  const e = call.expression;
  if (ts.isNewExpression(call)) return "new " + e.getText();
  return e.getText();
}

const violations = [];
const allows = [];

for (const file of ONLY.length ? ONLY.filter((f) => f.endsWith(".tsx")) : SCAN.flatMap((d) => files(d))) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const rel = relative(ROOT, file);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const allowed = (line) => {
    for (const l of [line, line - 1, line - 2]) {
      const m = lines[l]?.match(/design-allow:\s*([^*}]+)/);
      if (m) return m[1].trim();
    }
    return null;
  };
  const report = (node, rule, detail) => {
    const line = lineOf(node);
    const reason = allowed(line);
    const where = `${rel}:${line + 1}`;
    if (reason) allows.push({ where, rule, reason });
    else violations.push({ where, rule, detail: detail.replace(/\s+/g, " ").trim().slice(0, 110) });
  };

  /** Is this node somewhere a user never reads it? */
  function silent(node) {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
      if (ts.isJsxAttribute(p)) return SILENT_ATTR.has(p.name.getText()) || p.name.getText().startsWith("aria-") || p.name.getText().startsWith("data-");
      if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
        if (SILENT_CALL.test(calleeName(p))) return true;
      }
      if (ts.isThrowStatement(p)) return true;
      if (ts.isPropertyAssignment(p) && /^(className|href|id|key|description|metadata|title)$/.test(p.name.getText()) && ts.isObjectLiteralExpression(p.parent) && p.parent.parent && ts.isVariableDeclaration(p.parent.parent) && /metadata/i.test(p.parent.parent.name.getText())) return true;
      if (ts.isPropertyAssignment(p) && /^(className|href|class)$/.test(p.name.getText())) return true;
      if (ts.isVariableDeclaration(p) && /^(metadata|viewport)$/.test(p.name.getText())) return true;
      if (ts.isFunctionDeclaration(p) && /^generateMetadata$/.test(p.name?.getText() ?? "")) return true;
      if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(p.operatorToken.kind)) return true;
      if (ts.isCaseClause(p) && p.expression === node) return true;
      if (ts.isElementAccessExpression(p)) return true;
    }
    return false;
  }

  function tagName(el) {
    return (ts.isJsxElement(el) ? el.openingElement.tagName : el.tagName).getText();
  }

  /** The text a JSX element shows directly, expressions counted as one word. */
  function ownText(el) {
    let s = "";
    for (const c of el.children) {
      if (ts.isJsxText(c)) s += " " + c.text;
      else if (ts.isJsxExpression(c) && c.expression) {
        const e = c.expression;
        if (ts.isStringLiteral(e)) s += " " + e.text;
        else if (!ts.isJsxElement(e) && !ts.isJsxSelfClosingElement(e)) s += " {}";
      } else s += " | ";
    }
    return s;
  }

  function visit(node) {
    // ── Prose in text runs ───────────────────────────────────────────────
    if (ts.isJsxElement(node) && /\bsr-only\b/.test(node.openingElement.attributes.getText())) {
      // Screen-reader text is never seen; it may say what the eye gets from layout.
      return;
    }
    if (ts.isJsxElement(node)) {
      const tag = tagName(node);
      // Split on child elements: each run of text between them is one thing read.
      for (const run of ownText(node).split(" | ")) {
        if (/[A-Za-z]/.test(run) && isProse(run)) report(node, "prose", run);
      }
      if (BUTTONS.has(tag)) {
        const label = ownText(node).replace(/\|/g, " ");
        if (/[A-Za-z]/.test(label) && words(label).count > MAX_LABEL_WORDS && words(label).ratio >= 0.7) report(node, "label", label);
      }
      if (tag === "EmptyState" && node.children.some((c) => (ts.isJsxText(c) && c.text.trim()) || ts.isJsxExpression(c) || ts.isJsxElement(c))) {
        report(node, "prop", "EmptyState body — the title says what is absent; no sentence under it (C4)");
      }
    }

    // ── String and template literals ─────────────────────────────────────
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && !silent(node)) {
      const t = ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node) ? templateText(node) : node.text;
      // Ignore literals nested in a template we already read.
      if (!(node.parent && ts.isTemplateSpan(node.parent))) {
        if (isProse(t)) report(node, "prose", t);
      }
    }

    // ── Attributes ───────────────────────────────────────────────────────
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText();
      const el = node.parent.parent; // JsxAttributes → opening/self-closing element
      const tag = el.tagName?.getText?.() ?? "";
      const init = node.initializer;
      const str = init && ts.isStringLiteral(init) ? init.text
        : init && ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression)) ? init.expression.text
        : init && ts.isJsxExpression(init) && init.expression && ts.isTemplateExpression(init.expression) ? templateText(init.expression)
        : null;

      if (PROSE_PROPS.has(name) && !/^(aria|data)/.test(name)) {
        report(node, "prop", `\`${name}\` on <${tag}> — a slot for a sentence (C2)`);
      }
      if (name === "label" && str && words(str).count > MAX_LABEL_WORDS && words(str).ratio >= 0.7) {
        report(node, "label", str);
      }
      if (name === "placeholder" && str && (INSTRUCTION.test(str.trim()) || words(str).count > MAX_LABEL_WORDS)) {
        report(node, "placeholder", str);
      }
      const inputType = el.attributes?.properties?.find((a) => a.name?.getText() === "type")?.initializer?.getText().replace(/["{}]/g, "");
      const boxy = tag === "input" && /^(checkbox|radio|hidden|range|color|file)$/.test(inputType ?? "");
      if (name === "className" && (CONTROLS.has(tag) || BUTTONS.has(tag)) && str && !boxy && !PRIMITIVE.test(rel)) {
        const cls = str.split(/\s+/);
        if (cls.includes("w-full") && !cls.some((c) => /^(sm|md|lg):(w-|max-w-)/.test(c))) {
          report(node, "width", `w-full on <${tag}> with no sm: width (W1/W4) — use measure, or sm:w-auto`);
        }
        if (CONTROLS.has(tag) && cls.some((c) => /^(sm:|md:|lg:)?(w|max-w|min-w)-/.test(c) && c !== "min-w-0")) {
          report(node, "width", `width class on <${tag}> — pass measure instead (W1)`);
        }
      }
    }

    // ── Raw field chrome outside the primitives ──────────────────────────
    if (ts.isIdentifier(node) && /^(inputClasses|fieldChrome)$/.test(node.text) && !PRIMITIVE.test(rel)
        && !(node.parent && (ts.isImportSpecifier(node.parent)))) {
      report(node, "width", `${node.text} outside the primitives — use Input/Select/DateField with measure (W1)`);
    }

    ts.forEachChild(node, visit);
  }
  visit(sf);
}

if (SHOW_ALLOWS || allows.length) {
  console.log(`check-design: ${allows.length} allowed line(s)`);
  for (const a of allows) console.log(`  allow  ${a.where}  [${a.rule}] ${a.reason}`);
}
for (const v of violations) console.log(`${v.where}  [${v.rule}]  ${v.detail}`);
if (violations.length === 0) {
  console.log("check-design: no helper prose, no unmeasured fields");
  process.exit(0);
}
const by = violations.reduce((m, v) => ((m[v.rule] = (m[v.rule] ?? 0) + 1), m), {});
console.log(`\ncheck-design: ${violations.length} violation(s) — ` + Object.entries(by).map(([k, n]) => `${k} ${n}`).join(", ") + "\nRead DESIGN.md §1–§2. A sentence a feature needs to be understood means the label or the layout is wrong.");
process.exit(WARN ? 0 : 1);
