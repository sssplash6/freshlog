// Builds the Safari copy of the call logger from `extension/`, the one source
// both browsers share, into `safari/extension/` (ignored by git), which the
// Xcode project in this folder packages. Run it before every Xcode build:
//
//   node safari/build.mjs
//
// Safari differs from Chrome in three ways that matter here:
//
// 1. Its service worker cannot be an ES module, so `background.js` and the two
//    files it imports are joined into one plain script.
// 2. It has no `world: "MAIN"` content scripts. `rtc-probe.js` would run in the
//    extension's own world, where it sees none of Meet's connections, so it is
//    left out: in Safari a call is timed off the Leave call button alone.
// 3. It has no notifications for extensions. `background.js` already opens the
//    form by itself when it cannot ask, so the permission is dropped.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "extension");
const out = path.join(import.meta.dirname, "extension");

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, {
  recursive: true,
  filter: (file) => !/README\.md$|rtc-probe\.js$/.test(file),
});

// 1. One plain background script.
const plain = (file) =>
  fs
    .readFileSync(path.join(src, file), "utf8")
    .replace(/^import .* from ".*";\n/gm, "")
    .replace(/^export /gm, "");
for (const file of ["settings.js", "tracker.js", "background.js"]) {
  if (/^\s*import\s*\(|^export (default|\{)/m.test(fs.readFileSync(path.join(src, file), "utf8"))) {
    throw new Error(`${file}: only "export function/const" and static imports can be joined`);
  }
}
fs.writeFileSync(
  path.join(out, "background.js"),
  `// Built by safari/build.mjs from settings.js, tracker.js and background.js. Do not edit.\n(() => {\n${[
    "settings.js",
    "tracker.js",
    "background.js",
  ]
    .map(plain)
    .join("\n")}\n})();\n`,
);

// 2 and 3. The manifest.
const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
delete manifest.background.type;
manifest.content_scripts = manifest.content_scripts.filter((c) => c.world !== "MAIN");
manifest.permissions = manifest.permissions.filter((p) => p !== "notifications");
fs.writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built ${path.relative(root, out)} (version ${manifest.version})`);
