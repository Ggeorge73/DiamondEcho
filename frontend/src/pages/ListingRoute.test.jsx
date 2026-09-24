import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import PropertyDetail from './PropertyDetail';
import InvestmentCalculator from './InvestmentCalculator';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

let container;
let root;

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="route">{location.pathname + location.search}</output>;
};

const typeAddress = async (value) => {
  const input = container.querySelector('input[name="address"]');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const enterRequiredListingAssumptions = async () => {
  const values = {
    closingCosts: '0', dueDiligenceCosts: '0', initialCapex: '0', sellingCosts: '6',
    annualRent: '360000', otherIncome: '0', vacancy: '5', insurance: '0',
    repairsMaintenance: '0', utilities: '0', payrollAdmin: '0', managementFee: '0',
    reserves: '0', annualBelowNoiCosts: '0', incomeGrowth: '0', expenseGrowth: '0', exitCap: '6.5',
  };
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  for (const [name, value] of Object.entries(values)) {
    const input = container.querySelector(`input[name="${name}"]`);
    await act(async () => { setValue.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  }
};

const renderRoute = async (path) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path="/property/:id" element={<PropertyDetail />} />
          <Route path="/investment-calculator" element={<><Link to="/investment-calculator?listing=2">Open listing 2</Link><Link to="/investment-calculator?listing=6">Open listing 6</Link><InvestmentCalculator /></>} />
        </Routes>
      </MemoryRouter>
    );
  });
};

beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
  container = null;
  root = null;
  jest.clearAllMocks();
  delete process.env.REACT_APP_BACKEND_URL;
});

test.each([
  ['/property/1', '1', '1245 Ocean Drive', 'Miami Beach, FL', '4500000', '6800', '45000'],
  ['/property/2', '2', '789 Sunset Boulevard', 'Los Angeles, CA', '6200000', '8500', '62000'],
])('property %s opens Deal Studio with its own supported facts', async (path, id, address, market, price, sqft, taxes) => {
  await renderRoute(path);
  const analyze = [...container.querySelectorAll('button')].find((item) => item.textContent.includes('Analyze as investment'));
  await act(async () => { analyze.click(); });
  expect(container.textContent).toContain('DiamondEcho listing #' + id + ' loaded');
  expect(container.textContent).toContain('REVIEW LISTING #' + id);
  expect(container.querySelector('input[name="address"]').value).toContain(address);
  expect(container.querySelector('input[name="market"]').value).toBe(market);
  expect(container.querySelector('input[name="purchasePrice"]').value).toBe(price);
  expect(container.querySelector('input[name="rentableSquareFeet"]').value).toBe(sqft);
  expect(container.querySelector('input[name="propertyTaxes"]').value).toBe(taxes);
});

test('direct Deal Studio entry labels its Austin values as an example', async () => {
  await renderRoute('/investment-calculator');
  expect(container.textContent).toContain('Manual Deal Studio entry');
  expect(container.querySelector('input[name="purchasePrice"]').value).toBe('3000000');
  expect(container.textContent).not.toContain('REVIEW LISTING #');
});

test('changing listing ID replaces the prior listing and its analysis context', async () => {
  await renderRoute('/investment-calculator?listing=1');
  expect(container.querySelector('input[name="purchasePrice"]').value).toBe('4500000');
  const analyze = [...container.querySelectorAll('button')].find((item) => item.textContent.includes('Run base analysis'));
  await act(async () => { analyze.click(); });
  expect(container.textContent).toContain('INVESTMENT COMMITTEE OUTPUT');
  await act(async () => { container.querySelector('a[href="/investment-calculator?listing=2"]').click(); });
  expect(container.textContent).toContain('DiamondEcho listing #2 loaded');
  expect(container.querySelector('input[name="purchasePrice"]').value).toBe('6200000');
  expect(container.querySelector('input[name="address"]').value).toContain('789 Sunset Boulevard');
  expect(container.querySelector('input[name="address"]').value).not.toContain('1245 Ocean Drive');
  expect(container.textContent).toContain('Your decision canvas');
});

