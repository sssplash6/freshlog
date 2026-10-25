import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every handler under /api/v1 gates itself on its first line.
 *
 * The proxy lets /api/v1 through without its cookie check (src/proxy.ts), so a
 * handler's first line is the only gate it has, and a route that forgot it
 * would answer anybody. This reads each route the way the compiler does and
 * holds every exported handler to one of three openings:
 *
 * - the user gate, which is three statements, exactly:
 *     const user = await getCurrentUser();
 *     if (!user) return signInAgain();
 *     if (user.status !== "ACTIVE") return inactive();
 * - `if (!devLoginEnabled(request)) return …`, about the handler's own request
 * - a place on UNGATED below, under the comment that says why
 *
 * The third statement is what keeps an account that isn't active yet out. A
 * PENDING student and an UNASSIGNED mentor sign in like anyone, `getCurrentUser`
 * finds them by their token, and no gate in src/lib/dal.ts looks at `status`. A
 * handler that serves them on purpose opens with the first statement alone and
 * goes on ANY_STATUS below, with the reason.
 *
 * A handler is written `export async function GET(…)`. One exported any other
 * way (`export const GET = …`, `export { get as GET }`) cannot be read here, so
 * it is refused, and so is any file here that is neither a route.ts nor a test.
 */

const ROOT = dirname(fileURLToPath(import.meta.url));

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/**
 * The handlers that open with no gate, because they are the sign-in itself, and
 * the words the comment above their first line starts with. A handler joins
 * this list only with a comment of its own that says why it needs no session.
 */
const UNGATED: Record<string, string> = {
  "auth/token POST": "This route is the sign-in itself",
  "auth/signout POST": "This ends a sign-in",
};

/**
 * Handlers that open with the user gate but serve accounts that aren't active
 * yet, and why. The check asks only that they open with `const user = await
 * getCurrentUser();`; what follows is theirs (auth/start sends a signed-out
 * request to Google, not back to sign in again).
 */
const ANY_STATUS: Record<string, string> = {
  "me GET": "how a person who isn't active yet learns what they are waiting for",
  "auth/start GET": "the sign-in itself, which an account that isn't active yet still goes through",
  "onboarding GET": "the form a person who isn't active yet fills in before they can be",
  "onboarding POST": "the answer to that form, which is how a pending account gets as far as waiting",
};

const isExported = (node: ts.HasModifiers) =>
  ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;

/** Every name a declaration binds: `GET`, or each one in `{ GET, POST }` and `[GET]`. */
const namesIn = (name: ts.BindingName): string[] =>
  ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : namesIn(element.name)));

/** `const user = await getCurrentUser();` */
function isUserGate(statement: ts.Statement): boolean {
  if (!ts.isVariableStatement(statement)) return false;
  const { flags, declarations } = statement.declarationList;
  // Exactly `const`: `let` and `await using` set other bits.
  if ((flags & ts.NodeFlags.BlockScoped) !== ts.NodeFlags.Const || declarations.length !== 1) return false;
  const [{ name, initializer }] = declarations;
  return (
    ts.isIdentifier(name) &&
    name.text === "user" &&
    initializer !== undefined &&
    ts.isAwaitExpression(initializer) &&
    ts.isCallExpression(initializer.expression) &&
    ts.isIdentifier(initializer.expression.expression) &&
    initializer.expression.expression.text === "getCurrentUser" &&
    initializer.expression.arguments.length === 0
  );
}

/** `if (!devLoginEnabled(request)) return …`, about the handler's own request, with no else. */
function isDevGate(statement: ts.Statement, handler: ts.FunctionDeclaration): boolean {
  const request = handler.parameters[0]?.name;
  if (!ts.isIfStatement(statement) || statement.elseStatement || !request || !ts.isIdentifier(request)) return false;
  const { expression: test, thenStatement } = statement;
  if (!ts.isPrefixUnaryExpression(test) || test.operator !== ts.SyntaxKind.ExclamationToken) return false;
  const call = test.operand;
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "devLoginEnabled" &&
    call.arguments.length === 1 &&
    ts.isIdentifier(call.arguments[0]) &&
    call.arguments[0].text === request.text &&
    ts.isReturnStatement(thenStatement) &&
    thenStatement.expression !== undefined
  );
}

