import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import { Privacy, Terms } from './Policies';

let container;
let root;

const savedBackend = process.env.REACT_APP_BACKEND_URL;
const shell = fs.readFileSync(path.resolve(__dirname, '../../public/index.html'), 'utf8').toLowerCase();

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  delete process.env.REACT_APP_BACKEND_URL;
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

const renderAt = async (address) => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[address]}>
        <Routes>
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
        </Routes>
      </MemoryRouter>,
    );
  });
};

test('privacy page says what the site does and does not collect', async () => {
  await renderAt('/privacy');
  expect(container.querySelectorAll('h1')).toHaveLength(1);
  expect(document.title).toBe('Privacy | DiamondEcho');
  const text = container.textContent;
  expect(text).toContain('do not use advertising trackers, analytics or session recording');
  expect(text).toContain('Georgia MLS');
  expect(text).toContain('Mapbox and RentCast');
  expect(text).toContain('Cloudflare');
  expect(text).toContain('Last updated');
  expect(container.querySelector('a[href="tel:+16785169717"]').textContent).toBe('(678) 516-9717');
  expect(container.querySelector('a[href="mailto:realtor@diamondecho.com"]')).not.toBeNull();
  expect(container.querySelector('a[href="/terms"]')).not.toBeNull();
});

test('the no-tracking statement on the privacy page matches the page shell', async () => {
  await renderAt('/privacy');
  expect(container.textContent).toContain('do not use advertising trackers, analytics or session recording');
  ['posthog', 'rrweb', 'emergent-main', 'googletagmanager', 'google-analytics', 'fbevents'].forEach((marker) => {
    expect(shell).not.toContain(marker);
  });
});

test('privacy page describes requests according to whether forms are open', async () => {
  await renderAt('/privacy');
  expect(container.textContent).toContain('Online request forms are not open yet, so this site does not currently collect');
  expect(container.textContent).not.toContain('we receive what you enter');

  await act(async () => { root.unmount(); });
  process.env.REACT_APP_BACKEND_URL = 'https://api.example.test';
  root = createRoot(container);
  await renderAt('/privacy');
  expect(container.textContent).toContain('we receive what you enter');
  expect(container.textContent).not.toContain('Online request forms are not open yet');
});

test('terms page states the limits of listings, Deal Studio and requests', async () => {
  await renderAt('/terms');
  expect(container.querySelectorAll('h1')).toHaveLength(1);
  expect(document.title).toBe('Terms of use | DiamondEcho');
  const text = container.textContent;
  expect(text).toContain('believed to be reliable but is not guaranteed');
  expect(text).toContain('not financial, investment, tax or legal advice');
  expect(text).toContain('A tour request is a request, not a booking');
  expect(text).toContain('equal housing opportunity');
  expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
});

test.each(['/privacy', '/terms'])('%s claims no legal certification or compliance badge', async (address) => {
  await renderAt(address);
  expect(container.textContent).not.toMatch(/GDPR|CCPA|certified|compliant|guarantee[sd]? (of|that)/i);
});
