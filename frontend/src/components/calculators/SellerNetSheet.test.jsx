import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import SellerNetSheet from './SellerNetSheet';
import { waterfallLayout } from './ProceedsWaterfall';
import { helpers } from './testHelpers';

let container;
let root;
const { text, field, type, press } = helpers(() => container);
const hero = () => container.querySelector('.calc-hero strong').textContent;
const waterfall = () => [...container.querySelectorAll('.calc-waterfall__row')];
const itemRows = () => [...container.querySelectorAll('.calc-table--items tbody tr:not(.calc-table__group)')].map((row) => row.textContent);

beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><SellerNetSheet /></MemoryRouter>); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

test('opens on a labelled example and does not suggest a commission rate', async () => {
  expect(text()).toContain('The figures below are an example, not a valuation of your home.');
  expect(field('listingPct').value).toBe('');
  expect(field('buyerPct').value).toBe('');
  expect(text()).toContain('Commission is negotiable and is not set by law.');
  expect(text()).toContain('No commission is entered.');
  // 450,000 less the 250,000 payoff, 1.5% closing costs (6,750) and $450 transfer tax.
  expect(hero()).toBe('$192,800');
});

test('commission is entered as two rates and totalled', async () => {
  await type('listingPct', '3');
  await type('buyerPct', '2.5');
  expect(container.querySelector('.calc-total-box').textContent).toBe('Total commission5.5%$24,750');
  expect(hero()).toBe('$168,050');
  expect(text()).not.toContain('No commission is entered.');
  expect(itemRows()).toContain('Listing brokerage commission−$13,500.003%');
  expect(itemRows()).toContain('Buyer brokerage compensation−$11,250.002.5%');
});

test('Georgia transfer tax is worked out from the price and can be replaced', async () => {
  expect(field('transferTax').value).toBe('450.00');
  expect(field('transferTax').readOnly).toBe(true);
  expect(text()).toContain('$1.00 on the first $1,000, then 10 cents per $100.');
  await type('salePrice', '612350');
  expect(field('transferTax').value).toBe('612.40');
  await press('Enter amount', container.querySelector('[role="group"][aria-label="Transfer tax"]'));
  expect(field('transferTax').readOnly).toBe(false);
  // It starts from Georgia's figure rather than from nothing.
  expect(field('transferTax').value).toBe('612.40');
  await type('transferTax', '700');
  expect(itemRows().some((row) => row.startsWith('Transfer tax−$700.00'))).toBe(true);
});

test('closing costs switch between a percentage and a dollar figure without changing the result', async () => {
  await press('Dollars', container.querySelector('[role="group"][aria-label="Closing costs entered as"]'));
  expect(field('closingCosts').value).toBe('6750');
  expect(hero()).toBe('$192,800');
  await type('closingCosts', '4000');
  expect(hero()).toBe('$195,550');
});

test('property taxes are prorated from the yearly bill and the closing date', async () => {
  await type('annualTax', '5400');
  expect(text()).toContain('Choose a closing date above to estimate your share.');
  expect(text()).toContain('Property taxes are not prorated yet');
  await type('closingDate', '2026-06-15');
  expect(text()).toContain('You own the home for 165 of 365 days this year, so $2,441.10 of the bill is yours and is credited to the buyer.');
  expect(itemRows()).toContain('Prorated property taxes−$2,441.100.54%');
  expect(hero()).toBe('$190,359');
});

test('a tax bill already paid comes back to the seller as a credit', async () => {
  await type('annualTax', '5400');
  await type('closingDate', '2026-06-15');
  await act(async () => { field('taxBillPaid').click(); });
  expect(text()).toContain('so the buyer returns $2,958.90 to you.');
  expect(itemRows()).toContain('Property tax refunded by the buyer+$2,958.900.66%');
  expect(text()).toContain('Credits to you');
  expect(hero()).toBe('$195,759');
  expect(waterfall().find((row) => row.textContent.includes('Property tax refunded')).className).toContain('calc-waterfall__row--credit');
});