/** `user`, the name the user gate gives the account. */
const isUser = (node: ts.Node) => ts.isIdentifier(node) && node.text === "user";

/** `return name();`: that call, with no arguments, and returned. */
function returnsCall(statement: ts.Statement, name: string): boolean {
  return (
    ts.isReturnStatement(statement) &&
    statement.expression !== undefined &&
    ts.isCallExpression(statement.expression) &&
    ts.isIdentifier(statement.expression.expression) &&
    statement.expression.expression.text === name &&
    statement.expression.arguments.length === 0
  );
}

/** `if (!user) return signInAgain();`, with no else. */
function isSignedOutGate(statement: ts.Statement): boolean {
  if (!ts.isIfStatement(statement) || statement.elseStatement) return false;
  const { expression: test, thenStatement } = statement;
  return (
    ts.isPrefixUnaryExpression(test) &&
    test.operator === ts.SyntaxKind.ExclamationToken &&
    isUser(test.operand) &&
    returnsCall(thenStatement, "signInAgain")
  );
}

/** `if (user.status !== "ACTIVE") return inactive();`, with no else. */
function isInactiveGate(statement: ts.Statement): boolean {
  if (!ts.isIfStatement(statement) || statement.elseStatement) return false;
  const { expression: test, thenStatement } = statement;
  return (
    ts.isBinaryExpression(test) &&
    test.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    ts.isPropertyAccessExpression(test.left) &&
    // Not `user?.status`: it means the same here, but it is not the line every handler has.
    test.left.questionDotToken === undefined &&
    isUser(test.left.expression) &&
    test.left.name.text === "status" &&
    ts.isStringLiteral(test.right) &&
    test.right.text === "ACTIVE" &&
    returnsCall(thenStatement, "inactive")
  );
}

/** The comment right above `node`, without its `//` marks. */
const commentAbove = (node: ts.Node, source: ts.SourceFile) =>
  (ts.getLeadingCommentRanges(source.text, node.pos) ?? [])
    .map((range) => source.text.slice(range.pos, range.end).replace(/^\/\/ ?/, "").trim())
    .join(" ");

/**
 * The handlers that `text`, the route at `where`, exports, and what is wrong
 * with them: a handler exported other than as a function declaration, or one
 * that does not open with a gate. A user gate that is not on ANY_STATUS must be
 * followed by the other two statements, in order.
 */
function check(where: string, text: string): { handlers: string[]; problems: string[] } {
  const source = ts.createSourceFile(`${where}/route.ts`, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const handlers: string[] = [];
  const problems: string[] = [];
  const refuse = (problem: string) => problems.push(`${where}: ${problem}`);
  const declareIt = (name: string) => `write it as \`export async function ${name}(…)\``;
  const said = (statement: ts.Statement) => statement.getText(source).split("\n")[0];

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && METHODS.has(statement.name.text) && isExported(statement)) {
      const name = statement.name.text;
      const label = `${where} ${name}`;
      handlers.push(label);
      const body = statement.body?.statements;
      const first = body?.[0];
      const why = UNGATED[label];
      if (why !== undefined) {
        if (!first || !commentAbove(first, source).startsWith(why)) {
          refuse(`${name} is on UNGATED, so it must open under a comment that starts "${why}"`);
        }
      } else if (!first || !(isUserGate(first) || isDevGate(first, statement))) {
        refuse(`${name} does not open with a gate: ${first ? said(first) : "it is empty"}`);
      } else if (isUserGate(first) && ANY_STATUS[label] === undefined) {
        const second = body?.[1];
        const third = body?.[2];
        if (!second || !isSignedOutGate(second)) {
          refuse(`${name} must follow the user gate with \`if (!user) return signInAgain();\`, and has: ${second ? said(second) : "nothing"}`);
        } else if (!third || !isInactiveGate(third)) {
          refuse(
            `${name} must follow that with \`if (user.status !== "ACTIVE") return inactive();\`, or be on ANY_STATUS, and has: ${third ? said(third) : "nothing"}`
          );
        }
      }
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const name of statement.declarationList.declarations.flatMap((declaration) => namesIn(declaration.name))) {
        if (METHODS.has(name)) refuse(`${name} is exported as a variable; ${declareIt(name)}`);
      }
    } else if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (!clause) refuse("`export *` hides which handlers it exports");
      else if (ts.isNamespaceExport(clause)) {
        if (METHODS.has(clause.name.text)) refuse(`${clause.name.text} is exported as a namespace; ${declareIt(clause.name.text)}`);
      } else {
        for (const { name } of clause.elements) {
          if (METHODS.has(name.text)) refuse(`${name.text} is exported by name; ${declareIt(name.text)}`);
        }
      }
    }
  }
  return { handlers, problems };
}

