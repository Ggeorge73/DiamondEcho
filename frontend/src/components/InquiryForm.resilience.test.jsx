// What a visitor sees when the inquiry service is down, slow or answering
// nonsense. The everyday failures (503, 429, 405, no answer at all) are in
// InquiryForm.test.jsx; this file covers the outages that file does not:
// the platform's own 502 and 504 pages, a retry after the connection dropped,
// a "200" that is not a receipt, and a request that never answers.
//
// A test written with `test.fails` is a weakness found by the SRE chaos role
// and listed in docs/sre/chaos-and-game-days.md. It passes while the weakness
// is there and fails the day it is fixed, so the mark is removed then and the
// behaviour stays protected. W7 (no time limit) and W9 (no phone or email in
// the alert) were fixed on 2026-11-14 and are ordinary tests below; none is
// left open in this file.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import InquiryForm, { INQUIRY_REQUEST_TIMEOUT_MS } from './InquiryForm';
import { BROKERAGE, OFFICE } from '../lib/contact';

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
const NOT_SENT = "We couldn't send your request. Please try again, or call or email us.";
const sentKeys = () => axios.post.mock.calls.map((call) => call[2].headers['X-Idempotency-Key']);
// The failure notice: the one sentence, the contact links from lib/contact.js,
// focus on the notice, no receipt, and the form exactly as typed.
const expectNotSent = () => {
  const alert = container.querySelector('[role="alert"]');
  expect(alert.textContent).toContain(NOT_SENT);
  expect(alert.textContent).toContain('Your request has not been confirmed');
  expect(alert.querySelector(`a[href="${OFFICE.phoneHref}"]`).textContent).toContain(OFFICE.phone);
  expect(alert.querySelector(`a[href="${OFFICE.emailHref}"]`).textContent).toContain(OFFICE.email);
  expect(alert.querySelector(`a[href="${BROKERAGE.phoneHref}"]`).textContent).toContain(BROKERAGE.phone);
  expect(document.activeElement).toBe(alert);
  expect(receipt()).toBeNull();
  expect(container.textContent).not.toContain('DiamondEcho received your request');
  expectNothingLost();
};

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
  expectNotSent();

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
  expectNotSent();
  expect(alertText()).not.toMatch(/status code|Bad Gateway|upstream|UNAVAILABLE|\[object Object\]/);
});

test.each([
  ['an HTML page answered with 200 (a captive portal or a proxy)', { status: 200, data: '<html><body>Sign in to Wi-Fi</body></html>' }],
  ['a 200 with no reference', { status: 200, data: { status: 'queued' } }],
  ['a 202 that says something else', { status: 202, data: { status: 'accepted', request_id: 'REQ-X' } }],
  ['a 200 whose reference is empty', { status: 200, data: { status: 'queued', request_id: '' } }],
  ['a 200 whose reference is not text', { status: 200, data: { status: 'queued', request_id: { id: 1 } } }],
  ['a 200 with an empty body', { status: 200, data: '' }],
  ['a 204 with a receipt-shaped body', { status: 204, data: { status: 'queued', request_id: 'REQ-Y' } }],
  ['a 201 with another status', { status: 201, data: { status: 'received', request_id: 'REQ-Z' } }],
])('%s is never shown as a received request', async (_label, answer) => {
  await fillEverything();
  axios.post.mockResolvedValueOnce(answer);
  await submit();
  expectNotSent();
  expect(alertText()).not.toMatch(/Wi-Fi|REQ-/);
});

// W7 in docs/sre/chaos-and-game-days.md, fixed 2026-11-14.
test('a request that never answers is given up after a deadline', async () => {
  await fillEverything();
  axios.post.mockReturnValueOnce(new Promise(() => {}));
  await submit();
  const options = axios.post.mock.calls[0][2];
  expect(options.timeout).toBe(INQUIRY_REQUEST_TIMEOUT_MS);
  expect(INQUIRY_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(10000);
  expect(INQUIRY_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30000);
});

test('when the deadline passes the visitor is told, nothing is lost, and the retry reuses the key', async () => {
  await fillEverything();
  // What axios rejects with when its `timeout` passes.
  axios.post.mockRejectedValueOnce({ isAxiosError: true, code: 'ECONNABORTED', message: `timeout of ${INQUIRY_REQUEST_TIMEOUT_MS}ms exceeded` });
  await submit();
  expectNotSent();
  expect(alertText()).not.toMatch(/timeout|exceeded|ECONNABORTED/);

  axios.post.mockResolvedValueOnce({ status: 200, data: { status: 'queued', request_id: 'REQ-T', submitted_at: '2026-10-06T15:00:00+00:00' } });
  await submit();
  expect(sentKeys()[1]).toBe(sentKeys()[0]);
  expect(receipt().textContent).toContain('REQ-T');
});

// W9 in docs/sre/chaos-and-game-days.md, fixed 2026-11-14.
test('when the service is down the alert offers a phone number or email to use instead', async () => {
  await fillEverything();
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
  await submit();
  const alert = container.querySelector('[role="alert"]');
  expect(alert.querySelector('a[href^="tel:"], a[href^="mailto:"]')).not.toBeNull();
  expectNotSent();
});

test('the limit on one connection (429) is said in our own words, with the contact details, and keeps the form', async () => {
  await fillEverything();
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: 'Request failed with status code 429', response: { status: 429, data: { detail: 'limiter bucket address exhausted' } } });
  await submit();
  const alert = container.querySelector('[role="alert"]');
  expect(alert.textContent).toContain('Too many requests were sent from this connection. Please wait a few minutes and try again, or call or email us.');
  expect(alert.textContent).not.toMatch(/limiter|bucket|status code/);
  expect(alert.querySelector(`a[href="${OFFICE.phoneHref}"]`)).not.toBeNull();
  expect(document.activeElement).toBe(alert);
  expect(receipt()).toBeNull();
  expectNothingLost();
});

