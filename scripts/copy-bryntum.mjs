// Copies Bryntum's ready-built files into public/ so the browser loads them as static files.
// Bundling the 5 MB obfuscated module makes the production build run out of memory, so the
// app never imports it at runtime (type-only imports are fine). Runs before dev and build.

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "@bryntum", "calendar");
const to = join(root, "public", "vendor", "bryntum");

if (!existsSync(from)) {
  console.error("copy-bryntum: @bryntum/calendar isn't installed. Run npm install first.");
  process.exit(1);
}

mkdirSync(to, { recursive: true });
// svalbard-dark.css: the board switches to it when the app is in dark mode.
for (const file of ["calendar.umd.js", "calendar.css", "svalbard-light.css", "svalbard-dark.css"]) {
  cpSync(join(from, file), join(to, file));
}
// The theme's icons: css/ points at ../webfonts/.
cpSync(join(from, "fontawesome", "css"), join(to, "fontawesome", "css"), { recursive: true });
cpSync(join(from, "fontawesome", "webfonts"), join(to, "fontawesome", "webfonts"), { recursive: true });
console.log("copy-bryntum: copied to public/vendor/bryntum");
