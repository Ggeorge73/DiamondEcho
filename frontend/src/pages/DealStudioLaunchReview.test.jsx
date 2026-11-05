import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import InvestmentCalculator, { DRAFT_STORAGE_KEY, readDraft } from './InvestmentCalculator';
import { analyzeDealLocally, runMonteCarloInBrowser, runMonteCarloLocally } from '../lib/dealAnalysis';

// The 2026-11-05 pre-launch review of Deal Studio: the four "must fix" items.
// 1 and 2: starting the simulation while the base analysis was still running
// discarded the base result and left the page on "Calculating…" (and, on the
// reviewer's phone, took the page down). 3: a reload wiped fifty boxes.
// 4: a list laid over the next row of boxes took a click as a choice of
// "Austin, TX" after one letter was typed. The calculations are faked here;
// the page's own behaviour is what is tested.
vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }) => children,
  Link: ({ to, children, ...rest }) => require('react').createElement('a', { href: to, ...rest }, children),
  useLocation: () => ({ pathname: '/investment-calculator', search: '' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('axios', () => { const axios = { get: vi.fn(), post: vi.fn() }; return { default: axios, ...axios }; });
vi.mock('../lib/dealDecision', () => ({
  RENTAL_EVIDENCE_ITEMS: [{ key: 'rentRollVerified', label: 'Rent roll verified' }],
  LAND_CHECKLIST_ITEMS: [],
  FLIP_EVIDENCE_ITEMS: [],
  buildDecision: vi.fn(() => null),
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
const text = () => container.textContent;
const field = (name) => container.querySelector(`[name="${name}"]`);
const button = (label) => [...container.querySelectorAll('button')].find((item) => item.textContent.includes(label));
const click = async (label) => { await act(async () => { button(label).click(); }); };
const changeField = async (name, value) => {
  const input = field(name);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
// React listens for focusin and focusout.
const focus = async (name) => { await act(async () => { field(name).dispatchEvent(new FocusEvent('focusin', { bubbles: true })); }); };
// The list closes a moment after the box is left, so the test waits that moment.
const blur = async (name) => { await act(async () => { field(name).dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await new Promise((resolve) => { setTimeout(resolve, 5); }); }); };
const mount = async (backend = '') => {
  if (backend) process.env.REACT_APP_BACKEND_URL = backend; else delete process.env.REACT_APP_BACKEND_URL;
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><InvestmentCalculator /></MemoryRouter>); });
};
const remount = async (backend = '') => {
  await act(async () => { root.unmount(); });
  await mount(backend);
};
const settle = async (ms = 400) => { await act(async () => { await new Promise((resolve) => { setTimeout(resolve, ms); }); }); };
const baseResult = (strategy = 'rental') => ({ strategy, formula_version: 'diamond-underwriting-1.8.0', calculation_mode: 'service', metrics: {}, warnings: [] });
const riskResult = ({ scenarios }) => ({
  scenarios: scenarios.map(({ name, seed }) => ({ name, seed, iterations_completed: 10, summaries: { irr: { p10: 0.01, p50: 0.08, p90: 0.15, probability_above_zero: 0.75 } }, warnings: [] })),
});

beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  analyzeDealLocally.mockImplementation((request) => baseResult(request.strategy));
  runMonteCarloLocally.mockImplementation(riskResult);
  runMonteCarloInBrowser.mockImplementation(async (payload) => runMonteCarloLocally(payload));
  axios.get.mockResolvedValue({ data: { suggestions: [], provider: 'curated' } });
  container = document.createElement('div');
  document.body.appendChild(container);
  await mount();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.clearAllMocks();
  delete process.env.REACT_APP_BACKEND_URL;
});

describe('items 1 and 2: the base analysis and the simulation are separate runs', () => {
  test('a simulation started while the base analysis is running does not discard the base result or leave the page calculating', async () => {
    await remount('https://example.test');
    let answerBase;
    axios.post.mockReturnValueOnce(new Promise((resolve) => { answerBase = resolve; }));
    let finishRisk;
    runMonteCarloInBrowser.mockImplementationOnce(() => new Promise((resolve) => { finishRisk = resolve; }));
    await click('Run base analysis');
    expect(text()).toContain('Calculating…');
    expect(button('Analyzing')).toBeTruthy();
    await click('Run Monte Carlo');
    expect(text()).toContain('Simulating…');
    // The base analysis answers while the simulation is still running.
    await act(async () => { answerBase({ data: baseResult() }); });
    expect(button('Analyzing')).toBeUndefined();
    expect(button('Run base analysis')).toBeTruthy();
    await click('IC decision');
    expect(text()).toContain('Analysis complete');
    expect(text()).not.toContain('Calculating…');
    // And the simulation finishes on its own.
    await act(async () => { finishRisk(riskResult({ scenarios: [{ name: 'Committee case', seed: 1 }, { name: 'Downside case', seed: 2 }, { name: 'Severe stress', seed: 3 }] })); });
    await click('Monte Carlo');
    expect(container.querySelectorAll('.studio-risk-results article')).toHaveLength(3);
    expect(text()).not.toContain('Simulating…');
  });

  test('running the base analysis again after a simulation keeps the simulation and never hangs', async () => {
    await click('Run base analysis');
    expect(text()).toContain('Analysis complete');
    await click('Run Monte Carlo');
    expect(container.querySelectorAll('.studio-risk-results article')).toHaveLength(3);
    await click('Run base analysis');
    expect(text()).toContain('Analysis complete');
    expect(text()).not.toContain('Calculating…');
    expect(button('Run base analysis')).toBeTruthy();
    await click('Monte Carlo');
    expect(container.querySelectorAll('.studio-risk-results article')).toHaveLength(3);
  });

  test('a changed input still cancels both runs', async () => {
    let options;
    runMonteCarloInBrowser.mockImplementationOnce((payload, given) => { options = given; return new Promise(() => {}); });
    await click('Run base analysis');
    await click('Run Monte Carlo');
    expect(options.shouldStop()).toBe(false);
    await changeField('purchasePrice', '3500000');
    expect(options.shouldStop()).toBe(true);
    expect(text()).toContain('Your decision canvas');
  });

  test('a fault while drawing the results is contained: the form stays and the results can be cleared', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    // React reports an error a boundary caught to the window as well; the test runner must not count it.
    const swallow = (event) => event.preventDefault();
    window.addEventListener('error', swallow);
    analyzeDealLocally.mockImplementationOnce(() => ({ ...baseResult(), metrics: new Proxy({}, { get: (target, key) => { if (key === 'cash_on_cash') throw new Error('a figure the page cannot draw'); return undefined; } }) }));
    await click('Run base analysis');
    expect(text()).toContain('The results could not be drawn');
    expect(field('purchasePrice').value).toBe('3000000');
    await click('Clear the results');
    expect(text()).toContain('Your decision canvas');
    await click('Run base analysis');
    expect(text()).toContain('Analysis complete');
    window.removeEventListener('error', swallow);
    quiet.mockRestore();
  });
});

