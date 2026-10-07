import fs from 'fs';
import path from 'path';

// DE-25. An automated check of every page (axe-core, WCAG 2.1 A and AA) found
// three kinds of fault. These tests hold the fixes in place; they read the
// source, because the test browser does not lay out or paint a page.
const read = (relative) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
const appCss = read('./App.css');
const policiesCss = read('./pages/Policies.css');
const navbar = read('./components/Navbar.jsx');
const assistant = read('./components/assistant/RealEstateAssistant.jsx');

const rule = (css, selector) => {
  const found = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css);
  if (!found) throw new Error(`No rule for ${selector}`);
  return found[2];
};
const declared = (body, property) => new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1].trim();

// WCAG relative luminance and contrast ratio.
const luminance = ([r, g, b]) => [r, g, b]
  .map((value) => value / 255)
  .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (front, back) => {
  const [light, dark] = [luminance(front), luminance(back)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};
// "rgba(229,237,245,.62)" painted over a solid background.
const over = (rgba, back) => {
  const [r, g, b, alpha] = /rgba\(([^)]+)\)/.exec(rgba)[1].split(',').map(Number);
  return [r, g, b].map((value, index) => value * alpha + back[index] * (1 - alpha));
};
const FOOTER_BACKGROUND = [6, 12, 19];   // #060c13, the darkest surface these lines sit on

test('the contrast sum agrees with the two faults that were measured', () => {
  // axe reported 2.76 for the old footer line and 2.4 for the old disclaimer.
  expect(contrast(over('rgba(229,237,245,.34)', FOOTER_BACKGROUND), FOOTER_BACKGROUND)).toBeCloseTo(2.76, 1);
  expect(contrast(over('rgba(229,237,245,.3)', FOOTER_BACKGROUND), FOOTER_BACKGROUND)).toBeCloseTo(2.4, 1);
});

test.each([
  ['the footer line naming the brokerage and Equal Housing Opportunity', '.mf-footer__legal'],
  ['the "not an appraisal, not a loan offer" lines', '.studio-disclaimer'],
])('%s can be read: at least 11px and 4.5 to 1', (_name, selector) => {
  const body = rule(appCss, selector);
  expect(Number.parseFloat(declared(body, 'font-size'))).toBeGreaterThanOrEqual(11);
  expect(declared(body, 'font-size')).toMatch(/px$/);
  const ratio = contrast(over(declared(body, 'color'), FOOTER_BACKGROUND), FOOTER_BACKGROUND);
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('a link inside policy text is underlined, not told apart by colour alone', () => {
  expect(declared(rule(policiesCss, '.de-policy__body a'), 'text-decoration')).toBe('underline');
});

test('the name a screen reader or voice control hears contains the words on screen', () => {
  // Header wordmark: "DIAMOND ECHO" over "PRIVATE REAL ESTATE".
  const wordmark = /className="mf-wordmark" aria-label="([^"]+)"/.exec(navbar)[1].toLowerCase();
  // The two lines must read as separate words, or the text on screen is "ECHOPRIVATE".
  expect(navbar).toMatch(/<strong>DIAMOND ECHO<\/strong>\{' '\}\s*<small>PRIVATE REAL ESTATE<\/small>/);
  expect(wordmark).toContain('diamond echo private real estate');
  // Assistant launcher: its visible label is "Ask DiamondEcho".
  const launcher = /aria-expanded=\{open\} aria-label="([^"]+)"/.exec(assistant)[1];
  expect(assistant).toContain('>Ask DiamondEcho</span>');
  expect(launcher).toContain('Ask DiamondEcho');
});

test('the note under the assistant box is not faint', () => {
  const note = /<p className="([^"]+)">Don’t share SSNs/.exec(assistant)[1];
  const alpha = Number(/text-\[#dce8f2\]\/(\d+)/.exec(note)[1]) / 100;
  const ratio = contrast(over(`rgba(220,232,242,${alpha})`, [20, 36, 52]), [20, 36, 52]);   // on #142434
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('the menu: its Close button is named by the words on it, and the item numbers are not the dark blue', () => {
  // An aria-label of "Close site menu" hid the words "Close menu" from voice control.
  const start = navbar.indexOf('className="mf-menu__close"');
  const button = navbar.slice(start, navbar.indexOf('</button>', start));
  expect(button).toContain('<X aria-hidden="true" /> Close menu');
  expect(button).not.toContain('aria-label');
  expect(declared(rule(appCss, '.mf-menu__primary a span'), 'color')).toBe('var(--steel-bright)');
  // --steel-bright on the menu's background, against --steel which it replaced.
  expect(contrast([94, 156, 208], FOOTER_BACKGROUND)).toBeGreaterThanOrEqual(4.5);
  expect(contrast([45, 98, 140], FOOTER_BACKGROUND)).toBeLessThan(4.5);
});

test('the foot of the page leaves room for the Ask DiamondEcho button, so it never covers Privacy and Terms', () => {
  // The button: bottom-5 (20px) and h-14 (56px) in RealEstateAssistant.jsx.
  expect(assistant).toContain('fixed bottom-5 right-5');
  expect(assistant).toMatch(/className=\{`ml-auto flex h-14 /);
  const clear = 20 + 56;
  const paddings = [...appCss.matchAll(/\.mf-footer \{ padding: [^;]+ (\d+)px;/g)].map((found) => Number(found[1]));
  expect(paddings).toHaveLength(2);            // the desktop rule and the phone rule
  paddings.forEach((bottom) => expect(bottom).toBeGreaterThan(clear));
});