test('only the stored-request answers are a success: 201 for a new request, 200 for the same key sent again', async () => {
  for (const status of [201, 200]) {
    await fillEverything();
    axios.post.mockResolvedValueOnce({ status, data: { status: 'queued', request_id: 'REQ-OK-' + status, submitted_at: '2026-10-06T15:00:00+00:00' } });
    await submit();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(receipt().textContent).toContain('REQ-OK-' + status);
    expect(document.activeElement).toBe(receipt());
    await act(async () => { root.render(null); });
  }
});

test('the key is kept across repeated failures, changes when the visitor edits the request, and the submit button works by keyboard', async () => {
  await fillEverything();
  axios.post.mockRejectedValue({ isAxiosError: true, message: 'Network Error' });
  await submit();
  await submit();
  expect(sentKeys()[1]).toBe(sentKeys()[0]);
  // Editing clears the notice; the changed request is a new one for the service.
  await fill('message', 'Looking near Decatur or Avondale.');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  axios.post.mockReset();
  axios.post.mockResolvedValueOnce({ status: 201, data: { status: 'queued', request_id: 'REQ-E' } });
  // A real submit button inside the form: Enter in a field or Space on the button sends it.
  const send = container.querySelector('form button[type="submit"]');
  expect(send.disabled).toBe(false);
  await act(async () => { container.querySelector('form').requestSubmit(send); });
  expect(axios.post.mock.calls[0][2].headers['X-Idempotency-Key']).not.toBe('123e4567-e89b-42d3-a456-426614174000');
  expect(axios.post.mock.calls[0][1].message).toBe('Looking near Decatur or Avondale.');
  expect(receipt()).not.toBeNull();
});

test('a key the service says belongs to another request (409) is not sent again', async () => {
  await fillEverything();
  axios.post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: { detail: 'This submission key was already used for a different request.' } } });
  await submit();
  expectNotSent();
  expect(alertText()).not.toContain('submission key');
  axios.post.mockResolvedValueOnce({ status: 201, data: { status: 'queued', request_id: 'REQ-N' } });
  await submit();
  expect(sentKeys()[1]).not.toBe(sentKeys()[0]);
});

test('fields the service refuses (422) are marked beside the field in our words, never the service text', async () => {
  await fillEverything();
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: 'Request failed with status code 422', response: { status: 422, data: { detail: [
    { type: 'value_error', loc: ['body', 'email'], msg: 'value is not a valid email address: The part after the @-sign is not valid.', input: 'outage@example.com' },
    { type: 'string_too_short', loc: ['body', 'full_name'], msg: 'String should have at least 2 characters', ctx: { min_length: 2 } },
  ] } } });
  await submit();
  const alert = container.querySelector('[role="alert"]');
  expect(alert.textContent).toContain('Please check your details');
  expect(alert.textContent).toContain('Some of your details need another look. Check the fields marked below, then submit again.');
  expect(document.activeElement).toBe(alert);
  expect(input('email').getAttribute('aria-invalid')).toBe('true');
  expect(container.querySelector('#inquiry-email-error').textContent).toBe('Enter a valid email address.');
  expect(input('email').getAttribute('aria-describedby')).toBe('inquiry-email-error');
  expect(container.querySelector('#inquiry-fullName-error').textContent).toBe('Please check your full name.');
  expect(container.textContent).not.toMatch(/@-sign|String should|value_error|status code|min_length/);
  expect(receipt()).toBeNull();
  expectNothingLost();
});

test('a 422 that names no field of the form is the plain failure notice, not server text', async () => {
  await fillEverything();
  axios.post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 422, data: { detail: [
    { type: 'uuid_parsing', loc: ['header', 'x-idempotency-key'], msg: 'Input should be a valid UUID' },
  ] } } });
  await submit();
  expectNotSent();
  expect(alertText()).not.toMatch(/UUID|idempotency/i);
});
