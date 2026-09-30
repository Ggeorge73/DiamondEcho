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

test('footer lists only the approved Georgia office and no old office contact links', async () => {
  await act(async () => { root.render(<MemoryRouter><Footer /></MemoryRouter>); });
  const offices = container.querySelector('.mf-offices');
  expect(offices.textContent).toContain('Georgia office');
  expect(offices.textContent).toContain('8735 Dunwoody Place');
  expect(offices.textContent).toContain('GA 30350, USA');
  expect(offices.querySelectorAll('h3')).toHaveLength(1);
  expect(offices.textContent).not.toMatch(/New York|Miami|Los Angeles/);
  expect(offices.querySelector('a[href^="tel:"], a[href^="mailto:"]')).toBeNull();
});

test('open menu no longer advertises the retired offices or 555 phone', async () => {
  await act(async () => { root.render(<MemoryRouter><Navbar /></MemoryRouter>); });
  await act(async () => { container.querySelector('button[aria-label="Open menu"]').click(); });
  const contact = container.querySelector('.mf-menu__contact');
  expect(contact.textContent).toContain('Georgia office');
  expect(contact.textContent).toContain('8735 Dunwoody Place');
  expect(contact.textContent).toContain('GA 30350, USA');
  expect(contact.textContent).not.toMatch(/New York|Miami|Los Angeles|555/);
  expect(contact.querySelector('a[href^="tel:"], a[href^="mailto:"]')).toBeNull();
});
