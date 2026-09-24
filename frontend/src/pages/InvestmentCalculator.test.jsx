import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import InvestmentCalculator from './InvestmentCalculator';
import { analyzeDealLocally, runMonteCarloLocally } from '../lib/dealAnalysis';

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
  await act(async () => { root.unmount(); });
  process.env.REACT_APP_BACKEND_URL = 'https://example.test';
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><InvestmentCalculator /></MemoryRouter>); });

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
