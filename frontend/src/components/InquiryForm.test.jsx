import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import InquiryForm from './InquiryForm';

// The page imports axios as a default export.
vi.mock('axios', () => { const axios = { post: vi.fn() }; return { default: axios, ...axios }; });
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => require('react').createElement('a', { href: to, ...props }, children),
}));

let container;
let root;
let originalCryptoDescriptor;

const input = (name) => container.querySelector('#inquiry-' + name);
const fill = async (name, value) => {
  const node = input(name);
  const setter = Object.getOwnPropertyDescriptor(node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const consent = async () => { await act(async () => { input('consent').click(); }); };
const submit = async () => {
  await act(async () => { container.querySelector('button[type="submit"]').click(); });
};
const renderForm = async (kind) => {
  await act(async () => { root.render(<InquiryForm kind={kind} />); });
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' },
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

test('buyer request requires name, email, message, and explicit consent', async () => {
  await renderForm('buyer');
  await submit();
  expect(input('fullName').getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(input('fullName'));
  expect(axios.post).not.toHaveBeenCalled();
  await fill('fullName', 'A Buyer');
  await fill('email', 'buyer@example.com');
  await fill('message', 'Looking for a two-bedroom home.');
  expect(input('fullName').value).toBe('A Buyer');
  expect(input('fullName').getAttribute('aria-invalid')).toBe('false');
  await submit();
  expect(input('consent').getAttribute('aria-invalid')).toBe('true');
  expect(axios.post).not.toHaveBeenCalled();
  await consent();
  expect(input('consent').checked).toBe(true);
  expect(input('consent').getAttribute('aria-invalid')).toBe('false');
  axios.post.mockResolvedValueOnce({ status: 201, data: { status: 'queued', request_id: 'REQ-B', submitted_at: '2026-09-24T12:00:00Z' } });
  await submit();
  expect(container.textContent).not.toContain('Request needs attention');
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls[0][1]).toMatchObject({
    kind: 'buyer', full_name: 'A Buyer', email: 'buyer@example.com',
    message: 'Looking for a two-bedroom home.', consent: true,
  });
  expect(container.textContent).toContain('DiamondEcho received your request.');
});

test('seller consultation includes address and details', async () => {
  await renderForm('seller');
  await fill('fullName', 'A Seller');
  await fill('email', 'seller@example.com');
  await fill('propertyAddress', '10 Main St, Atlanta, GA');
  await consent();
  await submit();
  expect(input('message').getAttribute('aria-invalid')).toBe('true');
  expect(axios.post).not.toHaveBeenCalled();
  await fill('message', 'Please discuss a potential sale.');
  axios.post.mockResolvedValueOnce({ status: 201, data: { status: 'queued', request_id: 'REQ-S' } });
  await submit();
  expect(axios.post.mock.calls[0][1]).toMatchObject({
    kind: 'seller', property_address: '10 Main St, Atlanta, GA', message: 'Please discuss a potential sale.',
  });
});

test('tour requires an address and sends offset-aware requested time without booking language', async () => {
  await renderForm('tour');
  await fill('fullName', 'Tour Guest');
  await fill('email', 'tour@example.com');
  await fill('propertyAddress', '7 Oak Rd, Atlanta, GA');
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const localFuture = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await fill('preferredTime', localFuture);
  await consent();
  axios.post.mockResolvedValueOnce({ status: 201, data: { status: 'queued', request_id: 'REQ-T' } });
  await submit();
  const payload = axios.post.mock.calls[0][1];
  expect(payload).toMatchObject({ kind: 'tour', property_address: '7 Oak Rd, Atlanta, GA', consent: true });
  expect(payload).not.toHaveProperty('property_id');
  expect(payload.preferred_tour_time).toMatch(/Z$/);
  expect(container.textContent).toContain('The visit is not booked or confirmed.');
});

test('503 remains an error; duplicate submit is guarded and retry reuses its key', async () => {
  await renderForm('buyer');
  await fill('fullName', 'Retry Buyer');
  await fill('email', 'retry@example.com');
  await fill('message', 'Interested in buying.');
  await consent();
  let rejectFirst;
  axios.post.mockReturnValueOnce(new Promise((resolve, reject) => { rejectFirst = reject; }));
  await submit();
  await submit();
  expect(axios.post).toHaveBeenCalledTimes(1);
  const key = axios.post.mock.calls[0][2].headers['X-Idempotency-Key'];
  await act(async () => {
    rejectFirst({ response: { status: 503, data: { detail: 'The staff queue is unavailable. Please retry with the same submission key.' } } });
  });
  expect(container.textContent).toContain('Your request has not been confirmed');
  expect(container.textContent).not.toContain('DiamondEcho received your request');
  axios.post.mockResolvedValueOnce({ status: 200, data: { status: 'queued', request_id: 'REQ-R' } });
  await submit();
  expect(axios.post).toHaveBeenCalledTimes(2);
  expect(axios.post.mock.calls[1][2].headers['X-Idempotency-Key']).toBe(key);
  expect(container.textContent).toContain('DiamondEcho received your request.');
});

test('a request refused by the submission limit shows the reason, keeps the form and confirms nothing', async () => {
  await renderForm('buyer');
  await fill('fullName', 'Limited Buyer');
  await fill('email', 'limited@example.com');
  await fill('message', 'Interested in buying.');
  await consent();
  const reason = 'Too many requests were sent from this connection. Please wait a few minutes and try again, or call or email us.';
  axios.post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 429, data: { detail: reason } } });
  await submit();
  const alert = container.querySelector('[role="alert"]');
  expect(alert.textContent).toContain(reason);
  expect(alert.textContent).toContain('Your request has not been confirmed');
  expect(container.textContent).not.toContain('DiamondEcho received your request');
  expect(input('fullName').value).toBe('Limited Buyer');
  expect(input('message').value).toBe('Interested in buying.');
  expect(container.querySelector('button[type="submit"]').disabled).toBe(false);
});

