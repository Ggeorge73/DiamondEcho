import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Search, { GAMLS_SEARCH_URL } from './Search';

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
test('search provides the member IDX frame and an always available direct fallback', async () => {
  await render('/search');
  expect(container.querySelector('iframe').getAttribute('src')).toBe(GAMLS_SEARCH_URL);
  expect(container.querySelector('iframe').title).toBe('Georgia MLS property search');
  const fallback = container.querySelector('a[target="_blank"]');
  expect(fallback.href).toBe(GAMLS_SEARCH_URL);
  expect(fallback.rel).toContain('noopener');
  expect(container.textContent).not.toContain('Listings live');
  expect(container.querySelector('.mf-prop-card')).toBeNull();
  expect(container.querySelector('a[href="/inquire?type=buyer"]')).not.toBeNull();
});
test.each([
  ['/search?status=rent', 'Looking for a rental?'],
  ['/search?q=%20Atlanta%20', '“Atlanta”'],
  ['/search?q=Atlanta&status=rent', 'Looking for a rental?'],
])('legacy intent at %s is disclosed without inventing provider filters', async (route, message) => {
  await render(route);
  expect(container.textContent).toContain(message);
  expect(container.textContent).toContain('not been filtered automatically');
  expect(container.querySelector('iframe').getAttribute('src')).toBe(GAMLS_SEARCH_URL);
});
