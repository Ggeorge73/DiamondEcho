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
  expect(offices.textContent).toContain('8735 Dunwoody Place');
  expect(offices.textContent).toContain('GA 30350, USA');
  expect(offices.querySelectorAll('h3')).toHaveLength(1);
  expect(offices.textContent).not.toMatch(/New York|Miami|Los Angeles/);
  // Only the phone number and inbox Gbenga supplied for publication.
  const links = [...offices.querySelectorAll('a[href^="tel:"], a[href^="mailto:"]')].map((link) => [link.getAttribute('href'), link.textContent]);
  expect(links).toEqual([['tel:+16785169717', '(678) 516-9717'], ['mailto:realtor@diamondecho.com', 'realtor@diamondecho.com']]);
  expect(offices.textContent).not.toMatch(/555/);
});

test('open menu no longer advertises the retired offices or 555 phone', async () => {
  await act(async () => { root.render(<MemoryRouter><Navbar /></MemoryRouter>); });
  await act(async () => { container.querySelector('button[aria-label="Open menu"]').click(); });
  const contact = container.querySelector('.mf-menu__contact');
  expect(contact.textContent).toContain('Georgia office');
  expect(contact.textContent).toContain('8735 Dunwoody Place');
  expect(contact.textContent).toContain('GA 30350, USA');
  expect(contact.textContent).not.toMatch(/New York|Miami|Los Angeles|555/);
  const links = [...contact.querySelectorAll('a[href^="tel:"], a[href^="mailto:"]')].map((link) => [link.getAttribute('href'), link.textContent]);
  expect(links).toEqual([['tel:+16785169717', '(678) 516-9717'], ['mailto:realtor@diamondecho.com', 'realtor@diamondecho.com']]);
});

test('footer links the privacy and terms pages', async () => {
  await act(async () => { root.render(<MemoryRouter><Footer /></MemoryRouter>); });
  const legal = container.querySelector('.mf-footer__legal');
  expect(legal.querySelector('a[href="/privacy"]').textContent).toBe('Privacy');
  expect(legal.querySelector('a[href="/terms"]').textContent).toBe('Terms of use');
  expect(legal.textContent).toContain('Equal Housing Opportunity');
});
