// Deal Studio when the analysis service is down. Production builds carry
// REACT_APP_BACKEND_URL (docs/de13-production-setup.md), so the base analysis
// is sent to the service; the Monte Carlo simulation always runs on the
// device and is covered in InvestmentCalculator.test.jsx.
//
// What the page does when the service gives no usable answer (no answer, the
// time limit, a 5xx, a 429, or a 2xx that is not an analysis): it says "The
// calculator is temporarily unavailable. Please try again shortly.", offers
// Try again, shows no figures, and keeps every entered value. It does NOT
// calculate on the device instead (it does that only for a service on an
// older formula or one that refuses a new field; Gbenga's decision of
// 2026-11-14 is not to widen that). A 4xx that carries the service's reasons
// is shown as help with the inputs.
//
// A test written with `test.fails` is a weakness found by the SRE chaos role
// (docs/sre/chaos-and-game-days.md). It passes while the weakness is there and
// fails the day it is fixed, so the mark is removed then. W10 (the raw
// "status code" text) was fixed on 2026-11-14 and is an ordinary test below.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import InvestmentCalculator from './InvestmentCalculator';
import { analyzeDealLocally } from '../lib/dealAnalysis';
import { DEAL_ANALYSIS_TIMEOUT_MS } from '../lib/dealValidation';

vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }) => children,
  Link: ({ to, children, ...rest }) => require('react').createElement('a', { href: to, ...rest }, children),
  useLocation: () => ({ pathname: '/investment-calculator', search: '' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('axios', () => { const axios = { get: vi.fn(), post: vi.fn() }; return { default: axios, ...axios }; });
vi.mock('../lib/dealDecision', () => ({
  RENTAL_EVIDENCE_ITEMS: [], LAND_CHECKLIST_ITEMS: [], FLIP_EVIDENCE_ITEMS: [], buildDecision: vi.fn(() => null),
}));
vi.mock('../lib/dealWorkbook', () => ({ downloadDealWorkbook: vi.fn() }));
vi.mock('../lib/dealAnalysis', async () => ({
  BROWSER_MONTE_CARLO_ITERATION_CAP: (await vi.importActual('../lib/dealAnalysis')).BROWSER_MONTE_CARLO_ITERATION_CAP,
  analyzeDealLocally: vi.fn(),
  runMonteCarloLocally: vi.fn(),
  runMonteCarloInBrowser: vi.fn(),
}));

let container;
let root;

const button = (text) => [...container.querySelectorAll('button')].find((item) => item.textContent.includes(text));
const field = (name) => container.querySelector(`[name="${name}"]`);
const changeField = async (name, value) => {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(field(name), value);
    field(name).dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const runBase = async () => {
  await act(async () => { button('Run base analysis').click(); });
  await act(async () => { await Promise.resolve(); });
};

const UNAVAILABLE = 'The calculator is temporarily unavailable. Please try again shortly.';
const GOOD = { strategy: 'rental', formula_version: 'diamond-underwriting-9.0.0', metrics: {}, warnings: [] };
// The unavailable notice and nothing else: no figures, no browser-library or
// platform text, nothing calculated on the device, the run button usable.
const expectUnavailable = () => {
  const notice = container.querySelector('.studio-error[role="alert"]');
  expect(notice.textContent).toContain(UNAVAILABLE);
  expect(notice.textContent).not.toContain('Analysis needs attention');
  expect([...notice.querySelectorAll('button')].map((item) => item.textContent.trim())).toEqual(['Try again']);
  expect(container.querySelector('.studio-result')).toBeNull();
  expect(container.textContent).not.toMatch(/status code|Network Error|timeout of|Bad Gateway|upstream|Service Unavailable|\[object Object\]/);
  expect(analyzeDealLocally).not.toHaveBeenCalled();
  expect(button('Run base analysis').disabled).toBeFalsy();
};

beforeEach(async () => {
  window.localStorage.clear();
  analyzeDealLocally.mockImplementation((request) => ({
    strategy: request.strategy, formula_version: 'test', calculation_mode: 'browser', metrics: {}, warnings: [],
  }));
  process.env.REACT_APP_BACKEND_URL = 'https://api.example.test';
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><InvestmentCalculator /></MemoryRouter>); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.clearAllMocks();
  delete process.env.REACT_APP_BACKEND_URL;
});

test('an unreachable service is said in plain words, nothing is calculated or shown, and the entered figures stay', async () => {
  await changeField('purchasePrice', '2750000');
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
  await runBase();
  expectUnavailable();
  expect(container.textContent).toContain('Nothing was calculated. The figures you entered are kept.');
  expect(field('purchasePrice').value).toBe('2750000');
});

test('after an outage the next attempt works without reloading the page', async () => {
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
  await runBase();
  axios.post.mockResolvedValueOnce({ data: { strategy: 'rental', formula_version: 'diamond-underwriting-9.0.0', metrics: {}, warnings: [] } });
  await runBase();
  expect(container.textContent).not.toContain(UNAVAILABLE);
  expect(container.textContent).toContain('Analysis complete');
});

// W10 in docs/sre/chaos-and-game-days.md, fixed 2026-11-14.
test.each([
  ['504 from the platform after its 30 second limit', { status: 504, data: 'upstream request timeout' }],
  ['502 from the platform with an HTML page', { status: 502, data: '<html><body>Bad Gateway</body></html>' }],
  ['503 while no instance can start', { status: 503, data: 'Service Unavailable' }],
  ['500 with a JSON detail', { status: 500, data: { detail: 'Internal Server Error' } }],
  ['429 from the limit on heavy requests', { status: 429, data: { detail: 'Too many requests.' } }],
])('%s is said in plain words, not as "status code"', async (_label, response) => {
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: `Request failed with status code ${response.status}`, response });
  await runBase();
  expect(container.querySelector('.studio-result')).toBeNull();
  expect(container.textContent).not.toMatch(/status code/);
  expectUnavailable();
});

