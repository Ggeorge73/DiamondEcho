import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Search, { GAMLS_SEARCH_URL, GAMLS_SALE_SEARCH_URL, GAMLS_RENTAL_SEARCH_URL } from './Search';

let container;
let root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = async (route) => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[route]}><Search /></MemoryRouter>
  ));
};
test('search stays embedded without an external search link', async () => {
  await render('/search');
  expect(container.querySelector('iframe').getAttribute('src')).toBe(GAMLS_SALE_SEARCH_URL);
  expect(container.querySelector('iframe').title).toBe('Georgia MLS property search');
  expect(container.querySelector('a[target="_blank"]')).toBeNull();
  for (const url of [GAMLS_SEARCH_URL, GAMLS_SALE_SEARCH_URL, GAMLS_RENTAL_SEARCH_URL]) {
    expect(container.querySelector('a[href="' + url + '"]')).toBeNull();
  }
  expect(container.textContent).not.toContain('Listings live');
  expect(container.querySelector('.mf-prop-card')).toBeNull();
  expect(container.querySelector('a[href="/inquire?type=buyer"]')).not.toBeNull();
  expect(container.querySelector('a[href="/inquire?type=tour"]')).not.toBeNull();
  expect(container.textContent).toContain('Selections made in Georgia MLS are not automatically sent');
});
test('default search pre-selects the five for-sale types and says so', async () => {
  await render('/search');
  const src = new URL(container.querySelector('iframe').getAttribute('src'));
  expect(src.origin + src.pathname).toBe(GAMLS_SEARCH_URL);
  expect(src.searchParams.get('styp')).toBe('sale');
  expect(src.searchParams.get('gtyp')).toBe('loc');
  expect(src.searchParams.get('typ').split(',')).toEqual(['sd', 'sa', 'll', 'mf', 'cm']);
  expect(container.querySelector('.de-idx__notice')).toBeNull();
  expect(container.textContent).toContain('For-sale property types are pre-selected');
});
test('rental intent pre-selects residential rentals on the form that keeps the type', async () => {
  await render('/search?status=rent');
  const src = new URL(container.querySelector('iframe').getAttribute('src'));
  expect(container.querySelector('iframe').getAttribute('src')).toBe(GAMLS_RENTAL_SEARCH_URL);
  expect(src.searchParams.get('styp')).toBe('sale');
  expect(src.searchParams.get('typ')).toBe('rr');
  expect(container.textContent).toContain('Looking for a rental?');
  expect(container.textContent).toContain('Rental (Residential) is pre-selected');
  // The provider never states the rent period, so the page says so instead of implying one.
  expect(container.textContent).toContain('Georgia MLS shows the rent amount without stating the period, so confirm with the listing whether it is monthly.');
  expect(container.textContent).not.toContain('For-sale property types are pre-selected');
});
test.each([
  ['/search?q=%20Atlanta%20', GAMLS_SALE_SEARCH_URL],
  ['/search?q=Atlanta&status=rent', GAMLS_RENTAL_SEARCH_URL],
])('a requested location at %s is disclosed and never passed to the provider', async (route, expectedSrc) => {
  await render(route);
  expect(container.textContent).toContain('“Atlanta”');
  expect(container.textContent).toContain('has not been filled in automatically');
  expect(container.querySelector('iframe').getAttribute('src')).toBe(expectedSrc);
  expect(container.querySelector('iframe').getAttribute('src')).not.toContain('Atlanta');
});
