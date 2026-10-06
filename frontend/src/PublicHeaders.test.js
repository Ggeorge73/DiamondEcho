import fs from 'fs';
import path from 'path';

// DE-25: the public site tells browsers it must not be shown inside another
// site's frame. Cloudflare Pages reads these lines from public/_headers.
const file = fs.readFileSync(path.resolve(__dirname, '../public/_headers'), 'utf8');
const lines = file.split('\n').map((line) => line.trimEnd()).filter((line) => line && !line.startsWith('#'));

test('the headers apply to every path on the public site', () => {
  expect(lines[0]).toBe('/*');
  expect(lines.filter((line) => !line.startsWith('  '))).toEqual(['/*']);
});

test('the public site refuses to be framed by another site', () => {
  expect(lines).toContain('  X-Frame-Options: DENY');
  expect(lines).toContain("  Content-Security-Policy: frame-ancestors 'none'");
});

test('no script, style or frame policy is set that could block the Georgia MLS search', () => {
  const policy = lines.find((line) => line.includes('Content-Security-Policy'));
  expect(policy).not.toMatch(/default-src|script-src|style-src|frame-src|child-src|connect-src/);
});

test('no permissions policy is set that could switch off the map inside the Georgia MLS search', () => {
  expect(lines.some((line) => line.includes('Permissions-Policy'))).toBe(false);
});
