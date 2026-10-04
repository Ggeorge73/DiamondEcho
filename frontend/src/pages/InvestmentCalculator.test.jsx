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
  // The cap is a real constant the page reads; only the calculations are faked.
  BROWSER_MONTE_CARLO_ITERATION_CAP: jest.requireActual('../lib/dealAnalysis').BROWSER_MONTE_CARLO_ITERATION_CAP,
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

test.each(['150', '76', ''])('Monte Carlo vacancy high of "%s" is rejected instead of being capped silently', async (value) => {
  await changeField('mcVacancyMax', value);
  await click('Run Monte Carlo');
  expect(container.textContent).toContain('Vacancy · high must be 75% or less');
  expect(runMonteCarloLocally).not.toHaveBeenCalled();
  expect(container.querySelector('.studio-risk-results')).toBeNull();
});

test('Monte Carlo vacancy high at the 75% cap is simulated as entered', async () => {
  await changeField('mcVacancyMax', '75');
  await click('Run Monte Carlo');
  expect(runMonteCarloLocally).toHaveBeenCalledTimes(1);
  const { scenarios } = runMonteCarloLocally.mock.calls[0][0];
  expect(scenarios.map((scenario) => scenario.drivers.vacancy_rate.maximum)).toEqual([0.75, 0.75, 0.75]);
});