/** Every file under `dir`, at any depth. */
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]
  );

/** Where a route lives, as its handlers are named here: "auth/token", or "." for /api/v1 itself. */
const whereOf = (file: string) => relative(ROOT, dirname(file)).split(sep).join("/") || ".";

const files = filesUnder(ROOT).filter((file) => !/\.test\.tsx?$/.test(file));
const routes = files
  .filter((file) => basename(file) === "route.ts")
  .map((file) => check(whereOf(file), readFileSync(file, "utf8")));
const handlers = routes.flatMap((route) => route.handlers);

describe("/api/v1", () => {
  it("holds nothing but route.ts files and their tests, so no route escapes this check", () => {
    expect(files.filter((file) => basename(file) !== "route.ts").map((file) => relative(ROOT, file))).toEqual([]);
  });

  it("exports every handler as a function declaration that opens with a gate", () => {
    expect(handlers.length).toBeGreaterThan(0);
    expect(routes.flatMap((route) => route.problems)).toEqual([]);
  });

  it("lists on UNGATED only handlers that are there", () => {
    expect(Object.keys(UNGATED).filter((label) => !handlers.includes(label))).toEqual([]);
  });

  it("lists on ANY_STATUS only handlers that are there", () => {
    expect(Object.keys(ANY_STATUS).filter((label) => !handlers.includes(label))).toEqual([]);
  });
});

