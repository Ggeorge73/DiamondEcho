// DE-25 finding F6. Cloudflare Pages answers an unknown address with 404.html
// and a 404 status when that file exists; without it, every address gets the
// app with a 200. The app already shows its own "Page not found" screen, so
// 404.html is simply a copy of the app shell: same screen, honest status.
// The addresses the app really has are listed in public/_redirects.
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(process.env.BUILD_PATH || "build");
const shell = resolve(out, "index.html");
if (!existsSync(shell)) throw new Error(`Missing build output: ${shell}`);
copyFileSync(shell, resolve(out, "404.html"));
console.log("Wrote 404.html (a copy of index.html)");
