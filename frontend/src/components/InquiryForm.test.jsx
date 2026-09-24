import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import InquiryForm from './InquiryForm';

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('react-router-dom', () => ({
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
const renderForm = async (kind, property) => {
  await act(async () => { root.render(<InquiryForm kind={kind} property={property} />); });
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
  jest.clearAllMocks();
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

test('tour sends listing context and offset-aware requested time without booking language', async () => {
  const property = { id: 7, title: 'Test Residence', address: '7 Oak Rd', city: 'Atlanta', state: 'GA', zip: '30301' };
  await renderForm('tour', property);
  await fill('fullName', 'Tour Guest');
  await fill('email', 'tour@example.com');
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const localFuture = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await fill('preferredTime', localFuture);
  await consent();
  axios.post.mockResolvedValueOnce({ status: 201, data: { status: 'queued', request_id: 'REQ-T' } });
  await submit();
  const payload = axios.post.mock.calls[0][1];
  expect(payload).toMatchObject({ kind: 'tour', property_id: '7', consent: true });
  expect(payload.property_address).toContain('7 Oak Rd');
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