test('getRandomValues fallback generates a UUID header', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: (bytes) => bytes.fill(7) },
  });
  await renderForm('buyer');
  await fill('fullName', 'Fallback Buyer');
  await fill('email', 'fallback@example.com');
  await fill('message', 'Interested in buying.');
  await consent();
  axios.post.mockResolvedValueOnce({ status: 201, data: { status: 'queued', request_id: 'REQ-F' } });
  await submit();
  expect(axios.post.mock.calls[0][2].headers['X-Idempotency-Key'])
    .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test.each([
  ['a service that refuses the request', { isAxiosError: true, message: 'Request failed with status code 405', response: { status: 405, data: 'Method Not Allowed' } }],
  ['an unreachable service', { isAxiosError: true, message: 'Network Error' }],
])('%s is reported in plain words, never as success', async (_label, failure) => {
  axios.post.mockRejectedValueOnce(failure);
  await renderForm('buyer');
  await fill('fullName', 'A Buyer');
  await fill('email', 'buyer@example.com');
  await fill('message', 'Interested in buying.');
  await consent();
  await submit();
  const alert = container.querySelector('[role="alert"]');
  expect(alert.textContent).toContain('We could not send your request just now. Nothing was submitted.');
  expect(alert.textContent).not.toMatch(/status code|Network Error/);
  expect(container.querySelector('.de-inquiry-receipt')).toBeNull();
  expect(input('fullName').value).toBe('A Buyer');
});

const HOURS_LABEL = 'Monday to Saturday, 9:00 AM to 5:00 PM Eastern';
const sendBuyer = async (submittedAt) => {
  await renderForm('buyer');
  await fill('fullName', 'A Buyer'); await fill('email', 'buyer@example.com');
  await fill('message', 'Looking for a home.'); await consent();
  axios.post.mockResolvedValueOnce({ status: 201, data: { status: 'queued', request_id: 'REQ-H', submitted_at: submittedAt } });
  await submit();
};

test('the form says requests are open at any hour and when replies are sent', async () => {
  await renderForm('buyer');
  expect(container.textContent).toContain('Requests can be sent at any hour. We reply during business hours: ' + HOURS_LABEL + '.');
});

test('a request received inside business hours is told the hours, with no out-of-hours notice', async () => {
  await sendBuyer('2026-10-06T15:00:00+00:00'); // Tuesday 11:00 AM Eastern
  expect(container.textContent).toContain('DiamondEcho received your request.');
  expect(container.textContent).toContain('We reply during business hours: ' + HOURS_LABEL + '.');
  expect(container.textContent).not.toContain('outside our business hours');
});

test('a request received outside business hours is told so and when to expect a reply', async () => {
  await sendBuyer('2026-10-11T16:00:00+00:00'); // Sunday noon Eastern
  expect(container.textContent).toContain('DiamondEcho received your request.');
  expect(container.textContent).toContain('Your request arrived outside our business hours. We reply ' + HOURS_LABEL + ', and will be in touch once we reopen.');
});

test('the out-of-hours notice follows the time the service recorded, not the clock on the device', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-06T15:00:00Z'), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
  try {
    await sendBuyer('2026-10-06T02:00:00+00:00'); // Monday 10:00 PM Eastern, while the device says Tuesday 11:00 AM
    expect(container.textContent).toContain('outside our business hours');
  } finally { vi.useRealTimers(); }
});

test('a receipt with no readable time is treated as out of hours rather than promising too much', async () => {
  await sendBuyer(undefined);
  expect(container.textContent).toContain('outside our business hours');
});
