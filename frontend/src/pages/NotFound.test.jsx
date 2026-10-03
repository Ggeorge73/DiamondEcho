import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';

let container;
let root;
const originalObserver = global.IntersectionObserver;

const renderAt = async (path) => {
  window.history.pushState({}, '', path);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = jest.fn();
  global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  document.title = 'DiamondEcho | Private Real Estate';
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  container = null;
  root = null;
  global.IntersectionObserver = originalObserver;
  window.history.pushState({}, '', '/');
});

test.each(['/no-such-page', '/search/extra', '/Investment-Calculator-typo', '/a/b/c'])(
  'unknown address %s explains itself and offers Home and Search',
  async (path) => {
    await renderAt(path);
    const heading = container.querySelector('main h1');
    expect(heading.textContent).toContain('We can’t find that page.');
    expect(container.querySelector('main').textContent).toContain(path);
    expect(document.activeElement).toBe(heading);
    expect(document.title).toBe('Page not found | DiamondEcho');
    expect(document.head.querySelector('meta[name="robots"]').content).toBe('noindex');
    const actions = [...container.querySelectorAll('.mf-notfound__actions a')].map((link) => link.getAttribute('href'));
    expect(actions).toEqual(['/', '/search']);
    expect(container.querySelector('.mf-nav')).not.toBeNull();
    expect(container.querySelector('footer')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  },
);

test('the Search action on the not-found page opens the real search and clears the not-found state', async () => {
  await renderAt('/no-such-page');
  const search = [...container.querySelectorAll('.mf-notfound__actions a')].find((link) => link.getAttribute('href') === '/search');
  await act(async () => { search.click(); });
  expect(window.location.pathname).toBe('/search');
  expect(container.querySelector('iframe[title="Georgia MLS property search"]')).not.toBeNull();
  expect(container.textContent).not.toContain('We can’t find that page.');
  expect(document.title).toBe('DiamondEcho | Private Real Estate');
  expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
});

test('the Home action on the not-found page opens the home page', async () => {
  await renderAt('/no-such-page');
  const home = [...container.querySelectorAll('.mf-notfound__actions a')].find((link) => link.getAttribute('href') === '/');
  await act(async () => { home.click(); });
  expect(window.location.pathname).toBe('/');
  expect(container.textContent).not.toContain('We can’t find that page.');
});

test.each([
  ['/', 'Diamond Echo'],
  ['/search', 'Find your next home.'],
  ['/search?status=rent', 'Find your next home.'],
  ['/investment-calculator', 'Underwrite with'],
  ['/agents', null],
  ['/about', null],
  ['/inquire?type=tour', 'Tour requests are not open yet.'],
])('known deep link %s still loads directly and is not treated as unknown', async (path, heading) => {
  await renderAt(path);
  expect(container.textContent).not.toContain('We can’t find that page.');
  expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  expect(container.querySelector('h1')).not.toBeNull();
  if (heading) expect(container.querySelector('h1').textContent).toContain(heading);
});

test('a legacy property address still recovers to search, not to the not-found page', async () => {
  await renderAt('/property/3');
  expect(window.location.pathname).toBe('/search');
  expect(container.textContent).not.toContain('We can’t find that page.');
});
