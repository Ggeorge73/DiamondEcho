import fs from 'fs';
import path from 'path';

// DE-25 finding F6. Cloudflare Pages answers the addresses listed in
// public/_redirects with the app and a 200, and everything else with 404.html
// and a 404. These tests keep that list, the sitemap and the app's own routes
// saying the same thing.
const read = (relative) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
const app = read('./App.js');
const redirects = read('../public/_redirects').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
const sitemap = read('../public/sitemap.xml');
const robots = read('../public/robots.txt');
const pkg = JSON.parse(read('../package.json'));

const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1]);
const rules = redirects.map((line) => line.split(/\s+/));
const served = (address) => rules.some(([from]) => (from.endsWith('/*') ? address.startsWith(from.slice(0, -1)) : from === address));

test('the app has the routes this test was written for', () => {
  expect(routes).toEqual(['/', '/search', '/property/:id', '/investment-calculator', '/agents', '/about', '/inquire', '/privacy', '/terms', '*']);
});

test('every rule serves the app shell with a 200 and none sends the browser elsewhere', () => {
  // "/index.html" as a target makes Cloudflare Pages redirect to "/" instead.
  rules.forEach((rule) => expect(rule.slice(1)).toEqual(['/', '200']));
});

test('every route in the app is served, with and without a closing slash', () => {
  routes.filter((route) => route !== '/' && route !== '*').forEach((route) => {
    if (route.includes(':')) {
      expect(served(route.replace(/:[^/]+/g, 'example'))).toBe(true);
    } else {
      expect(served(route)).toBe(true);
      expect(served(`${route}/`)).toBe(true);
    }
  });
});

test('nothing is served that the app has no route for, and there is no catch-all', () => {
  const known = routes.filter((route) => route !== '*').map((route) => route.replace(/:[^/]+$/, '*'));
  rules.forEach(([from]) => {
    expect(from).not.toBe('/*');
    expect(known).toContain(from.length > 1 && from.endsWith('/') ? from.slice(0, -1) : from);
  });
  expect(served('/no-such-page')).toBe(false);
  expect(served('/search/extra')).toBe(false);
});

test('the build writes 404.html so an unknown address gets a 404 status', () => {
  expect(pkg.scripts.postbuild).toBe('node scripts/make-404.mjs');
  expect(read('../scripts/make-404.mjs')).toMatch(/copyFileSync\(shell, resolve\(out, "404\.html"\)\)/);
});

test('the sitemap lists only addresses the app has, on the public domain', () => {
  const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(listed.length).toBeGreaterThan(0);
  listed.forEach((address) => {
    const url = new URL(address);
    expect(url.origin).toBe('https://diamondecho.com');
    expect(url.pathname === '/' || served(url.pathname)).toBe(true);
  });
  // Pages that only forward somewhere else are left out.
  expect(listed.some((address) => address.includes('/property/'))).toBe(false);
  expect(new Set(listed).size).toBe(listed.length);
});

test('robots.txt lets search engines in and points at the sitemap', () => {
  expect(robots).toMatch(/^User-agent: \*$/m);
  expect(robots).not.toMatch(/^Disallow: \/$/m);
  expect(robots).toMatch(/^Sitemap: https:\/\/diamondecho\.com\/sitemap\.xml$/m);
});
