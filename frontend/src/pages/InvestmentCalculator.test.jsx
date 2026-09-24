import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import InvestmentCalculator from './InvestmentCalculator';
import { analyzeDealLocally, runMonteCarloLocally } from '../lib/dealAnalysis';
import { downloadDealWorkbook } from '../lib/dealWorkbook';

jest.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }) => children,
  useLocation: () => ({ pathname: '/investment-calculator', search: '' }),
  useNavigate: () => jest.fn(),
}));
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../lib/dealDecision', () => ({
  RENTAL_EVIDENCE_ITEMS: [],
  buildRentalDecision: jest.fn(() => null),
}));
jest.mock('../lib/dealWorkbook', () => ({ downloadDealWorkbook: jest.fn() }));
jest.mock('../lib/dealAnalysis', () => ({
  analyzeDealLocally: jest.fn(),
  runMonteCarloLocally: jest.fn(),
}));

let container;
let root;

const button = (text) => [...container.querySelectorAll('button')]
  .find((item) => item.textContent.includes(text));
const click = async (text) => {
  await act(async () => { button(text).click(); });
};
const changeField = async (name, value) => {
  const input = container.querySelector(`[name="${name}"]`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const useBackend = async () => {
  await act(async () => { root.unmount(); });
  process.env.REACT_APP_BACKEND_URL = 'https://example.test';
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><InvestmentCalculator /></MemoryRouter>); });
};
const submitBase = async () => {
  const invalid = [...container.querySelectorAll('form :invalid')].map((input) => input.name);
  if (invalid.length) throw new Error(`Invalid default fields: ${invalid.join(', ')}`);
  await click('Run base analysis');
  await act(async () => { await Promise.resolve(); });
};
const strategyButton = {
  rental: 'Rental & commercial',
  flip: 'Fix & flip',
  land: 'Land development',
};

beforeEach(async () => {
  analyzeDealLocally.mockImplementation((request) => ({
    strategy: request.strategy,
    formula_version: 'test',
    calculation_mode: 'browser',
    metrics: {},
    warnings: [],
  }));
  runMonteCarloLocally.mockImplementation(({ deal, scenarios }) => ({
    strategy: deal.strategy,
    scenarios: scenarios.map(({ name, seed }) => ({
      name,
      seed,
      iterations_completed: 10,
      summaries: {
        [deal.strategy === 'rental' ? 'irr' : deal.strategy === 'land' ? 'development_profit' : 'flip_profit']: {
          p10: 0.1, p50: 0.2, p90: 0.3, probability_above_zero: 1,
        },
      },
    })),
  }));
  process.env.REACT_APP_BACKEND_URL = '';
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><InvestmentCalculator /></MemoryRouter>); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  jest.clearAllMocks();
  delete process.env.REACT_APP_BACKEND_URL;
});

test.each([
  ['rental', 'flip'], ['rental', 'land'],
  ['flip', 'rental'], ['flip', 'land'],
  ['land', 'rental'], ['land', 'flip'],
])('switching %s to %s clears prior base and risk results without a blank page', async (from, to) => {
  await click(strategyButton[from]);
  await submitBase();
  expect(container.textContent).toContain('Analysis complete');
  await click('Run Monte Carlo');
  expect(container.querySelectorAll('.studio-risk-results article')).toHaveLength(3);

  await click(strategyButton[to]);
  expect(container.textContent).toContain('Your decision canvas');
  expect(container.querySelector('.studio-risk-results')).toBeNull();

  await submitBase();
  expect(container.textContent).toContain('Analysis complete');
  await click('Run Monte Carlo');
  expect(container.querySelectorAll('.studio-risk-results article')).toHaveLength(3);
});

test('an incomplete risk summary shows a recoverable error', async () => {
  runMonteCarloLocally.mockReturnValueOnce({
    scenarios: [{ name: 'Committee case', iterations_completed: 10, summaries: {} }],
  });
  await click('Run Monte Carlo');
  expect(container.textContent).toContain('The risk result is incomplete for this strategy');
  await click('Review scenarios');
  expect(container.textContent).toContain('Distribution before decision');
});

test('an empty risk response offers recovery instead of a blank results panel', async () => {
  runMonteCarloLocally.mockReturnValueOnce({ scenarios: [] });
  await click('Run Monte Carlo');
  expect(container.textContent).toContain('The risk result is incomplete for this strategy');
  await click('Review scenarios');
  expect(container.textContent).toContain('Distribution before decision');
});

test('a base response for another strategy is rejected with a recoverable error', async () => {
  analyzeDealLocally.mockReturnValueOnce({ strategy: 'flip', metrics: {}, formula_version: 'test' });
  await submitBase();
  expect(container.textContent).toContain('This analysis result does not match the current strategy');
  await click('Review inputs');
  expect(container.textContent).toContain('Your decision canvas');
});

