// Runs after the build. Saves every public page as its own HTML file, with the
// page's words, title, summary and business details already in it.
//
// Why: the build produces one empty shell, and the pages only exist once the
// script has run in a browser. A search engine, a link preview or an AI
// assistant that reads the HTML alone saw the same blank page, with the same
// title, at every address. Now /about is build/about.html and says what the
// About page says.
//
// How: the app is bundled once more, for Node, and each page is drawn to text
// with the router fixed at that page's address (src/prerender.jsx). The page
// list, titles and summaries come from src/lib/pageMeta.js. In the browser the
// app takes the saved HTML over as it stands (src/index.js).
//
// It also writes 404.html: Cloudflare Pages answers an unknown address with
// that file and a 404 status when it exists (DE-25 finding F6). It is the
// empty shell, titled "Page not found" and marked not to be listed; the app
// then shows its own "Page not found" screen.
//
// The build fails, rather than publish a weaker page, if a page comes out
// without exactly one main heading, without the brokerage's name and telephone
// number, or with a title or summary another page already uses.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build, transform } from 'esbuild';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(frontend, process.env.BUILD_PATH || 'build');
const shellFile = join(out, 'index.html');
if (!existsSync(shellFile)) throw new Error(`Missing build output: ${shellFile}`);
const shell = readFileSync(shellFile, 'utf8');
if (shell.includes('data-prerendered')) throw new Error('index.html has already been prerendered; run a fresh build first.');

// The same REACT_APP_ settings the build itself used, read the way Create
// React App reads them: the environment first, then its .env files in order.
const publicEnv = () => {
  const env = {};
  const take = (source) => Object.entries(source).forEach(([key, value]) => {
    if (key.startsWith('REACT_APP_') && !(key in env)) env[key] = String(value);
  });
  take(process.env);
  const files = ['.env.production.local', '.env.local', '.env.production', '.env'].map((name) => join(frontend, name)).filter(existsSync);
  if (files.length) {
    const { parse } = createRequire(import.meta.url)('dotenv');
    files.forEach((file) => take(parse(readFileSync(file))));
  }
  return env;
};
const env = publicEnv();

// A page drawn for a build with a request service must be taken over by a
// script built with the same one, or the two would disagree about the request
// forms and the assistant.
const backend = (env.REACT_APP_BACKEND_URL || '').trim();
const scripts = readdirSync(join(out, 'static', 'js')).filter((name) => /^main\..+\.js$/.test(name));
if (scripts.length !== 1) throw new Error(`Expected one main script in the build, found ${scripts.length}`);
if (backend && !readFileSync(join(out, 'static', 'js', scripts[0]), 'utf8').includes(backend)) {
  throw new Error('REACT_APP_BACKEND_URL is set for this step but is not in the built script: the pages would not match the app.');
}

const work = mkdtempSync(join(tmpdir(), 'diamondecho-prerender-'));
let site;
try {
  const bundle = join(work, 'site.mjs');
  await build({
    entryPoints: [join(frontend, 'src', 'prerender.jsx')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    loader: { '.js': 'jsx', '.css': 'empty' },
    alias: { '@': join(frontend, 'src') },
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.REACT_APP_BACKEND_URL': JSON.stringify(env.REACT_APP_BACKEND_URL || ''),
      ...Object.fromEntries(Object.entries(env).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)])),
    },
    // Some packages in the bundle still call require(); an ES module has none of its own.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    logLevel: 'warning',
  });
  site = await import(pathToFileURL(bundle).href);
} finally {
  rmSync(work, { recursive: true, force: true });
}

const { BROKERAGE, PAGES, STRUCTURED_DATA_ID, headFor, jsonForScript, prerenderGuard, renderPage } = site;

const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Replaces exactly one match, and says so when the shell is not what this script expects.
const replaceOnce = (html, pattern, replacement, what) => {
  const matches = html.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)) || [];
  if (matches.length !== 1) throw new Error(`Expected one ${what} in index.html, found ${matches.length}`);
  return html.replace(pattern, () => replacement);
};

