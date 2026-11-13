// What a visitor sees when the inquiry service is down, slow or answering
// nonsense. The everyday failures (503, 429, 405, no answer at all) are in
// InquiryForm.test.jsx; this file covers the outages that file does not:
// the platform's own 502 and 504 pages, a retry after the connection dropped,
// a "200" that is not a receipt, and a request that never answers.
//
// A test written with `test.fails` is a weakness found by the SRE chaos role
// and listed in docs/sre/chaos-and-game-days.md. It passes while the weakness
// is there and fails the day it is fixed, so the mark is removed then and the
// behaviour stays protected. Application code is not changed from this file.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import InquiryForm from './InquiryForm';

vi.mock('axios', () => { const axios = { post: vi.fn() }; return { default: axios, ...axios }; });
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => require('react').createElement('a', { href: to, ...props }, children),
}));

let container;
let root;
let originalCryptoDescriptor;
let keys;

const input = (name) => container.querySelector('#inquiry-' + name);
const fill = async (name, value) => {
  const node = input(name);
  const setter = Object.getOwnPropertyDescriptor(node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const submit = async () => {
  await act(async () => { container.querySelector('button[type="submit"]').click(); });
};
const alertText = () => container.querySelector('[role="alert"]')?.textContent || '';
const receipt = () => container.querySelector('.de-inquiry-receipt');

const TYPED = { fullName: 'Outage Buyer', email: 'outage@example.com', phone: '404-555-0100', message: 'Looking near Decatur.' };
const fillEverything = async () => {
  await act(async () => { root.render(<InquiryForm kind="buyer" />); });
  for (const [name, value] of Object.entries(TYPED)) await fill(name, value);
  await act(async () => { input('consent').click(); });
};
const expectNothingLost = () => {
  for (const [name, value] of Object.entries(TYPED)) expect(input(name).value).toBe(value);
  expect(input('consent').checked).toBe(true);
  expect(container.querySelector('button[type="submit"]').disabled).toBe(false);
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  // A new key each time one is made, so a test can tell a reused key from a new one.
  keys = 0;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID: () => `123e4567-e89b-42d3-a456-42661417400${keys++}` },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.clearAllMocks();
  if (originalCryptoDescriptor) Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
  else delete globalThis.crypto;
});

test('a dropped connection loses nothing typed, and the retry reuses the key so a request that did land is not stored twice', async () => {
  await fillEverything();
  // The connection drops after the request left: the service may have stored it.
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
  await submit();
  expect(alertText()).toContain('Nothing was submitted');
  expect(alertText()).toContain('Your request has not been confirmed');
  expect(receipt()).toBeNull();
  expectNothingLost();

  axios.post.mockResolvedValueOnce({ status: 200, data: { status: 'queued', request_id: 'REQ-1' } });
  await submit();
  const [first, second] = axios.post.mock.calls.map((call) => call[2].headers['X-Idempotency-Key']);
  expect(second).toBe(first);
  expect(receipt()).not.toBeNull();
});

// Cloud Run answers these itself, as HTML or plain text, when the service
// does not answer within 30 seconds or no instance can start.
test.each([
  ['504 from the platform after its 30 second limit', { status: 504, data: 'upstream request timeout' }],
  ['502 from the platform with an HTML page', { status: 502, data: '<html><body>Bad Gateway</body></html>' }],
  ['503 with a JSON body that is not a sentence', { status: 503, data: { detail: { code: 'UNAVAILABLE' } } }],
  ['500 with an empty body', { status: 500, data: '' }],
])('%s is reported in plain words, keeps the form and confirms nothing', async (_label, response) => {
  await fillEverything();
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: `Request failed with status code ${response.status}`, response });
  await submit();
  expect(alertText()).toContain('We could not send your request just now. Nothing was submitted.');
  expect(alertText()).not.toMatch(/status code|Bad Gateway|upstream|UNAVAILABLE|\[object Object\]/);
  expect(receipt()).toBeNull();
  expectNothingLost();
});

test.each([
  ['an HTML page answered with 200 (a captive portal or a proxy)', { status: 200, data: '<html><body>Sign in to Wi-Fi</body></html>' }],
  ['a 200 with no reference', { status: 200, data: { status: 'queued' } }],
  ['a 202 that says something else', { status: 202, data: { status: 'accepted', request_id: 'REQ-X' } }],
])('%s is never shown as a received request', async (_label, answer) => {
  await fillEverything();
  axios.post.mockResolvedValueOnce(answer);
  await submit();
  expect(receipt()).toBeNull();
  expect(container.textContent).not.toContain('DiamondEcho received your request');
  expect(alertText()).toContain('We could not confirm your request. Please retry.');
  expectNothingLost();
});

test.fails('weakness: a request that never answers is given up after a deadline', async () => {
  // InquiryForm.jsx sends the request with axios and no `timeout`, and axios
  // waits for ever by default. If the connection stalls (a phone moving
  // between networks, a proxy that holds the request) the button stays on
  // "sending" and the visitor is never told to retry or call. Cloud Run's
  // 30 second limit only helps when the request reached Cloud Run.
  // Proposed fix: pass `timeout: 35000` with the request (a little over
  // Cloud Run's limit, so the platform's own answer normally arrives first);
  // the existing catch then reports "Nothing was submitted" and the retry
  // reuses the same key.
  await fillEverything();
  axios.post.mockReturnValueOnce(new Promise(() => {}));
  await submit();
  const options = axios.post.mock.calls[0][2];
  expect(Number.isFinite(options.timeout) && options.timeout > 0).toBe(true);
});

test.fails('weakness: when the service is down the alert offers a phone number or email to use instead', async () => {
  // The page shows only the form when online requests are open
  // (Inquire.jsx: the office phone and email are in the closed notice, the
  // navbar and the footer). When sending fails the alert says to retry, but
  // not that the visitor can call or email now. Only the service's own 429
  // and "busy" answers mention calling, and without a number.
  // Proposed fix: in the alert of InquiryForm.jsx add one line with
  // OFFICE.phoneHref and OFFICE.emailHref from the same constants Inquire.jsx uses.
  await fillEverything();
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
  await submit();
  const alert = container.querySelector('[role="alert"]');
  expect(alert.querySelector('a[href^="tel:"], a[href^="mailto:"]')).not.toBeNull();
});