test.each(['base', 'risk'])('late %s response cannot restore results after a strategy switch', async (mode) => {
  await useBackend();

  let resolveResponse;
  axios.post.mockReturnValueOnce(new Promise((resolve) => { resolveResponse = resolve; }));
  if (mode === 'base') await submitBase();
  else await click('Run Monte Carlo');

  await click('Fix & flip');
  await act(async () => {
    resolveResponse({ data: mode === 'base'
      ? { strategy: 'rental', formula_version: 'test', metrics: {}, warnings: [] }
      : { scenarios: [{ name: 'Committee case', iterations_completed: 10, summaries: { irr: { p10: 0, p50: 0, p90: 0, probability_above_zero: 0 } } }] } });
  });
  expect(container.textContent).toContain('Your decision canvas');
  expect(container.querySelector('.studio-risk-results')).toBeNull();
});

test('changing an assumption clears base and risk results and makes the next request use the new value', async () => {
  await submitBase();
  await click('Run Monte Carlo');
  expect(container.querySelector('.studio-risk-results')).not.toBeNull();
  await changeField('purchasePrice', '3500000');
  expect(container.textContent).toContain('Your decision canvas');
  expect(container.querySelector('.studio-risk-results')).toBeNull();
  await submitBase();
  expect(analyzeDealLocally.mock.lastCall[0].acquisition.purchase_price).toBe(3500000);
});

test.each(['base', 'risk'])('server 422 on %s is visible and never replaced by a local result', async (mode) => {
  await useBackend();
  axios.post.mockRejectedValueOnce({ response: { status: 422, data: { detail: 'Invalid assumptions' } } });
  if (mode === 'base') await submitBase();
  else await click('Run Monte Carlo');
  expect(container.textContent).toContain('Invalid assumptions');
  expect(analyzeDealLocally).not.toHaveBeenCalled();
  expect(runMonteCarloLocally).not.toHaveBeenCalled();
  expect(container.querySelector('.studio-result')).toBeNull();
  expect(container.querySelector('.studio-risk-results')).toBeNull();
});

test('invalid purchase price is rejected before analysis and workbook export', async () => {
  await changeField('purchasePrice', '0');
  await submitBase();
  expect(container.textContent).toContain('Purchase price must be greater than 0');
  await click('Download deal-specific Excel');
  expect(analyzeDealLocally).not.toHaveBeenCalled();
  expect(downloadDealWorkbook).not.toHaveBeenCalled();
});

test('Excel uses the successful analysis snapshot and is blocked after inputs change', async () => {
  await submitBase();
  await click('Download deal-specific Excel');
  expect(downloadDealWorkbook).toHaveBeenCalledTimes(1);
  expect(downloadDealWorkbook.mock.calls[0][0].request.acquisition.purchase_price).toBe(3000000);
  await changeField('purchasePrice', '5000000');
  await click('Download deal-specific Excel');
  expect(downloadDealWorkbook).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Run a successful base analysis with the current inputs');
});

test('server validation rejection cannot be bypassed by Excel export', async () => {
  await useBackend();
  axios.post.mockRejectedValueOnce({ response: { status: 422, data: { detail: 'Invalid assumptions' } } });
  await submitBase();
  await click('Download deal-specific Excel');
  expect(downloadDealWorkbook).not.toHaveBeenCalled();
  expect(analyzeDealLocally).not.toHaveBeenCalled();
});

test('interest-only period cannot exceed the loan term', async () => {
  await changeField('loanTermYears', '1');
  await changeField('interestOnlyMonths', '13');
  await submitBase();
  expect(container.textContent).toContain('Interest-only period cannot exceed the loan term');
  expect(analyzeDealLocally).not.toHaveBeenCalled();
});

test('negative explicit sale price and nonpositive reported area are rejected', async () => {
  await changeField('explicitSalePrice', '-1');
  await click('Run base analysis');
  expect(container.textContent).toContain('Expected sale price must be greater than 0');
  await changeField('explicitSalePrice', '');
  await changeField('rentableSquareFeet', '-1');
  await click('Run base analysis');
  expect(container.textContent).toContain('Rentable square feet must be greater than 0');
});

test('out-of-range Monte Carlo vacancy inputs are rejected before simulation', async () => {
  await changeField('mcVacancyMin', '-1');
  await click('Run Monte Carlo');
  expect(container.textContent).toContain('vacancy rate must stay between 0 and 0.95');
  expect(runMonteCarloLocally).not.toHaveBeenCalled();
});

test('unordered Monte Carlo drivers show an actionable error without a simulation', async () => {
  await changeField('mcRentMin', '20');
  await click('Run Monte Carlo');
  expect(container.textContent).toContain('must be ordered low');
  expect(runMonteCarloLocally).not.toHaveBeenCalled();
});

test('changing assumptions while a base request is pending prevents stale results', async () => {
  await useBackend();
  let resolveResponse;
  axios.post.mockReturnValueOnce(new Promise((resolve) => { resolveResponse = resolve; }));
  await submitBase();
  await changeField('purchasePrice', '3500000');
  await act(async () => { resolveResponse({ data: { strategy: 'rental', metrics: {}, formula_version: 'test' } }); });
  expect(container.textContent).toContain('Your decision canvas');
  expect(container.querySelector('.studio-result')).toBeNull();
});
