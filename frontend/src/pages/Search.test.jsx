import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import Search, { GAMLS_SEARCH_URL, GAMLS_SALE_SEARCH_URL, GAMLS_RENTAL_SEARCH_URL } from './Search';
import { RELOADED_NOTE_MS } from '../components/GamlsSearch';

let container;
let root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => root.unmount());
  container.remove();
});
let location;
let navigate;
const Probe = () => {
  location = useLocation();
  navigate = useNavigate();
  return null;
};
const render = async (route) => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[route]}><Search /><Probe /></MemoryRouter>
  ));
};
const address = () => location.pathname + location.search;
// The search the visitor can see. A second search may be loaded and hidden.
const frame = () => container.querySelector('iframe:not([hidden])');
const frames = () => [...container.querySelectorAll('iframe')];
const click = async (element) => {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
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

// DE-21: site-owned criteria in the address.
test.each([
  ['/search?status=Rent'],
  ['/search?status=%20rent%20'],
  ['/search?status=RENTAL'],
  ['/search?status=rentals'],
])('%s opens the rentals search and the address is tidied to status=rent', async (route) => {
  await render(route);
  expect(frame().getAttribute('src')).toBe(GAMLS_RENTAL_SEARCH_URL);
  expect(container.textContent).toContain('Looking for a rental?');
  expect(address()).toBe('/search?status=rent');
});
test.each([
  ['/search?status=sale'],
  ['/search?status='],
  ['/search?status=renting'],
])('%s is homes for sale and the unsupported status leaves the address', async (route) => {
  await render(route);
  expect(frame().getAttribute('src')).toBe(GAMLS_SALE_SEARCH_URL);
  expect(container.querySelector('.de-idx__notice')).toBeNull();
  expect(address()).toBe('/search');
});
test('padded and broken-up text in q is shown tidied, capped, and the address matches what is shown', async () => {
  await render('/search?q=%20%20North%20%20%20Druid%09Hills%20%20');
  expect(container.textContent).toContain('“North Druid Hills”');
  expect(address()).toBe('/search?q=North+Druid+Hills');

  await act(async () => navigate(`/search?q=${'x'.repeat(300)}`));
  expect(container.querySelector('.de-idx__notice').textContent).toContain(`“${'x'.repeat(80)}”`);
  expect(address()).toBe(`/search?q=${'x'.repeat(80)}`);

  await act(async () => navigate('/search?q=%20%20'));
  expect(container.querySelector('.de-idx__notice')).toBeNull();
  expect(address()).toBe('/search');
});
test('markup in q is shown as text, never as markup', async () => {
  await render('/search?q=%3Cb%3EAtlanta%3C%2Fb%3E');
  expect(container.querySelector('.de-idx__notice b')).toBeNull();
  expect(container.querySelector('.de-idx__notice').textContent).toContain('“<b>Atlanta</b>”');
});
test('a parameter the site does not own is left in the address untouched', async () => {
  await render('/search?utm_source=mail&status=RENT');
  expect(address()).toBe('/search?utm_source=mail&status=rent');
});
test('tidying the address replaces the entry, so Back is not trapped', async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/agents', '/search?status=%20RENT%20']} initialIndex={1}><Search /><Probe /></MemoryRouter>
  ));
  expect(address()).toBe('/search?status=rent');
  await act(async () => navigate(-1));
  expect(address()).toBe('/agents');
});

