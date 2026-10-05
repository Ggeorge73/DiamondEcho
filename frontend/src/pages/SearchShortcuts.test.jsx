import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

// DE-21. The original audit found marketed shortcuts (neighborhood and keyword
// links) that landed on a search with nothing to show. The search is now the
// Georgia MLS frame, and the only thing a DiamondEcho link can decide is
// whether it opens for homes for sale or for rentals. These tests keep any
// other promise out of the site's own links.

const srcDir = path.resolve(__dirname, '..');
const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return sourceFiles(full);
  return /\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
});
const SUPPORTED = ['/search', '/search?status=rent'];
// The helper that builds the two supported forms; its own tests cover it.
const isHelper = (file) => file.endsWith(path.join('lib', 'searchCriteria.js'));

test('every link the site writes to its own search uses only what the search can honour', () => {
  const found = [];
  for (const file of sourceFiles(srcDir)) {
    if (isHelper(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(['"`])(\/search[^'"`]*)\1/g)) {
      found.push({ file: path.relative(srcDir, file), target: match[2] });
    }
  }
  // The scan must actually see the links, or it proves nothing.
  expect(found.length).toBeGreaterThanOrEqual(10);
  expect(found.some((link) => link.target === '/search?status=rent')).toBe(true);
  expect(found.filter((link) => !SUPPORTED.includes(link.target))).toEqual([]);
});

test('no source file builds a search link from a place name or keyword', () => {
  for (const file of sourceFiles(srcDir)) {
    if (isHelper(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    expect({ file: path.relative(srcDir, file), builds: /\/search\?q=|search\?\$\{/.test(text) })
      .toEqual({ file: path.relative(srcDir, file), builds: false });
  }
});

describe('the header says which search the visitor is on', () => {
  let container;
  let root;
  beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const render = async (route) => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<MemoryRouter initialEntries={[route]}><Navbar /></MemoryRouter>));
  };
  const current = () => [...container.querySelectorAll('.mf-nav__links a[aria-current="page"]')].map((a) => a.textContent);
  const highlighted = () => [...container.querySelectorAll('.mf-nav__links a.active')].map((a) => a.textContent);

  test.each([
    ['/search', ['Search homes']],
    ['/search?q=Atlanta', ['Search homes']],
    ['/search?status=sale', ['Search homes']],
    ['/search?status=rent', ['Rentals']],
    ['/search?status=%20RENT%20', ['Rentals']],
    ['/search?q=Atlanta&status=rentals', ['Rentals']],
    ['/investment-calculator', ['Intelligence']],
    ['/agents', ['Advisory']],
    ['/', []],
  ])('on %s the current page is %j', async (route, expected) => {
    await render(route);
    expect(current()).toEqual(expected);
    expect(highlighted()).toEqual(expected);
  });

  test('the phone menu marks the same single item', async () => {
    await render('/search?status=rent');
    await act(async () => container.querySelector('.mf-nav__burger').click());
    const marked = [...container.querySelectorAll('.mf-menu__primary a[aria-current="page"]')].map((a) => a.textContent.replace(/^\d+/, ''));
    expect(marked).toEqual(['Rentals']);
  });
});

test('the footer names the search for what it is', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><Footer /></MemoryRouter>));
  const labels = [...container.querySelectorAll('a[href^="/search"]')].map((a) => `${a.textContent} -> ${a.getAttribute('href')}`);
  expect(labels).toEqual(['Residences -> /search', 'Rentals -> /search?status=rent', 'Search Georgia MLS -> /search']);
  expect(container.textContent).not.toContain('collection');
  await act(async () => root.unmount());
  container.remove();
});
