import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Inquire from './Inquire';

let container;
let root;

const savedBackend = process.env.REACT_APP_BACKEND_URL;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  // The form is offered only when an inquiry service is configured.
  process.env.REACT_APP_BACKEND_URL = 'https://api.example.test';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  if (savedBackend === undefined) delete process.env.REACT_APP_BACKEND_URL;
  else process.env.REACT_APP_BACKEND_URL = savedBackend;
});

test('an old listing parameter does not turn a tour request into a sample-property inquiry', async () => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/inquire?type=tour&listing=1']}><Inquire /></MemoryRouter>);
  });
  expect(container.textContent).toContain('Tour request');
  expect(container.querySelector('#inquiry-propertyAddress')).not.toBeNull();
  expect(container.querySelector('.de-inquiry-property')).toBeNull();
  expect(container.querySelector('#inquiry-propertyAddress').value).toBe('');
  expect(container.querySelector('a[href="/inquire?type=tour"][aria-current="page"]')).not.toBeNull();
});

test('tour requests are discoverable from the inquiry page without a sample listing', async () => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/inquire?type=buyer']}><Inquire /></MemoryRouter>);
  });
  expect(container.querySelector('a[href="/inquire?type=tour"]')).not.toBeNull();
  expect(container.querySelector('.de-inquiry-property')).toBeNull();
});

describe('with no inquiry service connected', () => {
  beforeEach(() => { delete process.env.REACT_APP_BACKEND_URL; });

  test.each([
    ['buyer', 'Buyer inquiries are not open yet.', 'buyer inquiries'],
    ['seller', 'Seller consultations are not open yet.', 'seller consultation requests'],
    ['tour', 'Tour requests are not open yet.', 'tour requests'],
  ])('the %s page shows a notice and offers no form', async (kind, title, what) => {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[`/inquire?type=${kind}`]}><Inquire /></MemoryRouter>);
    });
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input, textarea, button[type="submit"]')).toBeNull();
    expect(container.querySelector('h1').textContent).toBe(title);
    expect(container.textContent).toContain('Online requests are not open yet.');
    expect(container.textContent).toContain(`DiamondEcho is not yet taking ${what} through this website, so nothing can be sent from this page. No details are collected here.`);
    // No promise that anyone will follow up while nothing can be sent.
    expect(container.textContent).not.toMatch(/advisor can (follow up|review)/);
    expect(container.textContent).toContain('8735 Dunwoody Place');
    expect(container.textContent).toContain('GA 30350, USA');
    // The notice gives the approved phone number and inbox, and nothing else.
    const links = [...container.querySelectorAll('a[href^="tel:"], a[href^="mailto:"]')].map((link) => [link.getAttribute('href'), link.textContent]);
    expect(links).toEqual([['tel:+16785169717', '(678) 516-9717'], ['mailto:realtor@diamondecho.com', 'realtor@diamondecho.com']]);
    expect(container.textContent).toContain('Reach DiamondEcho directly');
    expect(container.querySelector('a[href="/search"]')).not.toBeNull();
    expect(container.querySelector('a[href="/investment-calculator"]')).not.toBeNull();
    expect(container.querySelector(`a[href="/inquire?type=${kind}"][aria-current="page"]`)).not.toBeNull();
  });

  test('a blank service address counts as not connected', async () => {
    process.env.REACT_APP_BACKEND_URL = '   ';
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/inquire?type=buyer']}><Inquire /></MemoryRouter>);
    });
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('Online requests are not open yet.');
  });
});

test('with an inquiry service connected the form is offered and the notice is not', async () => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/inquire?type=seller']}><Inquire /></MemoryRouter>);
  });
  expect(container.querySelector('form')).not.toBeNull();
  expect(container.querySelector('h1').textContent).toBe('Start a selling conversation.');
  expect(container.textContent).not.toContain('Online requests are not open yet.');
});
