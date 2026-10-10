import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Footer from './Footer';
import Navbar from './Navbar';

let container;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

test('footer lists only the approved Georgia office, phone and inbox', async () => {
  await act(async () => { root.render(<MemoryRouter><Footer /></MemoryRouter>); });
  const offices = container.querySelector('.mf-offices');
  expect(offices.textContent).toContain('Georgia office');
  expect(offices.textContent).toContain('2750 Premiere Pkwy, Ste. 200');
  expect(offices.textContent).toContain('Duluth, GA 30097');
  // The address is the brokerage's office (Gbenga, 2026-10-06); the earlier one is gone.
  expect(offices.textContent).not.toMatch(/Dunwoody Place|30350/);
  expect([...offices.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Brokerage', 'Georgia office']);
  expect(offices.textContent).not.toMatch(/New York|Miami|Los Angeles/);
  // Only the phone number and inbox Gbenga supplied for publication.
  const links = [...offices.querySelectorAll('a[href^="tel:"], a[href^="mailto:"]')].map((link) => [link.getAttribute('href'), link.textContent]);
  expect(links).toEqual([
    ['tel:+17704955050', 'Office (770) 495-5050'],
    ['tel:+16785169717', 'Direct (678) 516-9717'],
    ['mailto:realtor@diamondecho.com', 'realtor@diamondecho.com'],
  ]);
  expect(offices.textContent).not.toMatch(/555-/);
});

test('open menu no longer advertises the retired offices or 555 phone', async () => {
  await act(async () => { root.render(<MemoryRouter><Navbar /></MemoryRouter>); });
  await act(async () => { container.querySelector('button[aria-label="Open menu"]').click(); });
  const contact = container.querySelector('.mf-menu__contact');
  expect(contact.textContent).toContain('Georgia office');
  expect(contact.textContent).toContain('2750 Premiere Pkwy, Ste. 200');
  expect(contact.textContent).toContain('Duluth, GA 30097');
  expect(contact.textContent).not.toMatch(/Dunwoody Place|30350/);
  expect(contact.textContent).not.toMatch(/New York|Miami|Los Angeles|555-/);
  const links = [...contact.querySelectorAll('a[href^="tel:"], a[href^="mailto:"]')].map((link) => [link.getAttribute('href'), link.textContent]);
  expect(links).toEqual([
    ['tel:+17704955050', 'Office (770) 495-5050'],
    ['tel:+16785169717', 'Direct (678) 516-9717'],
    ['mailto:realtor@diamondecho.com', 'realtor@diamondecho.com'],
  ]);
  expect(contact.textContent).toContain('Virtual Properties Realty.com');
});

test('footer links the privacy and terms pages', async () => {
  await act(async () => { root.render(<MemoryRouter><Footer /></MemoryRouter>); });
  const legal = container.querySelector('.mf-footer__legal');
  expect(legal.querySelector('a[href="/privacy"]').textContent).toBe('Privacy');
  expect(legal.querySelector('a[href="/terms"]').textContent).toBe('Terms of use');
  expect(legal.textContent).toContain('Equal Housing Opportunity');
});

// Georgia Real Estate Commission Rule 520-1-.09: the firm's name and the firm's
// telephone number on every page, at least as prominent as the licensee's own.
test('footer names the brokerage and its office number before the direct number, in the same style', async () => {
  await act(async () => { root.render(<MemoryRouter><Footer /></MemoryRouter>); });
  const offices = container.querySelector('.mf-offices');
  expect(offices.textContent).toContain('Virtual Properties Realty.com');
  const phones = [...offices.querySelectorAll('a[href^="tel:"]')];
  expect(phones.map((link) => link.getAttribute('href'))).toEqual(['tel:+17704955050', 'tel:+16785169717']);
  // Same element and class for both numbers, so neither is styled more prominently.
  expect(phones[0].tagName).toBe(phones[1].tagName);
  expect(phones[0].className).toBe(phones[1].className);
  expect(container.querySelector('.mf-footer__legal').textContent).toContain('Brokerage: Virtual Properties Realty.com');
});

// The saved HTML of a page carries the year it was built in (scripts/prerender.mjs).
test('the footer shows this year, and corrects a saved page that was built last year', async () => {
  const { hydrateRoot } = require('react-dom/client');
  const year = new Date().getFullYear();
  await act(async () => root.render(<MemoryRouter><Footer /></MemoryRouter>));
  expect(container.querySelector('.mf-footer__legal span').textContent).toMatch(new RegExp(`^© ${year} DiamondEcho Private Real Estate · Brokerage: Virtual Properties Realty\\.com`));

  const { renderToString } = require('react-dom/server');
  const saved = document.createElement('div');
  saved.innerHTML = renderToString(<MemoryRouter><Footer /></MemoryRouter>).replace(`>${year}<`, `>${year - 1}<`);
  document.body.appendChild(saved);
  expect(saved.querySelector('.mf-footer__legal span').textContent).toContain(`© ${year - 1} `);
  const redrawn = [];
  let taken;
  await act(async () => {
    taken = hydrateRoot(saved, <MemoryRouter><Footer /></MemoryRouter>, { onRecoverableError: (error) => redrawn.push(String(error)) });
  });
  expect(redrawn).toEqual([]);
  expect(saved.querySelector('.mf-footer__legal span').textContent).toContain(`© ${year} `);
  await act(async () => taken.unmount());
  saved.remove();
});
