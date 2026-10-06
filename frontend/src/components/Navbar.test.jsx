import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import RealEstateAssistant from './assistant/RealEstateAssistant';

let container;
let root;
const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
};
const renderMenu = async (withAssistant = false) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/']}>
      <Navbar /><LocationProbe />{withAssistant && <RealEstateAssistant />}
    </MemoryRouter>
  ));
  const opener = container.querySelector('.mf-nav__burger');
  await act(async () => opener.click());
  return { opener, dialog: container.querySelector('[role="dialog"]') };
};
const press = async (key, shiftKey = false) => {
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', {
    key, shiftKey, bubbles: true, cancelable: true,
  })));
};

const savedBackend = process.env.REACT_APP_BACKEND_URL;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => {
  if (savedBackend === undefined) delete process.env.REACT_APP_BACKEND_URL;
  else process.env.REACT_APP_BACKEND_URL = savedBackend;
  if (root) await act(async () => root.unmount());
  container?.remove();
  container = null;
  root = null;
  document.body.style.overflow = '';
});

test('menu enters modal focus, traps Tab and returns focus on Escape', async () => {
  document.body.style.overflow = 'auto';
  const { opener, dialog } = await renderMenu();
  const first = dialog.querySelector('.mf-menu__close');
  const last = [...dialog.querySelectorAll('a[href], button:not([disabled])')].at(-1);
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(opener.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(first);
  expect(document.body.style.overflow).toBe('hidden');
  await press('Tab', true);
  expect(document.activeElement).toBe(last);
  await press('Tab');
  expect(document.activeElement).toBe(first);
  await press('Escape');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(opener.getAttribute('aria-expanded')).toBe('false');
  expect(document.body.style.overflow).toBe('auto');
});

test('close control and route links dismiss menu; rental URL is preserved', async () => {
  let { opener, dialog } = await renderMenu();
  await act(async () => dialog.querySelector('.mf-menu__close').click());
  expect(document.activeElement).toBe(opener);
  await act(async () => opener.click());
  dialog = container.querySelector('[role="dialog"]');
  const rentals = [...dialog.querySelectorAll('.mf-menu__primary a')].find((link) => link.textContent.includes('Rentals'));
  await act(async () => rentals.click());
  expect(container.querySelector('[data-testid="location"]').textContent).toBe('/search?status=rent');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.style.overflow).toBe('');
});

test('lower secondary menu actions remain in the same dialog', async () => {
  const { dialog } = await renderMenu();
  const seller = [...dialog.querySelectorAll('button')].find((button) => button.textContent.includes('Seller consultation'));
  expect(seller).toBeDefined();
  await act(async () => seller.click());
  expect(container.querySelector('[data-testid="location"]').textContent).toBe('/inquire?type=seller');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

test('the menu does not offer the concierge on a build with no service', async () => {
  delete process.env.REACT_APP_BACKEND_URL;
  const { dialog } = await renderMenu(true);
  expect(dialog.textContent).not.toContain('Ask the concierge');
  expect(container.querySelector('button[aria-label="Ask DiamondEcho assistant"]')).toBeNull();
  // The other menu actions are still there.
  for (const label of ['Search Georgia MLS', 'Run a deal analysis', 'Explore advisory', 'Buyer inquiry', 'Seller consultation']) {
    expect(dialog.textContent).toContain(label);
  }
});

test('concierge action hands focus to assistant and closing returns to its trigger', async () => {
  process.env.REACT_APP_BACKEND_URL = 'https://api.example.test';
  const { dialog } = await renderMenu(true);
  const concierge = [...dialog.querySelectorAll('button')].find((button) => button.textContent.includes('Ask the concierge'));
  await act(async () => concierge.click());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  const prompt = container.querySelector('textarea[placeholder^="Ask a real-estate question"]');
  expect(prompt).not.toBeNull();
  expect(document.activeElement).toBe(prompt);
  await act(async () => container.querySelector('button[aria-label="Close assistant"]').click());
  expect(document.activeElement).toBe(container.querySelector('button[aria-label="Ask DiamondEcho assistant"]'));
});
