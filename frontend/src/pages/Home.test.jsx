import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Home from './Home';
import { GAMLS_SEARCH_URL } from '../components/GamlsSearch';

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
  expect(frame.getAttribute('src')).toBe(GAMLS_SEARCH_URL);
  expect(frame.getAttribute('loading')).toBe('lazy');
  expect(frame.title).toBe('Georgia MLS property search');
  expect(container.querySelectorAll('iframe')).toHaveLength(1);
  expect(container.querySelector('.mf-prop-card')).toBeNull();
  expect(container.querySelector('.mf-counters')).toBeNull();
  expect(container.querySelector('#markets')).toBeNull();
  expect(container.querySelector('a[target="_blank"]')).toBeNull();
  for (const text of ['Sample property', 'Illustrative markets', 'Residences represented',
    'Assets under advisement', 'Client retention', '18.4%', 'Austin, TX']) {
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