test('prorated taxes can be typed as an amount instead', async () => {
  await press('Enter amount', container.querySelector('[role="group"][aria-label="Property taxes"]'));
  expect(field('annualTax')).toBeNull();
  await type('taxAmount', '1800');
  expect(itemRows()).toContain('Prorated property taxes−$1,800.000.4%');
});

test('the staircase runs from the sale price to the net, one named row per line', async () => {
  await type('listingPct', '3');
  await type('concessions', '5000');
  const rows = waterfall().map((row) => row.textContent);
  expect(rows[0]).toBe('Sale price$450,000');
  expect(rows).toContain('Mortgage payoff−$250,000');
  expect(rows).toContain('Seller concessions and repair credits−$5,000');
  expect(rows[rows.length - 1]).toBe('Estimated net proceeds$174,300');
  expect(container.querySelector('.calc-waterfall__key').textContent).toBe('TotalsDeductions');
});

test('choosing a row says what is left after it', async () => {
  const detail = () => container.querySelector('.calc-waterfall__detail').textContent;
  expect(detail()).toBe('Select a row to see what is left after that line.');
  const payoff = waterfall().find((row) => row.textContent.startsWith('Mortgage payoff'));
  expect(payoff.tabIndex).toBe(0);
  await act(async () => { payoff.focus(); });
  expect(detail()).toBe('After mortgage payoff: $200,000 left.');
  await act(async () => { payoff.blur(); });
  expect(detail()).toBe('Select a row to see what is left after that line.');
});

test('bars sit on one scale from the lowest figure to the highest', () => {
  const { rows, zero } = waterfallLayout([
    { key: 'salePrice', kind: 'total', start: 0, end: 400 },
    { key: 'payoff', kind: 'deduction', start: 400, end: 100, amount: 300 },
    { key: 'net', kind: 'total', start: 0, end: 100 },
  ]);
  expect(zero).toBe(0);
  expect(rows.map((row) => [row.left, row.width])).toEqual([[0, 100], [25, 75], [0, 25]]);
  const short = waterfallLayout([
    { key: 'salePrice', kind: 'total', start: 0, end: 300 },
    { key: 'payoff', kind: 'deduction', start: 300, end: -100, amount: 400 },
    { key: 'net', kind: 'total', start: 0, end: -100 },
  ]);
  expect(short.zero).toBe(25);
  expect(short.rows[2]).toMatchObject({ left: 0, width: 25 });
});

test('owing more than the sale brings is shown as a shortfall', async () => {
  await type('mortgagePayoff', '460000');
  expect(text()).toContain('ESTIMATED SHORTFALL AT CLOSING');
  expect(hero()).toBe('−$17,200');
  expect(container.querySelector('.calc-hero').className).toContain('calc-hero--shortfall');
  expect(text()).toContain('you would need to bring money to closing');
  const last = waterfall()[waterfall().length - 1];
  expect(last.textContent).toBe('Shortfall at closing−$17,200');
  expect(last.className).toContain('is-shortfall');
});

test('the call to action asks for a valuation and says it is not an appraisal', async () => {
  const action = container.querySelector('.calc-cta a');
  expect(action.textContent.trim()).toBe('Request a home valuation');
  expect(action.getAttribute('href')).toBe('/inquire?type=seller');
  expect(text()).toContain("an agent's opinion of price from comparable sales. It is not an appraisal.");
  expect(text()).toContain('not a settlement statement');
  expect(text().toLowerCase()).not.toContain('accurate');
});

test('with no sale price the panel asks for one', async () => {
  await type('salePrice', '');
  expect(text()).toContain('Enter a sale price');
  expect(container.querySelector('.calc-hero')).toBeNull();
  expect(text()).not.toContain('NaN');
});

test('every field has a label', () => {
  container.querySelectorAll('input:not([type="checkbox"]), select').forEach((control) => {
    expect(container.querySelector(`label[for="${control.id}"]`)).not.toBeNull();
  });
  expect(field('taxBillPaid').closest('label').textContent).toBe("I have already paid this year's bill");
});
