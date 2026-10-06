import fs from 'fs';
import path from 'path';

// DE-25: the public site tells browsers it must not be shown inside another
// site's frame. Cloudflare Pages reads these lines from public/_headers.
const file = fs.readFileSync(path.resolve(__dirname, '../public/_headers'), 'utf8');
const lines = file.split('\n').map((line) => line.trimEnd()).filter((line) => line && !line.startsWith('#'));

// Each block is an address pattern followed by its indented headers.
const blocks = {};
let current = null;
lines.forEach((line) => {
  if (line.startsWith('  ')) blocks[current].push(line.trim());
  else { current = line; blocks[current] = []; }
});
const everywhere = blocks['/*'];

test('the first block applies to every path on the public site', () => {
  expect(lines[0]).toBe('/*');
  expect(Object.keys(blocks)).toEqual(['/*', 'https://:project.pages.dev/*', 'https://:version.:project.pages.dev/*']);
});

test('the public site refuses to be framed by another site', () => {
  expect(everywhere).toContain('X-Frame-Options: DENY');
  expect(everywhere).toContain("Content-Security-Policy: frame-ancestors 'none'");
});

test('no script, style or frame policy is set that could block the Georgia MLS search', () => {
  const policies = lines.filter((line) => line.includes('Content-Security-Policy'));
  expect(policies).toHaveLength(1);
  expect(policies[0]).not.toMatch(/default-src|script-src|style-src|frame-src|child-src|connect-src/);
});

test('no permissions policy is set that could switch off the map inside the Georgia MLS search', () => {
  expect(lines.some((line) => line.includes('Permissions-Policy'))).toBe(false);
});

test('browsers are told to keep using https for this host only', () => {
  const hsts = everywhere.filter((line) => line.startsWith('Strict-Transport-Security:'));
  expect(hsts).toEqual(['Strict-Transport-Security: max-age=15552000']);
  // Naming subdomains would reach the mail hosts; preload is close to permanent.
  expect(file.replace(/^#.*$/gm, '')).not.toMatch(/includeSubDomains|preload/i);
});

test('search engines are asked not to list the pages.dev copies, and only those', () => {
  expect(blocks['https://:project.pages.dev/*']).toEqual(['X-Robots-Tag: noindex']);
  expect(blocks['https://:version.:project.pages.dev/*']).toEqual(['X-Robots-Tag: noindex']);
  expect(everywhere.some((line) => line.startsWith('X-Robots-Tag'))).toBe(false);
});
