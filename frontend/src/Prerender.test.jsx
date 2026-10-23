/**
 * The saved pages (scripts/prerender.mjs draws them with src/prerender.jsx).
 * Each public page is drawn to HTML text here exactly as the build draws it,
 * then handed to the app the way a browser hands it over, and the app must
 * take it as it stands.
 */
import React, { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { BROKERAGE, OFFICE } from './lib/contact';
import { PAGES, SERVICE_AREAS } from './lib/pageMeta';
import { prerenderGuard, renderPage } from './prerender';

// No page may reach the network from a test: every request simply never answers.
jest.mock('axios', () => {
  const pending = () => new Promise(() => {});
  return { get: jest.fn(pending), post: jest.fn(pending) };
});

const savedBackend = process.env.REACT_APP_BACKEND_URL;
const originalObserver = global.IntersectionObserver;
const originalFetch = global.fetch;
let container;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = jest.fn();
  global.fetch = jest.fn(() => new Promise(() => {}));
  global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
  global.IntersectionObserver = originalObserver;
  global.fetch = originalFetch;
  if (savedBackend === undefined) delete process.env.REACT_APP_BACKEND_URL;
  else process.env.REACT_APP_BACKEND_URL = savedBackend;
});

const text = (html) => { const holder = document.createElement('div'); holder.innerHTML = html; return holder.textContent; };

// Both builds exist: with the request service (production) and without it (pull-request previews).
describe.each([
  ['with the request service', 'https://api.example.com'],
  ['without the request service', ''],
])('%s', (_, backend) => {
  beforeEach(() => {
    if (backend) process.env.REACT_APP_BACKEND_URL = backend;
    else delete process.env.REACT_APP_BACKEND_URL;
  });

  test.each(PAGES.map((page) => page.path))('%s is drawn with one main heading, the brokerage and the office', (address) => {
    const html = renderPage(address);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    expect(holder.querySelectorAll('h1')).toHaveLength(1);
    expect(holder.querySelector('h1').textContent.trim().length).toBeGreaterThan(5);
    const words = holder.textContent;
    // Georgia Real Estate Commission Rule 520-1-.09: the firm's name and number on every page.
    expect(words).toContain(BROKERAGE.name);
    expect(words).toContain(BROKERAGE.phone);
    expect(words).toContain(OFFICE.addressLines[0]);
    expect(words).not.toContain('We can’t find that page.');
    expect(words).not.toMatch(/undefined|\[object Object\]|NaN/);
  });

  test.each(PAGES.map((page) => page.path))('%s is taken over by the app as it stands', async (address) => {
    container.innerHTML = renderPage(address);
    const before = container.querySelector('h1');
    const redrawn = [];
    const complaints = jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      root = hydrateRoot(container, <React.StrictMode><App Router={MemoryRouter} initialEntries={[address]} /></React.StrictMode>, {
        onRecoverableError: (error) => redrawn.push(String(error && error.message)),
      });
    });
    const said = complaints.mock.calls.map((call) => String(call[0]));
    complaints.mockRestore();
    // Nothing had to be redrawn, and React had nothing to say about a mismatch.
    expect(redrawn).toEqual([]);
    expect(said.filter((line) => /hydrat|did not match|mismatch/i.test(line))).toEqual([]);
    // The heading the browser was given is still the one on the page.
    expect(container.querySelector('h1')).toBe(before);
  });
});

test('the home page names the cities DiamondEcho works in', () => {
  const words = text(renderPage('/'));
  SERVICE_AREAS.forEach(({ city }) => expect(words).toContain(city));
});

test('the calculators are drawn with their own headings at their own addresses', () => {
  expect(text(renderPage('/mortgage-calculator'))).toContain('Know the paymentbefore the offer.');
  expect(text(renderPage('/seller-net-sheet'))).toContain('See what you keepafter closing.');
  expect(text(renderPage('/investment-calculator'))).toContain('Underwrite withabsolute clarity.');
});

test('the request page is drawn as the buyer request, the one its plain address shows', () => {
  process.env.REACT_APP_BACKEND_URL = 'https://api.example.com';
  expect(text(renderPage('/inquire'))).toContain('Tell us what you are looking for.');
});

test('an address the site does not have is drawn as the not-found screen, which the build never saves', () => {
  expect(text(renderPage('/no-such-page'))).toContain('We can’t find that page.');
  expect(PAGES.map((page) => page.path)).not.toContain('/no-such-page');
});

test('the guard written into each page is the saved-page test, whole', () => {
  expect(prerenderGuard).toMatch(/^function prerenderMatches\(/);
  expect(prerenderGuard).toContain('data-prerendered');
});
