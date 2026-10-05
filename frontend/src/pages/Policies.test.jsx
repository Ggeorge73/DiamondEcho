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
  expect(text).toContain("removes that tool's leftover cookie");
  expect(container.querySelector('a[href="tel:+16785169717"]').textContent).toBe('Direct (678) 516-9717');
  expect(container.querySelector('a[href="tel:+17704955050"]').textContent).toBe('Office (770) 495-5050');
  expect(text).toContain('Brokerage: Virtual Properties Realty.com');
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
  // No request service on this build, so Google Cloud is not involved and is not named.
  expect(container.textContent).not.toContain('Google Cloud');

  await act(async () => { root.unmount(); });
  process.env.REACT_APP_BACKEND_URL = 'https://api.example.test';
  root = createRoot(container);
  await renderAt('/privacy');
  expect(container.textContent).toContain('we receive what you enter');
  expect(container.textContent).not.toContain('Online request forms are not open yet');
  // With the request service in use, its host and the submission count are disclosed.
  expect(container.textContent).toContain("Google Cloud runs DiamondEcho's analysis and request service");
  expect(container.textContent).toContain('keeps routine request logs');
  expect(container.textContent).toContain('counts recent requests from each connection for a short time, in memory only');
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
  expect(text).toContain('operates under the real estate brokerage Virtual Properties Realty.com');
  expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
});

test.each(['/privacy', '/terms'])('%s claims no legal certification or compliance badge', async (address) => {
  await renderAt(address);
  expect(container.textContent).not.toMatch(/GDPR|CCPA|certified|compliant|guarantee[sd]? (of|that)/i);
});
