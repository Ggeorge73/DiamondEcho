import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
const enabled = process.env.STAFF_QUEUE_ENABLED === "true";
function origin(name) {
  const value = process.env[name] || "";
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.hostname.endsWith(".invalid")) throw new Error(name + " must be an exact HTTPS origin");
  return value;
}
let config = { enabled: false };
if (enabled) {
  const apiBase = origin("STAFF_API_ORIGIN"), staffOrigin = origin("STAFF_ORIGIN");
  const publicOrigin = origin("PUBLIC_ORIGIN");
  if (staffOrigin === publicOrigin || staffOrigin === apiBase) throw new Error("Staff origin must be isolated");
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
  const appId = process.env.FIREBASE_WEB_APP_ID;
  if (!projectId || !apiKey || !appId || authDomain !== projectId + ".firebaseapp.com") throw new Error("Incomplete Firebase public web configuration");
  config = { enabled, apiBase, staffOrigin, firebase: { projectId, apiKey, authDomain, appId } };
}
await mkdir(new URL("./dist/", import.meta.url), { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL("entry.js", import.meta.url))], bundle: true, splitting: false, minify: true,
  outfile: fileURLToPath(new URL("dist/app.js", import.meta.url)), platform: "browser", format: "iife", target: ["es2020"] });
for (const name of ["index.html", "staff.css"]) await copyFile(new URL(name, import.meta.url), new URL("dist/" + name, import.meta.url));
await writeFile(new URL("dist/config.js", import.meta.url), "window.DIAMOND_ECHO_STAFF_CONFIG = Object.freeze(" + JSON.stringify(config).replaceAll("<", "\\u003c") + ");\n");
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com" +
  (enabled ? " " + config.apiBase : "") + "; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests";
await writeFile(new URL("dist/_headers", import.meta.url), "/*\n  Content-Security-Policy: " + csp +
  "\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n");
console.log(enabled ? "Configured isolated staff build complete" : "Disabled staff build complete (no live identity configured)");