test('the request carries a time limit, and a request that passes it shows the unavailable notice', async () => {
  axios.post.mockRejectedValueOnce({ isAxiosError: true, code: 'ECONNABORTED', message: `timeout of ${DEAL_ANALYSIS_TIMEOUT_MS}ms exceeded` });
  await runBase();
  expect(axios.post.mock.calls[0][2]).toEqual({ timeout: DEAL_ANALYSIS_TIMEOUT_MS });
  expectUnavailable();
});

test.each([
  ['an HTML page answered with 200', '<html><body>Sign in to Wi-Fi</body></html>'],
  ['an empty 200', ''],
  ['a 200 for another strategy', { ...GOOD, strategy: 'flip' }],
  ['a 200 with no metrics', { strategy: 'rental', formula_version: 'diamond-underwriting-9.0.0' }],
])('%s is not shown as an analysis', async (_label, data) => {
  axios.post.mockResolvedValueOnce({ status: 200, data });
  await runBase();
  expectUnavailable();
  expect(container.textContent).not.toContain('Analysis complete');
  expect(container.textContent).not.toContain('Wi-Fi');
});

test('Try again sends the same figures again and shows the result when the service is back', async () => {
  await changeField('purchasePrice', '2750000');
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
  await runBase();
  expectUnavailable();
  expect(field('purchasePrice').value).toBe('2750000');

  // Still down: the notice stays and the figures stay.
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: 'Request failed with status code 503', response: { status: 503, data: 'Service Unavailable' } });
  await act(async () => { button('Try again').click(); });
  await act(async () => { await Promise.resolve(); });
  expectUnavailable();
  expect(field('purchasePrice').value).toBe('2750000');

  axios.post.mockResolvedValueOnce({ status: 200, data: GOOD });
  await act(async () => { button('Try again').click(); });
  await act(async () => { await Promise.resolve(); });
  expect(axios.post).toHaveBeenCalledTimes(3);
  const [first, second, third] = axios.post.mock.calls;
  expect(first[0]).toBe('https://api.example.test/api/v1/deals/analyze');
  expect(JSON.stringify(first[1])).toContain('2750000');
  expect(second[1]).toEqual(first[1]);
  expect(third[1]).toEqual(first[1]);
  expect(container.textContent).not.toContain(UNAVAILABLE);
  expect(container.textContent).toContain('Analysis complete');
  expect(field('purchasePrice').value).toBe('2750000');
});

test('figures from an earlier run are not left on screen beside the unavailable notice', async () => {
  axios.post.mockResolvedValueOnce({ status: 200, data: GOOD });
  await runBase();
  expect(container.querySelector('.studio-result')).not.toBeNull();
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
  await runBase();
  expectUnavailable();
  expect(container.textContent).not.toContain('Analysis complete');
});

test.each([
  ['a 422 naming the input', { status: 422, data: { detail: [{ loc: ['body', 'operating', 'vacancy_rate'], msg: 'Input should be less than or equal to 1' }] } }, 'operating › vacancy rate: Input should be less than or equal to 1'],
  ['a 400 with the service\'s reason', { status: 400, data: { detail: 'construction financing must leave a positive equity contribution' } }, 'Construction financing must leave a positive equity contribution'],
])('%s is shown as help with the inputs, not as unavailable', async (_label, response, shown) => {
  await changeField('purchasePrice', '2750000');
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: `Request failed with status code ${response.status}`, response });
  await runBase();
  const notice = container.querySelector('.studio-error[role="alert"]');
  expect(notice.textContent).toContain('Analysis needs attention');
  expect(notice.textContent).toContain(shown);
  expect(container.textContent).not.toContain(UNAVAILABLE);
  expect(container.textContent).not.toMatch(/status code/);
  expect(button('Try again')).toBeUndefined();
  expect(button('Review inputs')).toBeDefined();
  expect(container.querySelector('.studio-result')).toBeNull();
  expect(analyzeDealLocally).not.toHaveBeenCalled();
  expect(field('purchasePrice').value).toBe('2750000');
});

test.each([
  ['504', { status: 504, data: 'upstream request timeout' }],
  ['502', { status: 502, data: '<html><body>Bad Gateway</body></html>' }],
])('a platform %s shows no figures and keeps the entered values', async (_label, response) => {
  await changeField('purchasePrice', '2750000');
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: `Request failed with status code ${response.status}`, response });
  await runBase();
  expect(container.querySelector('.studio-result')).toBeNull();
  expect(analyzeDealLocally).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('Bad Gateway');
  expect(field('purchasePrice').value).toBe('2750000');
});
