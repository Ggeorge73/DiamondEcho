import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import Home from './Home';
import Navbar from '../components/Navbar';

// DE-32: a phone visitor must be able to see what a desktop visitor sees.
// Gbenga found on his Android phone that the hero's description and link were
// missing; they were hidden by a rule for narrow screens.

const css = fs.readFileSync(path.resolve(__dirname, '../App.css'), 'utf8');

// Selectors that carry words or links a visitor needs. Hiding one of these at
// any screen width repeats the defect.
const mustStayVisible = ['.mf-hero__panel', '.deal-studio-hero__seal', '.mf-divisions', '.mf-hero__brand', '.mf-hero__index'];

test.each(mustStayVisible)('%s is never hidden by the stylesheet', (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hides = new RegExp(`${escaped}(?![\\w-])[^{}]*\\{[^}]*(display:\\s*none|visibility:\\s*hidden)`);
  expect(css).not.toMatch(hides);
});

test('the phone hero is laid out in a column so the panel cannot sit on top of the list', () => {
  const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
  expect(phone).toMatch(/\.mf-hero \{[^}]*display: flex;[^}]*flex-direction: column;/);
  expect(phone).toMatch(/\.mf-hero__content \{[^}]*position: relative;/);
  expect(phone).toMatch(/\.mf-hero__panel \{[^}]*position: relative;/);
  // The link is large enough to tap.
  expect(phone).toMatch(/\.mf-hero__panel a \{[^}]*min-height: 44px;/);
});

describe('rendered pages', () => {
  let container;
  let root;
  let originalObserver;
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    originalObserver = global.IntersectionObserver;
    global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    global.IntersectionObserver = originalObserver;
    document.body.style.overflow = '';
  });

  test('every hero division has a description and a link in the panel', async () => {
    await act(async () => root.render(<MemoryRouter><Home /></MemoryRouter>));
    const buttons = [...container.querySelectorAll('.mf-divisions button')];
    expect(buttons).toHaveLength(4);
    const seen = [];
    for (const button of buttons) {
      if (!button.classList.contains('is-active')) await act(async () => button.click());
      const panel = container.querySelector('.mf-hero__panel');
      expect(panel.querySelector('p').textContent.length).toBeGreaterThan(30);
      expect(panel.querySelector('a').getAttribute('href')).toMatch(/^\//);
      expect(panel.querySelector('a').textContent.trim().length).toBeGreaterThan(5);
      seen.push(panel.querySelector('small').textContent);
    }
    expect(new Set(seen).size).toBe(4);
  });

  test('the phone menu uses the same words, in the same order, as the desktop header', async () => {
    await act(async () => root.render(<MemoryRouter><Navbar /></MemoryRouter>));
    const desktop = [...container.querySelectorAll('.mf-nav__links a')].map((link) => link.textContent.trim());
    expect(desktop).toEqual(['Search homes', 'Rentals', 'Intelligence', 'Advisory', 'The Firm']);
    await act(async () => container.querySelector('.mf-nav__burger').click());
    const menu = [...container.querySelectorAll('.mf-menu__primary a, .mf-menu__primary button')]
      .map((item) => item.textContent.replace(/^\s*\d+\s*/, '').trim())
      .filter((text) => text && text !== 'Close menu');
    expect(menu).toEqual(desktop);
  });
});