describe('item 3: the form is kept on this device', () => {
  test('what was entered comes back after a reload, with a note and a way to start over', async () => {
    await changeField('purchasePrice', '3500000');
    await changeField('market', 'Macon, GA');
    await act(async () => { container.querySelector('input[type="checkbox"]').click(); });
    await settle();
    const draft = readDraft();
    expect(draft.form.purchasePrice).toBe('3500000');
    expect(draft.entered).toEqual(expect.arrayContaining(['purchasePrice', 'market']));
    expect(draft.evidence.rentRollVerified).toBe(true);
    await remount();
    expect(field('purchasePrice').value).toBe('3500000');
    expect(field('market').value).toBe('Macon, GA');
    expect(container.querySelector('input[type="checkbox"]').checked).toBe(true);
    expect(text()).toContain('were restored from this device');
    // A restored figure still counts as the visitor's own: typing an address keeps it.
    await changeField('address', '1 Main St');
    expect(field('purchasePrice').value).toBe('3500000');
    await click('Start over');
    expect(field('purchasePrice').value).toBe('3000000');
    expect(field('address').value).toBe('');
    expect(container.querySelector('input[type="checkbox"]').checked).toBe(false);
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    expect(text()).toContain('nothing you had entered is kept on this device any more');
  });

  test('an untouched form keeps nothing, and a damaged draft is ignored', async () => {
    await settle();
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    window.localStorage.setItem(DRAFT_STORAGE_KEY, '{not json');
    await remount();
    expect(field('purchasePrice').value).toBe('3000000');
    expect(text()).not.toContain('were restored');
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ form: { purchasePrice: 12, notABox: 'x', market: 'Macon, GA' }, entered: ['market', 'notABox'], savedAt: 'yesterday' }));
    await remount();
    expect(field('purchasePrice').value).toBe('3000000');
    expect(field('market').value).toBe('Macon, GA');
    expect(text()).toContain('Your figures from your last visit were restored');
  });

  test('the results are not kept: a reload shows the canvas, not a stale result', async () => {
    await changeField('purchasePrice', '3500000');
    await click('Run base analysis');
    expect(text()).toContain('Analysis complete');
    await settle();
    await remount();
    expect(text()).toContain('Your decision canvas');
    expect(field('purchasePrice').value).toBe('3500000');
  });
});

describe('item 4: the market box never picks a market by itself', () => {
  test('one letter stays one letter, the list closes when the box is left, and the run says it is not a market', async () => {
    await focus('market');
    await changeField('market', 'A');
    expect(container.querySelectorAll('.studio-suggestions button').length).toBeGreaterThan(1);
    await blur('market');
    expect(container.querySelector('.studio-suggestions')).toBeNull();
    expect(field('market').value).toBe('A');
    await click('Run base analysis');
    expect(text()).toContain('Market: "A" is not a market. Choose one from the list or type the city and state in full, or leave the box empty.');
    expect(analyzeDealLocally).not.toHaveBeenCalled();
  });

  test('a market chosen from the list is said, and can be undone', async () => {
    await focus('market');
    await changeField('market', 'Au');
    const austin = [...container.querySelectorAll('.studio-suggestions button')].find((item) => item.textContent.includes('Austin, TX'));
    await act(async () => { austin.click(); });
    expect(field('market').value).toBe('Austin, TX');
    expect(text()).toContain('Market set to Austin, TX, chosen from the list.');
    expect(container.querySelector('.studio-suggestions')).toBeNull();
    await click('Undo, back to "Au"');
    expect(field('market').value).toBe('Au');
    expect(container.querySelector('.studio-change-notice')).toBeNull();
  });

  test('the list sits in the flow of the page, not over the boxes below it', async () => {
    await focus('market');
    await changeField('market', 'A');
    const list = container.querySelector('.studio-suggestions');
    // The box's own markup carries no positioning; the stylesheet keeps it static (App.css).
    expect(list.getAttribute('style')).toBeNull();
    expect(field('market').getAttribute('aria-expanded')).toBe('true');
  });
});
