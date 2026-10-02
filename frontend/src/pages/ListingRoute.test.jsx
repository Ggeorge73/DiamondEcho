import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import InvestmentCalculator from './InvestmentCalculator';

let container;
let root;

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="route">{location.pathname + location.search}</output>;
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
          <Route path="/investment-calculator" element={<InvestmentCalculator />} />
        </Routes>
      </MemoryRouter>
    );
  });
};

const typeAddress = async (value) => {
  const input = container.querySelector('input[name="address"]');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
  container = null;
  root = null;
});

test('direct Deal Studio entry labels its numbers as illustrative, not a listing', async () => {
  await renderRoute('/investment-calculator');
  expect(container.textContent).toContain('Manual Deal Studio entry');
  expect(container.querySelector('input[name="purchasePrice"]').value).toBe('3000000');
  expect(container.textContent).not.toContain('DiamondEcho listing #');
});

test('legacy sample-listing links load no property facts or fake listed price', async () => {
  await renderRoute('/investment-calculator?listing=1');
  expect(container.textContent).toContain('old sample-property link is unavailable');
  expect(container.querySelector('input[name="purchasePrice"]').value).toBe('');
  expect(container.querySelector('input[name="address"]').value).toBe('');
  expect(container.textContent).not.toContain('REVIEW LISTING');
});

test('typing a property address leaves the old listing URL and assumptions behind', async () => {
  await renderRoute('/investment-calculator?listing=1');
  await typeAddress('My own address');
  expect(container.querySelector('[data-testid="route"]').textContent).toBe('/investment-calculator');
  expect(container.querySelector('input[name="address"]').value).toBe('My own address');
  expect(container.querySelector('input[name="purchasePrice"]').value).toBe('');
});
