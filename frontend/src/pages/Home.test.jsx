import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Home from './Home';
import { GAMLS_SALE_SEARCH_URL } from '../components/GamlsSearch';

let container;
let root;
let originalObserver;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  originalObserver = global.IntersectionObserver;
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  global.IntersectionObserver = originalObserver;
});
test('homepage uses agent GAMLS search instead of sample inventory and market claims', async () => {
  await act(async () => root.render(<MemoryRouter><Home /></MemoryRouter>));
  const frame = container.querySelector('#collection iframe');
  expect(frame.getAttribute('src')).toBe(GAMLS_SALE_SEARCH_URL);
  expect(frame.getAttribute('loading')).toBe('lazy');
  expect(frame.title).toBe('Georgia MLS property search');
  expect(container.querySelectorAll('iframe')).toHaveLength(1);
  expect(container.querySelector('.mf-prop-card')).toBeNull();
  expect(container.querySelector('.mf-counters')).toBeNull();
  expect(container.querySelector('#markets')).toBeNull();
  expect(container.querySelector('a[target="_blank"]')).toBeNull();
  for (const text of ['Sample property', 'Illustrative markets', 'Residences represented',
    'Assets under advisement', 'Client retention', '18.4%', 'Austin, TX',
    'Meet the advisors', 'Private advisors']) {
    expect(container.textContent).not.toContain(text);
  }
  expect(container.querySelector('a[href="/inquire?type=buyer"]')).not.toBeNull();
});
test('every homepage section navigation target exists after removing sample sections', async () => {
  await act(async () => root.render(<MemoryRouter><Home /></MemoryRouter>));
  for (const label of ['overview', 'portfolio', 'collection', 'intelligence', 'portal', 'contact']) {
    expect(container.querySelector('#' + label)).not.toBeNull();
  }
  expect(container.querySelector('[aria-label="Go to Markets"]')).toBeNull();
});

// The cities are the ones Gbenga named on 2026-10-10 (lib/pageMeta.js). The
// section says where DiamondEcho works and nothing more: no counts, rankings
// or market figures, which would need a source and his approval (DE-17).
test('the home page says where DiamondEcho works, naming the approved cities and no others', async () => {
  const { SERVICE_AREAS } = require('../lib/pageMeta');
  await act(async () => root.render(<MemoryRouter><Home /></MemoryRouter>));
  const section = container.querySelector('section[aria-labelledby="home-areas-heading"]');
  expect(section.querySelector('h2').textContent).toBe('Homes and investmentsacross metro Atlanta.');
  expect(section.querySelector('h2 + p').textContent.replace(/\s+/g, ' ').trim()).toBe(
    'DiamondEcho works with home buyers, sellers and real estate investors in Alpharetta, Roswell, Duluth, Atlanta, Suwanee, Cumming and Lawrenceville, from the brokerage office in Duluth, Georgia.',
  );
  const tiles = [...section.querySelectorAll('.mf-areas li:not(.mf-areas__more)')];
  expect(tiles.map((tile) => [tile.querySelector('strong').textContent, tile.querySelector('small').textContent]))
    .toEqual(SERVICE_AREAS.map(({ city, county }) => [city, county]));
  // The last tile is a real link, so a search engine can follow it.
  expect(section.querySelector('.mf-areas__more a').getAttribute('href')).toBe('/search');
  expect(section.textContent).not.toMatch(/\d|#1|best|top|leading|expert|specialist/i);
});