describe("the check itself", () => {
  const GATE = 'const user = await getCurrentUser();\n  if (!user) return signInAgain();\n  if (user.status !== "ACTIVE") return inactive();';

  it.each([
    ["the full three-statement gate", "x GET", `export async function GET() {\n  ${GATE}\n  return ok(1);\n}`],
    [
      "the dev-login guard",
      "x POST",
      'export async function POST(request: Request) {\n  if (!devLoginEnabled(request)) return refused("Not found.", 404);\n  return ok(1);\n}',
    ],
  ])("takes %s", (_, label, text) => {
    expect(check("x", text)).toEqual({ handlers: [label], problems: [] });
  });

  it.each([
    ["no gate", "export async function GET() {\n  return ok(await prisma.user.findMany());\n}"],
    ["a gate on the second line", "export async function GET() {\n  const a = 1;\n  const user = await getCurrentUser();\n  return ok(a);\n}"],
    ["a gate that is not awaited", "export async function GET() {\n  const user = getCurrentUser();\n  return ok(user);\n}"],
    ["a gate held in a let", "export async function GET() {\n  let user = await getCurrentUser();\n  return ok(user);\n}"],
    ["no body to open", "export async function GET() {}"],
    ["the dev-login guard about another request", "export async function GET(request: Request) {\n  if (!devLoginEnabled(other)) return no();\n  return ok(1);\n}"],
    ["the dev-login guard with an else", "export async function GET(request: Request) {\n  if (!devLoginEnabled(request)) return no();\n  else ok(1);\n}"],
    ["a handler exported as a variable", "export const GET = async () => {\n  const user = await getCurrentUser();\n  return ok(user);\n};"],
    ["handlers taken out of an object", "export const { GET, POST } = handlers;"],
    ["a handler exported by name", "async function get() {\n  const user = await getCurrentUser();\n  return ok(user);\n}\nexport { get as GET };"],
    ["handlers passed on wholesale", 'export * from "./elsewhere";'],
  ])("refuses %s", (_, text) => {
    expect(check("x", text).problems).not.toEqual([]);
  });

  it.each([
    ["no status check", 'const user = await getCurrentUser();\n  if (!user) return signInAgain();\n  return ok(user);'],
    ["the status check first", 'const user = await getCurrentUser();\n  if (user?.status !== "ACTIVE") return inactive();\n  if (!user) return signInAgain();'],
    ["another status", 'const user = await getCurrentUser();\n  if (!user) return signInAgain();\n  if (user.status !== "PENDING") return inactive();'],
    ["another answer", 'const user = await getCurrentUser();\n  if (!user) return signInAgain();\n  if (user.status !== "ACTIVE") return ok(null);'],
    ["another answer to a signed-out request", 'const user = await getCurrentUser();\n  if (!user) return inactive();\n  if (user.status !== "ACTIVE") return inactive();'],
    ["an answer that is not returned", 'const user = await getCurrentUser();\n  if (!user) return signInAgain();\n  if (user.status !== "ACTIVE") inactive();'],
    ["an optional chain in the status check", 'const user = await getCurrentUser();\n  if (!user) return signInAgain();\n  if (user?.status !== "ACTIVE") return inactive();'],
    // Each of these is the gate with one thing changed, so each holds one condition of the check.
    ["the status check turned round", 'const user = await getCurrentUser();\n  if (!user) return signInAgain();\n  if (user.status === "ACTIVE") return inactive();'],
    ["another name in the signed-out check", 'const user = await getCurrentUser();\n  if (!account) return signInAgain();\n  if (user.status !== "ACTIVE") return inactive();'],
    ["another name in the status check", 'const user = await getCurrentUser();\n  if (!user) return signInAgain();\n  if (account.status !== "ACTIVE") return inactive();'],
    ["an else on the signed-out check", 'const user = await getCurrentUser();\n  if (!user) return signInAgain();\n  else log(user);\n  if (user.status !== "ACTIVE") return inactive();'],
    ["an else on the status check", 'const user = await getCurrentUser();\n  if (!user) return signInAgain();\n  if (user.status !== "ACTIVE") return inactive();\n  else log(user);'],
    ["an argument to signInAgain", 'const user = await getCurrentUser();\n  if (!user) return signInAgain(user);\n  if (user.status !== "ACTIVE") return inactive();'],
    ["an argument to inactive", 'const user = await getCurrentUser();\n  if (!user) return signInAgain();\n  if (user.status !== "ACTIVE") return inactive(user);'],
  ])("refuses a user gate with %s", (_, body) => {
    expect(check("x", `export async function GET() {\n  ${body}\n}`).problems).not.toEqual([]);
  });

  it("lets an ANY_STATUS handler open with the user gate alone", () =>
    expect(check("me", "export async function GET() {\n  const user = await getCurrentUser();\n  if (!user) return signInAgain();\n  return ok(user);\n}").problems).toEqual([]));

  it("leaves what follows the user gate to an ANY_STATUS handler, as auth/start needs", () =>
    expect(check("auth/start", "export async function GET(request: Request) {\n  const user = await getCurrentUser();\n  const url = new URL(request.url);\n  return ok(url);\n}").problems).toEqual([]));

  it("lets an ungated handler through only under the comment that says why", () => {
    const token = (comment: string) =>
      `export async function POST(request: Request) {\n  // ${comment}\n  const body = await request.json();\n  return ok(body);\n}`;
    expect(check("auth/token", token("This route is the sign-in itself, so there is no session to check.")).problems).toEqual([]);
    expect(check("auth/token", token("Reads the body.")).problems).not.toEqual([]);
    expect(check("auth/other", token("This route is the sign-in itself, so there is no session to check.")).problems).not.toEqual([]);
  });
});
