import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import InvestmentCalculator from './InvestmentCalculator';
import { helpers } from '../components/calculators/testHelpers';

// DE-39. The Intelligence page with the real router: three tools, one open at a
// time, chosen by the address.
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../lib/dealWorkbook', () => ({ downloadDealWorkbook: jest.fn() }));

let container;
let root;
const { type } = helpers(() => container);
const tools = () => [...container.querySelectorAll('.studio-tools a')];
const shell = (label) => container.querySelector(`section[aria-label="${label}"]`);
const dealShell = () => [...container.querySelectorAll('.deal-studio-shell')].find((item) => !item.classList.contains('calc-shell'));
const open = async (label) => { await act(async () => { tools().find((link) => link.textContent.includes(label)).click(); }); };
const mount = async (address) => {
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={[address]}><InvestmentCalculator /></MemoryRouter>); });
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  axios.get.mockResolvedValue({ data: { suggestions: [], provider: 'curated' } });
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

test('the page offers three tools and opens Deal Studio by default', async () => {
  await mount('/investment-calculator');
  expect(tools().map((link) => [link.textContent, link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual([
    ['Deal StudioFor investors', '/investment-calculator', 'page'],
    ['Mortgage simulatorFor buyers', '/investment-calculator?tool=mortgage', null],
    ['Seller net sheetFor sellers', '/investment-calculator?tool=net-proceeds', null],
  ]);
  expect(container.querySelector('nav.studio-tools').getAttribute('aria-label')).toBe('Intelligence tools');
  expect(dealShell().hidden).toBe(false);
  expect(container.querySelector('h1').textContent).toBe('Underwrite withabsolute clarity.');
  // The buyer and seller tools are not built until they are opened.
  expect(shell('Buyer mortgage simulator')).toBeNull();
  expect(shell('Seller net proceeds calculator')).toBeNull();
});

test('the address opens the mortgage simulator directly', async () => {
  await mount('/investment-calculator?tool=mortgage');
  expect(shell('Buyer mortgage simulator').hidden).toBe(false);
  expect(dealShell().hidden).toBe(true);
  expect(tools()[1].getAttribute('aria-current')).toBe('page');
  expect(container.querySelector('h1').textContent).toBe('Know the paymentbefore the offer.');
  expect(container.querySelector('.deal-studio-hero__seal').textContent).toBe('AN ESTIMATENOT A LOAN OFFER');
  expect(container.querySelector('.calc-hero strong').textContent).toBe('$2,875');
});

test('the address opens the seller net sheet directly', async () => {
  await mount('/investment-calculator?tool=net-proceeds');
  expect(shell('Seller net proceeds calculator').hidden).toBe(false);
  expect(dealShell().hidden).toBe(true);
  expect(container.querySelector('h1').textContent).toBe('See what you keepafter closing.');
  expect(container.querySelector('.deal-studio-hero__seal').textContent).toBe('AN ESTIMATENOT A CLOSING STATEMENT');
});

test('an unknown tool opens Deal Studio', async () => {
  await mount('/investment-calculator?tool=lottery');
  expect(dealShell().hidden).toBe(false);
  expect(tools()[0].getAttribute('aria-current')).toBe('page');
});

test('moving between the tools keeps what was typed in each of them', async () => {
  await mount('/investment-calculator');
  const dealPrice = () => dealShell().querySelector('[name="purchasePrice"]');
  const setDeal = async (value) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    await act(async () => { setValue.call(dealPrice(), value); dealPrice().dispatchEvent(new Event('input', { bubbles: true })); });
  };
  await setDeal('1234567');

  await open('Mortgage simulator');
  expect(shell('Buyer mortgage simulator').hidden).toBe(false);
  expect(dealShell().hidden).toBe(true);
  await type('price', '610000');
  expect(container.querySelector('.calc-hero strong').textContent).toBe('$3,844');

  await open('Seller net sheet');
  expect(shell('Seller net proceeds calculator').hidden).toBe(false);
  expect(shell('Buyer mortgage simulator').hidden).toBe(true);
  await type('salePrice', '500000');

  await open('Mortgage simulator');
  expect(shell('Buyer mortgage simulator').querySelector('[name="price"]').value).toBe('610000');
  await open('Seller net sheet');
  expect(shell('Seller net proceeds calculator').querySelector('[name="salePrice"]').value).toBe('500000');
  await open('Deal Studio');
  expect(dealShell().hidden).toBe(false);
  expect(dealPrice().value).toBe('1234567');
});

test('only the open tool can be reached; the others are hidden, not just out of sight', async () => {
  await mount('/investment-calculator?tool=mortgage');
  await open('Seller net sheet');
  const hidden = [...container.querySelectorAll('.deal-studio-shell')].filter((item) => item.hidden);
  expect(hidden).toHaveLength(2);
  expect(container.querySelectorAll('.deal-studio-shell:not([hidden])')).toHaveLength(1);
});

test('the stylesheet hides a tool that is not open', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.resolve(__dirname, '../components/calculators/calculators.css'), 'utf8');
  // .deal-studio-shell sets display: grid, which would otherwise beat the hidden attribute.
  expect(css).toContain('.deal-studio-shell[hidden] { display: none; }');
});
