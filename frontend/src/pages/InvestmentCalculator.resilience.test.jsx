// Deal Studio when the analysis service is down. Production builds carry
// REACT_APP_BACKEND_URL (docs/de13-production-setup.md), so the base analysis
// is sent to the service; the Monte Carlo simulation always runs on the
// device and is covered in InvestmentCalculator.test.jsx.
//
// What the page does today when the service gives no usable answer: it says
// the service could not be reached and that nothing was calculated, shows no
// figures, and keeps every entered value. It does NOT calculate on the device
// instead (it does that only for a service on an older formula or one that
// refuses a new field). These tests pin that honest behaviour.
//
// A test written with `test.fails` is a weakness found by the SRE chaos role
// (docs/sre/chaos-and-game-days.md). It passes while the weakness is there and
// fails the day it is fixed, so the mark is removed then.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import InvestmentCalculator from './InvestmentCalculator';
import { analyzeDealLocally } from '../lib/dealAnalysis';

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
  expect(container.textContent).toContain('The analysis service could not be reached, so nothing was calculated.');
  expect(container.querySelector('.studio-result')).toBeNull();
  expect(analyzeDealLocally).not.toHaveBeenCalled();
  expect(field('purchasePrice').value).toBe('2750000');
  expect(button('Run base analysis').disabled).toBeFalsy();
});

test('after an outage the next attempt works without reloading the page', async () => {
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
  await runBase();
  axios.post.mockResolvedValueOnce({ data: { strategy: 'rental', formula_version: 'diamond-underwriting-9.0.0', metrics: {}, warnings: [] } });
  await runBase();
  expect(container.textContent).not.toContain('could not be reached');
  expect(container.textContent).toContain('Analysis complete');
});

test.fails.each([
  ['504 from the platform after its 30 second limit', { status: 504, data: 'upstream request timeout' }],
  ['502 from the platform with an HTML page', { status: 502, data: '<html><body>Bad Gateway</body></html>' }],
  ['503 while no instance can start', { status: 503, data: 'Service Unavailable' }],
])('weakness: %s is said in plain words, not as "status code"', async (_label, response) => {
  // frontend/src/lib/dealValidation.js:254 (responseErrorMessage): a
  // platform answer with no JSON `detail` falls through to error.message,
  // so the page shows "Request failed with status code 504". The inquiry
  // form already says this in plain words. Nothing wrong is calculated: the
  // page shows no figures (asserted below, outside this weakness).
  // Proposed fix: in responseErrorMessage, before `return error.message`,
  // answer an axios error with a 5xx status and no string detail with "The
  // analysis service is not answering right now, so nothing was calculated.
  // Try again in a minute."
  axios.post.mockRejectedValueOnce({ isAxiosError: true, message: `Request failed with status code ${response.status}`, response });
  await runBase();
  expect(container.querySelector('.studio-result')).toBeNull();
  expect(container.textContent).not.toMatch(/status code/);
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