const TITLE = /<title>[^<]*<\/title>/;
const DESCRIPTION = /<meta name="description" content="[^"]*"\s*\/?>/;
const ROOT = /<div id="root"><\/div>/;
const NOSCRIPT_NOTE = /<noscript data-shell-note[^>]*>[\s\S]*?<\/noscript>/;

const headTags = (head) => [
  `<link rel="canonical" href="${escapeHtml(head.canonical)}"/>`,
  ...head.properties.map(([property, content]) => `<meta property="${escapeHtml(property)}" content="${escapeHtml(content)}"/>`),
  ...head.names.map(([name, content]) => `<meta name="${escapeHtml(name)}" content="${escapeHtml(content)}"/>`),
  `<script id="${STRUCTURED_DATA_ID}" type="application/ld+json">${jsonForScript(head.structuredData)}</script>`,
].join('');

// Clears the saved page, before the browser paints it, when the address asks
// for something else (see src/lib/prerendered.js).
const { code: guardCode } = await transform(
  `(function(){var r=document.getElementById("root");if(!(${prerenderGuard})(r,window.location))r.textContent=""})()`,
  { minify: true, target: 'es2015' },
);
if (guardCode.includes('</')) throw new Error('The page guard cannot be written inside a script element.');
const guard = `<script>${guardCode.trim()}</script>`;

const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const seen = { title: new Map(), description: new Map() };
const written = [];
for (const page of PAGES) {
  const head = headFor(page);
  ['title', 'description'].forEach((field) => {
    if (seen[field].has(head[field])) throw new Error(`${page.path} and ${seen[field].get(head[field])} have the same ${field}`);
    seen[field].set(head[field], page.path);
  });

  // Fields and buttons do nothing until the script has loaded, and what a
  // visitor typed into one before then would be lost when the app took the
  // page over. They are marked inert here and released by src/index.js the
  // moment the app starts. Links are left alone: they work without the script.
  const body = renderPage(page.path).replace(/<(input|select|textarea|button)(?=[\s>])/g, '<$1 inert=""');
  const headings = body.match(/<h1[\s>]/g) || [];
  if (headings.length !== 1) throw new Error(`${page.path} was drawn with ${headings.length} main headings; a page has exactly one`);
  const words = text(body);
  // Georgia Real Estate Commission Rule 520-1-.09: the firm's name and telephone number on every page.
  [BROKERAGE.name, BROKERAGE.phone].forEach((needed) => {
    if (!words.includes(needed)) throw new Error(`${page.path} was drawn without "${needed}"`);
  });

  let html = shell;
  html = replaceOnce(html, TITLE, `<title>${escapeHtml(head.title)}</title>`, 'title');
  html = replaceOnce(html, DESCRIPTION, `<meta name="description" content="${escapeHtml(head.description)}"/>`, 'description');
  html = replaceOnce(html, /<\/head>/, `${headTags(head)}</head>`, 'closing head tag');
  html = replaceOnce(html, ROOT, `<div id="root" data-prerendered="${escapeHtml(page.path)}">${body}</div>${guard}`, 'empty root element');

  const file = page.path === '/' ? 'index.html' : `${page.path.slice(1)}.html`;
  if (file.includes('/')) throw new Error(`${page.path}: pages inside folders are not handled yet`);
  writeFileSync(join(out, file), html);
  written.push(`${file} (${words.split(' ').length} words)`);
}

// The page for an address the site does not have: the empty shell.
let missing = shell;
missing = replaceOnce(missing, TITLE, '<title>Page not found | DiamondEcho</title>', 'title');
missing = replaceOnce(missing, DESCRIPTION, '<meta name="robots" content="noindex"/>', 'description');
missing = replaceOnce(missing, NOSCRIPT_NOTE, '<noscript>Page not found. <a href="/">Go to the DiamondEcho home page</a>.</noscript>', 'shell note');
writeFileSync(join(out, '404.html'), missing);

console.log(`Saved ${written.length} pages as HTML:\n  ${written.join('\n  ')}\nWrote 404.html (the empty shell, not to be listed)`);
