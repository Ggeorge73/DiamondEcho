import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { KeptSearch, GAMLS_SALE_SEARCH_URL, GAMLS_RENTAL_SEARCH_URL } from './Search';

// DE-21. Leaving the search page used to remove it together with its Georgia
// MLS frame. Back from "Ask about a property" showed the empty form instead of
// the listing, and Back presses that belonged to the removed frame did nothing.
// The page is now kept loaded and hidden while the visitor is elsewhere.

let container;
let root;
let location;
let navigate;
const Probe = () => {
  location = useLocation();
  navigate = useNavigate();
  return null;
};
const Other = ({ name }) => <main data-page={name}>{name} page</main>;
const render = async (entries, index = entries.length - 1) => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Probe />
      <Routes>
        <Route path="/search" element={null} />
        <Route path="/agents" element={<Other name="advisory" />} />
        <Route path="/inquire" element={<Other name="inquire" />} />
        <Route path="/" element={<Other name="home" />} />
      </Routes>
      <KeptSearch />
    </MemoryRouter>
  ));
};
const address = () => location.pathname + location.search;
const kept = () => container.querySelector('.de-kept');
const frames = () => [...container.querySelectorAll('iframe')];
const shownFrames = () => (kept() && !kept().hidden ? frames().filter((frame) => !frame.hidden) : []);
const go = async (to) => { await act(async () => navigate(to)); };

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.restoreAllMocks();
});

test('nothing is loaded from Georgia MLS until the visitor opens the search', async () => {
  await render(['/agents']);
  expect(kept()).toBeNull();
  expect(frames()).toHaveLength(0);
});

test('leaving the search hides it and keeps its frame; coming back shows the same frame', async () => {
  await render(['/search']);
  const frame = shownFrames()[0];
  expect(frame.getAttribute('src')).toBe(GAMLS_SALE_SEARCH_URL);

  await go('/inquire?type=buyer');
  expect(container.querySelector('[data-page="inquire"]')).not.toBeNull();
  expect(kept().hidden).toBe(true);
  expect(shownFrames()).toHaveLength(0);
  expect(frame.isConnected).toBe(true);
  expect(frames()).toEqual([frame]);

  await go(-1);
  expect(address()).toBe('/search');
  expect(kept().hidden).toBe(false);
  expect(shownFrames()).toEqual([frame]);
});

test('while hidden, the search neither reads nor rewrites the other page’s address', async () => {
  await render(['/search?status=rent']);
  const rentalFrame = shownFrames()[0];
  expect(rentalFrame.getAttribute('src')).toBe(GAMLS_RENTAL_SEARCH_URL);

  // An address on another page that happens to use the same parameter names,
  // in a form the search page would tidy if it were its own.
  await go('/inquire?status=%20SALE%20&q=%20%20padded%20%20');
  expect(address()).toBe('/inquire?status=%20SALE%20&q=%20%20padded%20%20');
  // The hidden search is still the rentals search it was left as.
  expect(frames()).toEqual([rentalFrame]);
  expect(rentalFrame.hidden).toBe(false);
  expect(kept().textContent).toContain('Looking for a rental?');
  expect(kept().textContent).not.toContain('padded');

  await go(-1);
  expect(address()).toBe('/search?status=rent');
  expect(shownFrames()).toEqual([rentalFrame]);
});

test('returning by a link to the other search shows that search and keeps the first', async () => {
  await render(['/search?status=rent']);
  const rentalFrame = shownFrames()[0];
  await go('/agents');
  await go('/search');
  expect(shownFrames()).toHaveLength(1);
  expect(shownFrames()[0].getAttribute('src')).toBe(GAMLS_SALE_SEARCH_URL);
  expect(rentalFrame.isConnected).toBe(true);
  expect(rentalFrame.hidden).toBe(true);
  expect(container.querySelector('.de-idx__notice')).toBeNull();
});

test('the page shows one main area at a time', async () => {
  await render(['/search']);
  const visibleMains = () => [...container.querySelectorAll('main')].filter((main) => !main.closest('[hidden]'));
  expect(visibleMains()).toHaveLength(1);
  await go('/agents');
  expect(visibleMains()).toHaveLength(1);
  expect(visibleMains()[0].getAttribute('data-page')).toBe('advisory');
});

test('Back to the search returns to where the visitor had scrolled; a link opens it at the top', async () => {
  await render(['/search']);
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 });
  await act(async () => window.dispatchEvent(new Event('scroll')));

  await go('/agents');
  // Scrolling on the other page is not remembered as the search's position.
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 30 });
  await act(async () => window.dispatchEvent(new Event('scroll')));

  window.scrollTo.mockClear();
  await go(-1);
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'instant' });

  await go('/agents');
  window.scrollTo.mockClear();
  await go('/search');
  expect(window.scrollTo).not.toHaveBeenCalled();
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
});

test('the hidden search page cannot be shown by the stylesheet', () => {
  const css = require('fs').readFileSync(require('path').resolve(__dirname, 'Search.css'), 'utf8');
  expect(css).toMatch(/\.de-kept\[hidden\]\s*\{\s*display:\s*none;/);
});

test('the app keeps the search page loaded instead of creating it for each visit', () => {
  const app = require('fs').readFileSync(require('path').resolve(__dirname, '../App.js'), 'utf8');
  expect(app).toContain('<KeptSearch />');
  expect(app).toMatch(/<Route path="\/search" element=\{null\} \/>/);
});