const changeSelect = async (name, value) => {
  const select = container.querySelector(`select[name="${name}"]`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

test('selecting 10,000 iterations in the browser discloses the 5,000 cap before the run', async () => {
  expect(container.textContent).not.toContain('This browser runs at most 5,000 iterations per case');
  await changeSelect('mcIterations', '10000');
  expect(container.textContent).toContain('This browser runs at most 5,000 iterations per case. 10,000 were selected');
  await changeSelect('mcIterations', '5000');
  expect(container.textContent).not.toContain('This browser runs at most 5,000 iterations per case');
});

test('the API path does not claim a browser cap', async () => {
  await useBackend();
  await changeSelect('mcIterations', '10000');
  expect(container.textContent).not.toContain('This browser runs at most');
});

test('the API path says a large run can stop at the service time limit, and the browser path does not', async () => {
  const note = "A run this large can reach the analysis service's time limit";
  await changeSelect('mcIterations', '10000');
  expect(container.textContent).not.toContain(note);
  await useBackend();
  expect(container.textContent).not.toContain(note);
  await changeSelect('mcIterations', '10000');
  expect(container.textContent).toContain(`${note}. If it does, every case stops at the same point and the results state how many iterations were run.`);
  await changeSelect('mcIterations', '5000');
  expect(container.textContent).toContain(note);
  await changeSelect('mcIterations', '2500');
  expect(container.textContent).not.toContain(note);
});

test('land development is warned from 2,500 on the API path, because the service runs it more slowly', async () => {
  const note = "A run this large can reach the analysis service's time limit";
  await useBackend();
  // Rental at the default of 2,500 finishes on the service, so no note.
  expect(container.querySelector('[name="mcIterations"]').value).toBe('2500');
  expect(container.textContent).not.toContain(note);
  await click(strategyButton.land);
  expect(container.querySelector('[name="mcIterations"]').value).toBe('2500');
  expect(container.textContent).toContain(note);
  await changeSelect('mcIterations', '1000');
  expect(container.textContent).not.toContain(note);
  await changeSelect('mcIterations', '2500');
  await click(strategyButton.flip);
  expect(container.textContent).not.toContain(note);
  await changeSelect('mcIterations', '5000');
  expect(container.textContent).toContain(note);
});

test('a service run stopped at its time limit shows how many iterations were run', async () => {
  await useBackend();
  axios.post.mockResolvedValueOnce({ data: {
    scenarios: ['Committee case', 'Downside case', 'Severe stress'].map((name, index) => ({
      name, seed: 2026 + index, iterations_requested: 10000, iterations_completed: 3800, failed_iterations: 0,
      summaries: { irr: { p10: 0.01, p50: 0.08, p90: 0.15, probability_above_zero: 0.75, sample_size: 3800 } },
      warnings: ['Shared note.', 'Service simulation capped at 3,800 iterations for this case to answer in time; 10,000 were requested.'],
    })),
  } });
  await click('Run Monte Carlo');
  await act(async () => { await Promise.resolve(); });
  const cards = [...container.querySelectorAll('.studio-risk-results article')];
  expect(cards).toHaveLength(3);
  for (const card of cards) {
    expect(card.querySelector('small').textContent).toContain('Requested 10,000 · Completed 3,800 · Excluded 0 · Valid for Projected IRR 3,800');
    expect(card.textContent).toContain('Only 3,800 of the 10,000 requested iterations were run.');
    expect(card.textContent).toContain('75% probability above zero (2,850 of 3,800 valid results)');
  }
  // The counts replace the service's own sentence; it is not shown twice.
  expect(container.textContent).not.toContain('Service simulation capped at');
});

test('risk results show requested, completed, excluded and per-metric sample counts with the probability', async () => {
  runMonteCarloLocally.mockImplementationOnce(({ scenarios }) => ({
    scenarios: scenarios.map(({ name, seed }, index) => ({
      name, seed, iterations_requested: 10000, iterations_completed: 4990, failed_iterations: 10,
      summaries: { irr: { p10: 0.01, p50: 0.08, p90: 0.15, probability_above_zero: 0.75, sample_size: 4000 } },
      warnings: index === 0 ? ['Shared note.', 'Only the first case.'] : ['Shared note.'],
    })),
  }));
  await click('Run Monte Carlo');
  const cards = [...container.querySelectorAll('.studio-risk-results article')];
  expect(cards).toHaveLength(3);
  for (const card of cards) {
    expect(card.textContent).toContain('75% probability above zero (3,000 of 4,000 valid results)');
    expect(card.querySelector('small').textContent).toContain('Requested 10,000 · Completed 4,990 · Excluded 10 · Valid for Projected IRR 4,000');
    expect(card.textContent).toContain('Only 5,000 of the 10,000 requested iterations were run.');
    expect(card.textContent).toContain('10 iterations were excluded because the sampled inputs produced invalid economics.');
    expect(card.textContent).toContain('990 completed iterations had no defined Projected IRR');
  }
  expect(cards[0].textContent).toContain('Only the first case.');
  expect(cards[1].textContent).not.toContain('Only the first case.');
  const common = container.querySelector('.studio-risk-common-notes');
  expect(common.textContent).toContain('Shared note.');
  expect(container.textContent.match(/Shared note\./g)).toHaveLength(1);
});

test('losses with no solvable IRR are shown as counted in the result', async () => {
  runMonteCarloLocally.mockImplementationOnce(({ scenarios }) => ({
    scenarios: scenarios.map(({ name, seed }, index) => ({
      name, seed, iterations_requested: 5000, iterations_completed: 5000, failed_iterations: 0,
      summaries: { irr: { p10: -1, p50: -0.2, p90: -0.01, probability_above_zero: 0.0756, sample_size: 5000, loss_without_irr_count: index === 2 ? 1140 : 0 } },
      warnings: [],
    })),
  }));
  await click('Run Monte Carlo');
  const cards = [...container.querySelectorAll('.studio-risk-results article')];
  expect(cards[0].textContent).not.toContain('losing iterations had no solvable');
  expect(cards[2].textContent).toContain('7.56% probability above zero (378 of 5,000 valid results)');
  expect(cards[2].textContent).toContain('1,140 losing iterations had no solvable Projected IRR. They are counted as losses');
  expect(cards[2].querySelector('dd').textContent).toBe('-100%');
});

test('a risk result without sample counts says they were not reported', async () => {
  await click('Run Monte Carlo');
  const card = container.querySelector('.studio-risk-results article');
  expect(card.textContent).toContain('(valid sample size not reported)');
  expect(card.querySelector('small').textContent).toContain('Completed 10 · Valid for Projected IRR not reported');
  expect(container.querySelector('.studio-risk-common-notes')).toBeNull();
});

test('stress cases say when the vacancy cap limited the entered value', async () => {
  await changeField('mcVacancyMax', '60');
  await click('Run Monte Carlo');
  const cards = [...container.querySelectorAll('.studio-risk-results article')];
  expect(cards[0].textContent).not.toContain('Vacancy high was limited');
  expect(cards[1].textContent).not.toContain('Vacancy high was limited');
  expect(cards[2].textContent).toContain('Vacancy high was limited to 75% in this case; 60% × 1.75 would be 105%.');
  const { scenarios } = runMonteCarloLocally.mock.calls[0][0];
  expect(scenarios.map((scenario) => scenario.drivers.vacancy_rate.maximum)).toEqual([0.6, 0.75, 0.75]);
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