// DE-21: Back, Forward and reset.
test('for-sale and rentals each keep their own frame; moving between them shows one and hides the other', async () => {
  // One frame re-pointed at the other search added a step to the browser
  // history: Back showed for-sale results under the rentals note. One frame
  // replaced by another left steps in the history with no frame to go to: Back
  // presses that did nothing. So neither frame is ever re-pointed or removed.
  const assigned = vi.spyOn(HTMLIFrameElement.prototype, 'src', 'set');
  const attributes = vi.spyOn(Element.prototype, 'setAttribute');
  const srcWrites = () => attributes.mock.calls
    .filter((call, index) => attributes.mock.instances[index].tagName === 'IFRAME' && call[0] === 'src')
    .map((call) => call[1]);
  await render('/search');
  expect(frames()).toHaveLength(1);
  const saleFrame = frame();
  expect(saleFrame.getAttribute('src')).toBe(GAMLS_SALE_SEARCH_URL);

  await act(async () => navigate('/search?status=rent'));
  expect(frames()).toHaveLength(2);
  const rentalFrame = frame();
  expect(rentalFrame).not.toBe(saleFrame);
  expect(rentalFrame.getAttribute('src')).toBe(GAMLS_RENTAL_SEARCH_URL);
  expect(saleFrame.isConnected).toBe(true);
  expect(saleFrame.hidden).toBe(true);
  expect(saleFrame.getAttribute('src')).toBe(GAMLS_SALE_SEARCH_URL);

  await act(async () => navigate(-1));
  expect(address()).toBe('/search');
  expect(frame()).toBe(saleFrame);
  expect(rentalFrame.isConnected).toBe(true);
  expect(rentalFrame.hidden).toBe(true);
  expect(container.querySelector('.de-idx__notice')).toBeNull();

  await act(async () => navigate(1));
  expect(address()).toBe('/search?status=rent');
  expect(frame()).toBe(rentalFrame);
  expect(saleFrame.hidden).toBe(true);
  expect(container.textContent).toContain('Looking for a rental?');

  // Each frame was given its address once, when it was created, and never again.
  expect(frames()).toEqual([saleFrame, rentalFrame]);
  expect(srcWrites()).toEqual([GAMLS_SALE_SEARCH_URL, GAMLS_RENTAL_SEARCH_URL]);
  expect(assigned).not.toHaveBeenCalled();
  assigned.mockRestore();
  attributes.mockRestore();
});
test('a page opened on rentals loads only the rentals search until for-sale is asked for', async () => {
  await render('/search?status=rent');
  expect(frames()).toHaveLength(1);
  const rentalFrame = frame();
  await click([...container.querySelectorAll('.de-idx__notice a')].find((a) => a.textContent === 'Show homes for sale instead'));
  expect(frames()).toHaveLength(2);
  // The for-sale frame is added without moving the rentals frame, which would reload it.
  expect(frames().map((item) => item.getAttribute('src'))).toEqual([GAMLS_SALE_SEARCH_URL, GAMLS_RENTAL_SEARCH_URL]);
  expect(rentalFrame.isConnected).toBe(true);
  expect(rentalFrame.hidden).toBe(true);
  expect(frame().getAttribute('src')).toBe(GAMLS_SALE_SEARCH_URL);
});
test('the hidden search cannot be shown by the stylesheet', () => {
  const css = require('fs').readFileSync(require('path').resolve(__dirname, 'Search.css'), 'utf8');
  expect(css).toMatch(/\.de-idx__frame\[hidden\]\s*\{\s*display:\s*none;/);
});
test('a note-only change keeps the same frame, so a search in progress is not thrown away', async () => {
  await render('/search?q=Atlanta&status=rent');
  const before = frame();
  await click([...container.querySelectorAll('.de-idx__notice a')].find((a) => a.textContent === 'Hide this note'));
  expect(address()).toBe('/search?status=rent');
  expect(container.textContent).not.toContain('“Atlanta”');
  expect(frame()).toBe(before);
});
test('"Show homes for sale instead" keeps the note about the older link', async () => {
  await render('/search?q=Atlanta&status=rent');
  await click([...container.querySelectorAll('.de-idx__notice a')].find((a) => a.textContent === 'Show homes for sale instead'));
  expect(address()).toBe('/search?q=Atlanta');
  expect(frame().getAttribute('src')).toBe(GAMLS_SALE_SEARCH_URL);
  expect(container.textContent).toContain('“Atlanta”');
});
test('"Start a new search" sends the visible search back to its form, keeps the frame, and says so for a while', async () => {
  vi.useFakeTimers();
  try {
    await render('/search?status=rent');
    const before = frame();
    const assigned = vi.spyOn(HTMLIFrameElement.prototype, 'src', 'set');
    expect(container.querySelector('.de-idx__status').textContent).toBe('');
    await click([...container.querySelectorAll('button')].find((b) => b.textContent === 'Start a new search'));
    // Same frame, sent to its starting address again: an ordinary step that Back can undo.
    expect(frame()).toBe(before);
    expect(assigned.mock.calls.map(([value]) => value)).toEqual([GAMLS_RENTAL_SEARCH_URL]);
    expect(address()).toBe('/search?status=rent');
    expect(container.querySelector('.de-idx__status').textContent).toBe('The search form has been reloaded.');
    await act(async () => { vi.advanceTimersByTime(RELOADED_NOTE_MS + 1); });
    expect(container.querySelector('.de-idx__status').textContent).toBe('');
    assigned.mockRestore();
  } finally {
    vi.useRealTimers();
  }
});
test('the reload message does not follow the visitor to the other search', async () => {
  await render('/search?status=rent');
  await click([...container.querySelectorAll('button')].find((b) => b.textContent === 'Start a new search'));
  expect(container.querySelector('.de-idx__status').textContent).toBe('The search form has been reloaded.');
  await act(async () => navigate('/search'));
  expect(container.querySelector('.de-idx__status').textContent).toBe('');
  await act(async () => navigate(-1));
  expect(container.querySelector('.de-idx__status').textContent).toBe('');
});
test('the page says what its link does and does not keep, and what to do if the search is blank', async () => {
  await render('/search');
  expect(container.querySelector('.de-idx__help').textContent).toContain('What you choose in the search stays inside Georgia MLS.');
  expect(container.querySelector('.de-idx__help').textContent).toContain('anyone you send the link to starts a new search');
  expect(container.querySelector('.de-idx__fallback').textContent).toContain('choose “Start a new search”');
});