test('unknown listing link never substitutes the Austin example as the selected property', async () => {
  await renderRoute('/investment-calculator?listing=999');
  expect(container.textContent).toContain('Listing #999 is unavailable');
  expect(container.querySelector('input[name="purchasePrice"]').value).toBe('');
  expect(container.querySelector('input[name="address"]').value).toBe('');
  expect(container.textContent).not.toContain('REVIEW LISTING #');
});

test('editing a listing address clears its URL provenance, facts and prior output', async () => {
  await renderRoute('/investment-calculator?listing=1');
  const analyze = [...container.querySelectorAll('button')].find((item) => item.textContent.includes('Run base analysis'));
  await act(async () => { analyze.click(); });
  expect(container.textContent).toContain('INVESTMENT COMMITTEE OUTPUT');

  await typeAddress('A different property');
  expect(container.querySelector('[data-testid="route"]').textContent).toBe('/investment-calculator');
  expect(container.querySelector('input[name="address"]').value).toBe('A different property');
  expect(container.querySelector('input[name="purchasePrice"]').value).toBe('');
  expect(container.textContent).not.toContain('REVIEW LISTING #1');
  expect(container.textContent).toContain('Your decision canvas');
});

test('selecting a different local listing updates the URL and replaces property facts', async () => {
  await renderRoute('/investment-calculator?listing=1');
  await typeAddress('789 Sunset');
  const suggestion = [...container.querySelectorAll('[role="option"]')]
    .find((item) => item.textContent.includes('789 Sunset Boulevard'));
  expect(suggestion).toBeDefined();
  await act(async () => { suggestion.click(); });
  expect(container.querySelector('[data-testid="route"]').textContent).toBe('/investment-calculator?listing=2');
  expect(container.querySelector('input[name="purchasePrice"]').value).toBe('6200000');
  expect(container.textContent).toContain('REVIEW LISTING #2');
});

test('switching to 567 Design Way clears the previous rental assumptions and labels facts', async () => {
  await renderRoute('/investment-calculator?listing=1');
  expect(container.querySelector('input[name="annualRent"]').value).toBe('');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const rent = container.querySelector('input[name="annualRent"]');
  await act(async () => { setValue.call(rent, '360000'); rent.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { container.querySelector('a[href="/investment-calculator?listing=6"]').click(); });
  expect(container.querySelector('input[name="address"]').value).toContain('567 Design Way');
  expect(container.querySelector('select[name="propertyType"]').value).toBe('single_family');
  expect(container.querySelector('input[name="purchasePrice"]').value).toBe('3200000');
  expect(container.querySelector('input[name="annualRent"]').value).toBe('');
  expect(container.querySelector('input[name="insurance"]').value).toBe('');
  expect(container.textContent).toContain('Input sources: DiamondEcho review listing #6');
  expect(container.textContent).toContain('Review and enter missing values');
});

test.each(['base', 'risk'])('a late %s response cannot restore analysis for the prior listing', async (mode) => {
  process.env.REACT_APP_BACKEND_URL = 'https://example.test';
  await renderRoute('/investment-calculator?listing=1');
  await enterRequiredListingAssumptions();
  let resolveResponse;
  axios.post.mockReturnValueOnce(new Promise((resolve) => { resolveResponse = resolve; }));
  const action = [...container.querySelectorAll('button')]
    .find((item) => item.textContent.includes(mode === 'base' ? 'Run base analysis' : 'Run Monte Carlo'));
  await act(async () => { action.click(); });
  expect(axios.post).toHaveBeenCalled();

  await typeAddress('A different property');
  await act(async () => {
    resolveResponse({ data: mode === 'base'
      ? { strategy: 'rental', metrics: {}, formula_version: 'test' }
      : { scenarios: [{ name: 'Old property', iterations_completed: 10, summaries: { irr: { p10: 0, p50: 0, p90: 0, probability_above_zero: 0 } } }] } });
  });
  expect(container.textContent).toContain('Your decision canvas');
  expect(container.querySelector('.studio-risk-results')).toBeNull();
  expect(container.querySelector('input[name="purchasePrice"]').value).toBe('');
});
