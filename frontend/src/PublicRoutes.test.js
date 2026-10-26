import fs from 'fs';
import path from 'path';
import { PAGES, SITE_ORIGIN } from './lib/pageMeta';
import { TOOL_PATHS } from './lib/intelligenceTools';

// The build saves every public page as a file of its own (scripts/prerender.mjs
// writes about.html for /about, and so on), and Cloudflare Pages answers
// anything that is neither a file nor a line in public/_redirects with
// 404.html and a 404 (DE-25 finding F6). These tests keep the app's routes, the
// list of pages, the redirects file and the sitemap saying the same thing.
const read = (relative) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
const app = read('./App.js');
const redirects = read('../public/_redirects').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
const sitemap = read('../public/sitemap.xml');
const robots = read('../public/robots.txt');
const pkg = JSON.parse(read('../package.json'));
const prerender = read('../scripts/prerender.mjs');

// A route's path is written in App.js either as text or as one of the three tool addresses.
const routes = [...app.matchAll(/<Route path=(?:"([^"]+)"|\{TOOL_PATHS(?:\.(\w+)|\["([^"]+)"\])\})/g)]
  .map((match) => match[1] || TOOL_PATHS[match[2] || match[3]]);
const rules = redirects.map((line) => line.split(/\s+/));
const pagePaths = PAGES.map((page) => page.path);

test('the app has the routes this test was written for', () => {
  expect(routes).toEqual([
    '/', '/search', '/property/:id', '/investment-calculator', '/mortgage-calculator', '/seller-net-sheet',
    '/agents', '/about', '/inquire', '/podcast', '/privacy', '/terms', '*',
  ]);
});

test('every route is a saved page, except the old listing link and the not-found screen', () => {
  const fixed = routes.filter((route) => route !== '*' && !route.includes(':'));
  expect([...fixed].sort()).toEqual([...pagePaths].sort());
  expect(routes.filter((route) => route.includes(':'))).toEqual(['/property/:id']);
});

test('a saved page is one file at the top of the build, so Cloudflare Pages serves it at its address', () => {
  // /about is about.html; a path inside a folder would need more than that.
  pagePaths.filter((item) => item !== '/').forEach((item) => expect(item).toMatch(/^\/[a-z0-9-]+$/));
  expect(new Set(pagePaths).size).toBe(pagePaths.length);
});

test('the only line in the redirects file sends an old listing link on to the search page', () => {
  expect(rules).toEqual([['/property/*', '/search', '302']]);
});

test('no page is rewritten to the shell, and there is no catch-all', () => {
  // A line for a page would be answered before the page's own file, with the wrong HTML.
  rules.forEach(([from, to]) => {
    expect(from).not.toBe('/*');
    expect(pagePaths).not.toContain(from.replace(/\/$/, ''));
    // "/index.html" as a target makes Cloudflare Pages redirect to "/" instead.
    expect(to).not.toMatch(/index\.html/);
    expect(pagePaths).toContain(to);
  });
});

test('the build saves the pages and writes 404.html, so an unknown address gets a 404 status', () => {
  expect(pkg.scripts.postbuild).toBe('node scripts/prerender.mjs');
  expect(prerender).toMatch(/writeFileSync\(join\(out, '404\.html'\), missing\)/);
  // The not-found page is the empty shell: never a copy of a real page, and never to be listed.
  expect(prerender).toMatch(/<meta name="robots" content="noindex"\/>/);
  expect(pkg.devDependencies.esbuild).toMatch(/^\d+\.\d+\.\d+$/);
});

test('the sitemap lists exactly the saved pages, on the public domain', () => {
  const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(listed).toEqual(PAGES.map((page) => `${SITE_ORIGIN}${page.path}`));
  // One address per page: nothing with a "?" part, and nothing that only forwards somewhere else.
  listed.forEach((address) => expect(address).not.toMatch(/[?#]|\/property\//));
});

test('robots.txt lets search engines in and points at the sitemap', () => {
  expect(robots).toMatch(/^User-agent: \*$/m);
  expect(robots).not.toMatch(/^Disallow: \/$/m);
  expect(robots).toMatch(/^Sitemap: https:\/\/diamondecho\.com\/sitemap\.xml$/m);
});
